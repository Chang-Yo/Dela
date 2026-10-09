package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	// 单个任务最多回传这么多字节；超出部分丢弃并计数，避免慢消费者把内存吃满。
	maxTaskOutputBytes = 8 << 20
	// 任务状态保留条数：Dela 只在本次连接内查询，不需要更久。
	taskRetention   = 100
	killGracePeriod = 5 * time.Second
	// exec 的 stdout/stderr 一起算，避免两条流各自把上限吃满。
	pumpBufferSize = 32 * 1024
)

type taskState string

const (
	stateRunning   taskState = "running"
	stateExited    taskState = "exited"
	stateCancelled taskState = "cancelled"
	stateTimeout   taskState = "timeout"
)

type task struct {
	id       string
	command  string
	pid      int
	pgid     int
	started  time.Time
	finished time.Time
	done     chan struct{}
	closeOne sync.Once

	mu        sync.Mutex
	state     taskState
	exitCode  int
	signal    string
	sent      int64
	discarded int64
}

type taskView struct {
	ID         string `json:"id"`
	Command    string `json:"command"`
	PID        int    `json:"pid"`
	State      string `json:"state"`
	ExitCode   int    `json:"exitCode"`
	Signal     string `json:"signal"`
	StartedAt  int64  `json:"startedAt"`
	DurationMs int64  `json:"durationMs"`
	Discarded  int64  `json:"discarded"`
}

func newTaskID() string {
	buffer := make([]byte, 8)
	if _, err := rand.Read(buffer); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(buffer)
}

func (t *task) snapshot() taskView {
	t.mu.Lock()
	defer t.mu.Unlock()
	end := time.Now()
	if !t.finished.IsZero() {
		end = t.finished
	}
	return taskView{
		ID:         t.id,
		Command:    t.command,
		PID:        t.pid,
		State:      string(t.state),
		ExitCode:   t.exitCode,
		Signal:     t.signal,
		StartedAt:  t.started.UnixMilli(),
		DurationMs: end.Sub(t.started).Milliseconds(),
		Discarded:  t.discarded,
	}
}

// keep 记账：返回 false 表示这一段要丢弃（已经超过上限）。stdout 与 stderr 共用额度。
func (t *task) keep(size int64) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.sent+size > maxTaskOutputBytes {
		t.discarded += size
		return false
	}
	t.sent += size
	return true
}

func (t *task) discardedCount() int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.discarded
}

// finish 只生效一次：取消/超时先改了 state 的，退出码不再覆盖它。
func (t *task) finish(code int, signal string) {
	t.mu.Lock()
	if t.state == stateRunning {
		t.state = stateExited
		t.exitCode = code
		t.signal = signal
	}
	t.finished = time.Now()
	t.mu.Unlock()
	t.closeOne.Do(func() { close(t.done) })
}

// cancel 终止整个进程组：Go 默认只杀直接子进程，构建工具的子孙会留下来。
func (t *task) cancel(state taskState) {
	t.mu.Lock()
	if t.state != stateRunning {
		t.mu.Unlock()
		return
	}
	t.state = state
	t.mu.Unlock()
	killGroup(t.pgid, syscall.SIGTERM)
	go func() {
		select {
		case <-t.done:
		case <-time.After(killGracePeriod):
			killGroup(t.pgid, syscall.SIGKILL)
		}
	}()
}

func killGroup(pgid int, signal syscall.Signal) {
	if pgid <= 0 {
		return
	}
	_ = syscall.Kill(-pgid, signal)
}

func (s *server) addTask(t *task) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tasks[t.id] = t
	s.order = append(s.order, t.id)
	for len(s.order) > taskRetention {
		oldest := s.order[0]
		s.order = s.order[1:]
		if existing, ok := s.tasks[oldest]; ok && existing.settled() {
			delete(s.tasks, oldest)
		}
	}
}

func (t *task) settled() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.state != stateRunning
}

func (s *server) taskByID(id string) *task {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tasks[id]
}

func (s *server) cancelAllTasks(reason string) {
	s.mu.Lock()
	tasks := make([]*task, 0, len(s.tasks))
	for _, t := range s.tasks {
		tasks = append(tasks, t)
	}
	s.mu.Unlock()
	for _, t := range tasks {
		if t.settled() {
			continue
		}
		s.logger.Printf("终止任务 %s（%s）", t.id, reason)
		t.cancel(stateCancelled)
	}
}

// sseWriter 串行化两条输出流与结束事件：同一个 ResponseWriter 不能并发写。
type sseWriter struct {
	mu      sync.Mutex
	w       http.ResponseWriter
	flusher http.Flusher
	broken  bool
}

func (s *sseWriter) send(value any) {
	body, err := json.Marshal(value)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.broken {
		return
	}
	if _, err := fmt.Fprintf(s.w, "data: %s\n\n", body); err != nil {
		s.broken = true
		return
	}
	s.flusher.Flush()
}

// 执行命令：流式回传 stdout/stderr，进程组可取消，超时由 helper 裁定。
func (s *server) handleExec(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Command   string   `json:"command"`
		Cwd       string   `json:"cwd"`
		TimeoutMs int      `json:"timeoutMs"`
		Env       []string `json:"env"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	command := strings.TrimSpace(req.Command)
	if command == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "command 不能为空")
		return
	}
	cwd := ""
	if strings.TrimSpace(req.Cwd) != "" {
		path, err := requireAbsPath(req.Cwd)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_cwd", err.Error())
			return
		}
		if info, err := os.Stat(path); err != nil || !info.IsDir() {
			writeError(w, http.StatusBadRequest, "bad_cwd", fmt.Sprintf("工作目录不可用：%s", path))
			return
		}
		cwd = path
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "no_stream", "当前连接不支持流式响应")
		return
	}

	// bash -lc 与今天 `ssh <host> "cd … && 命令"` 的语义一致：登录 shell（PATH 里有 nvm、conda），
	// 工作目录交给 cmd.Dir，不再在命令里拼 cd。
	cmd := exec.Command("bash", "-lc", command)
	cmd.Dir = cwd
	if len(req.Env) > 0 {
		cmd.Env = append(os.Environ(), req.Env...)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pipe_failed", err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "pipe_failed", err.Error())
		return
	}
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusBadRequest, "start_failed", err.Error())
		return
	}

	t := &task{
		id:      newTaskID(),
		command: command,
		pid:     cmd.Process.Pid,
		pgid:    cmd.Process.Pid,
		started: time.Now(),
		state:   stateRunning,
		done:    make(chan struct{}),
	}
	s.addTask(t)

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	stream := &sseWriter{w: w, flusher: flusher}
	stream.send(map[string]any{"type": "start", "taskId": t.id, "pid": t.pid})

	// 客户端断开（Dela 退出、隧道断）= 任务失联：终止进程组，远端不留孤儿构建。
	go func() {
		<-r.Context().Done()
		t.cancel(stateCancelled)
	}()

	if req.TimeoutMs > 0 {
		timeout := time.Duration(req.TimeoutMs) * time.Millisecond
		go func() {
			select {
			case <-t.done:
			case <-time.After(timeout):
				t.cancel(stateTimeout)
			}
		}()
	}

	var pumps sync.WaitGroup
	pumps.Add(2)
	go func() { defer pumps.Done(); t.pump(stdout, "stdout", stream) }()
	go func() { defer pumps.Done(); t.pump(stderr, "stderr", stream) }()

	waitErr := cmd.Wait()
	pumps.Wait()
	code, signal := exitStatus(waitErr)
	t.finish(code, signal)
	view := t.snapshot()
	stream.send(map[string]any{
		"type":       "exit",
		"taskId":     t.id,
		"state":      view.State,
		"code":       view.ExitCode,
		"signal":     view.Signal,
		"discarded":  view.Discarded,
		"durationMs": view.DurationMs,
	})
}

func (t *task) pump(reader io.Reader, name string, stream *sseWriter) {
	buffer := make([]byte, pumpBufferSize)
	for {
		count, err := reader.Read(buffer)
		if count > 0 {
			chunk := make([]byte, count)
			copy(chunk, buffer[:count])
			if t.keep(int64(count)) {
				stream.send(map[string]any{
					"type": name,
					"data": base64.StdEncoding.EncodeToString(chunk),
				})
			}
		}
		if err != nil {
			return
		}
	}
}

func (s *server) handleExecAction(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/v1/exec/")
	id, action, found := strings.Cut(rest, "/")
	if !found || action != "cancel" {
		writeError(w, http.StatusNotFound, "not_found", "未知的 exec 子路径")
		return
	}
	t := s.taskByID(id)
	if t == nil {
		writeError(w, http.StatusNotFound, "not_found", "任务不存在或已过期")
		return
	}
	t.cancel(stateCancelled)
	writeJSON(w, http.StatusOK, map[string]any{"taskId": id, "state": t.snapshot().State})
}

func (s *server) handleTasks(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	order := append([]string(nil), s.order...)
	tasks := make(map[string]*task, len(s.tasks))
	for id, t := range s.tasks {
		tasks[id] = t
	}
	s.mu.Unlock()
	views := make([]taskView, 0, len(order))
	for _, id := range order {
		if t, ok := tasks[id]; ok {
			views = append(views, t.snapshot())
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": views})
}

func exitStatus(err error) (int, string) {
	if err == nil {
		return 0, ""
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
			if status.Signaled() {
				return 128 + int(status.Signal()), status.Signal().String()
			}
			return status.ExitStatus(), ""
		}
		return exitErr.ExitCode(), ""
	}
	return 1, ""
}
