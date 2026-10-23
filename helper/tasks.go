package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

// 任务与请求连接解耦：隧道断了任务照跑，Dela 重连后按字节偏移续读输出。
// 只有显式取消、任务自己的超时、或 helper 退出（空闲到期）才会终止进程组。
const (
	// 每个任务的输出缓冲（stdout/stderr 交织写入同一个缓冲）。有流在读时它只是背压窗口，一个字节都不丢；
	// 断线期间没人读才会写满并覆盖最旧的部分——Pi 的 bash 工具截断时留的也是尾部。
	taskBufferBytes = 8 << 20
	// 已结束任务的保留：条数与时长都设上限，先到先清。1 小时与 helper 的空闲上限一致——
	// Dela 断线最久就是这么长，再久没人回来接，结果也没人看了。
	taskRetention    = 100
	taskRetentionAge = time.Hour
	taskMaxIDLength  = 128
	killGracePeriod  = 5 * time.Second
	pumpBufferSize   = 32 * 1024
	// 流上安静时的保活：Dela 侧以「多久没有字节」判断隧道半死。
	taskKeepAlive = 30 * time.Second
)

type taskState string

const (
	stateRunning   taskState = "running"
	stateExited    taskState = "exited"
	stateCancelled taskState = "cancelled"
	stateTimeout   taskState = "timeout"
)

// outputRing 是一段只追加的字节流的尾部窗口：total 是写入过的总字节数（流的绝对偏移），
// 缓冲里只留最后 cap 字节。读者按绝对偏移读，读到已被覆盖的部分就报 gap。
type outputRing struct {
	data  []byte
	start int // data 里最旧字节的下标（环形）
	size  int
	total int64
}

func newOutputRing(capacity int) *outputRing {
	return &outputRing{data: make([]byte, capacity)}
}

func (r *outputRing) write(chunk []byte) {
	capacity := len(r.data)
	r.total += int64(len(chunk))
	if len(chunk) >= capacity {
		copy(r.data, chunk[len(chunk)-capacity:])
		r.start, r.size = 0, capacity
		return
	}
	end := (r.start + r.size) % capacity
	first := copy(r.data[end:], chunk)
	copy(r.data, chunk[first:])
	r.size += len(chunk)
	if r.size > capacity {
		r.start = (r.start + r.size - capacity) % capacity
		r.size = capacity
	}
}

// readFrom 返回从绝对偏移 offset 开始的已有内容；offset 早于窗口时 gap 是被丢掉的字节数，
// 内容从窗口开头给起。offset 超过 total 视为 total（没有新内容）。
func (r *outputRing) readFrom(offset int64) (chunk []byte, next int64, gap int64) {
	oldest := r.total - int64(r.size)
	if offset < oldest {
		gap = oldest - offset
		offset = oldest
	}
	if offset >= r.total {
		return nil, r.total, gap
	}
	skip := int(offset - oldest)
	length := r.size - skip
	chunk = make([]byte, length)
	capacity := len(r.data)
	from := (r.start + skip) % capacity
	first := copy(chunk, r.data[from:min(from+length, capacity)])
	copy(chunk[first:], r.data[:length-first])
	return chunk, r.total, gap
}

type task struct {
	id      string
	command string
	cwd     string
	pid     int
	started time.Time

	mu       sync.Mutex
	state    taskState
	exitCode int
	signal   string
	finished time.Time
	output   *outputRing
	// changed 在每次有新输出或结束时被关闭并换新：流的读者在它上面等，不用轮询。
	changed chan struct{}
	done    chan struct{}
	// readers 是正在读的流各自已发出的偏移。有人在读时生产者不超过最慢的读者一个缓冲：
	// 连着的时候一个字节都不丢，只有断线（没人读）期间才覆盖最旧的输出。
	readers map[*int64]struct{}
	// drained 在读者推进或离开时被关闭并换新：被背压挡住的 pump 在它上面等。
	drained chan struct{}
}

type taskView struct {
	ID         string `json:"id"`
	Command    string `json:"command"`
	Cwd        string `json:"cwd"`
	PID        int    `json:"pid"`
	State      string `json:"state"`
	ExitCode   int    `json:"exitCode"`
	Signal     string `json:"signal,omitempty"`
	StartedAt  int64  `json:"startedAt"`
	DurationMs int64  `json:"durationMs"`
	// Output 是写入过的总字节数：续读时的偏移上限。
	Output int64 `json:"output"`
}

func (t *task) snapshotLocked() taskView {
	end := time.Now()
	if !t.finished.IsZero() {
		end = t.finished
	}
	return taskView{
		ID:         t.id,
		Command:    t.command,
		Cwd:        t.cwd,
		PID:        t.pid,
		State:      string(t.state),
		ExitCode:   t.exitCode,
		Signal:     t.signal,
		StartedAt:  t.started.UnixMilli(),
		DurationMs: end.Sub(t.started).Milliseconds(),
		Output:     t.output.total,
	}
}

func (t *task) snapshot() taskView {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.snapshotLocked()
}

func (t *task) notifyLocked() {
	close(t.changed)
	t.changed = make(chan struct{})
}

// append 在最慢的读者落后超过一个缓冲时阻塞（背压一直传到命令的 stdout 管道）。
func (t *task) append(chunk []byte) {
	t.mu.Lock()
	for t.behindLocked(int64(len(chunk))) {
		drained := t.drained
		t.mu.Unlock()
		<-drained
		t.mu.Lock()
	}
	t.output.write(chunk)
	t.notifyLocked()
	t.mu.Unlock()
}

func (t *task) behindLocked(incoming int64) bool {
	limit := int64(len(t.output.data))
	for offset := range t.readers {
		if t.output.total+incoming-*offset > limit {
			return true
		}
	}
	return false
}

func (t *task) drainedLocked() {
	close(t.drained)
	t.drained = make(chan struct{})
}

// finish 只生效一次：取消/超时先改了 state 的，退出码照记，state 不被覆盖。
func (t *task) finish(code int, signal string) {
	t.mu.Lock()
	if t.state == stateRunning {
		t.state = stateExited
	}
	t.exitCode = code
	t.signal = signal
	t.finished = time.Now()
	t.notifyLocked()
	t.mu.Unlock()
	close(t.done)
}

func (t *task) running() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.state == stateRunning
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
	killGroup(t.pid, syscall.SIGTERM)
	go func() {
		select {
		case <-t.done:
		case <-time.After(killGracePeriod):
			killGroup(t.pid, syscall.SIGKILL)
		}
	}()
}

func killGroup(pgid int, signal syscall.Signal) {
	if pgid <= 0 {
		return
	}
	_ = syscall.Kill(-pgid, signal)
}

type taskRequest struct {
	ID        string   `json:"id"`
	Command   string   `json:"command"`
	Cwd       string   `json:"cwd"`
	TimeoutMs int      `json:"timeoutMs"`
	Env       []string `json:"env"`
}

// startTask 按客户端给的 id 去重：同一个 id 再来只返回已有任务（created=false），不会再执行一遍。
// 重连时 Dela 不知道上一次创建请求有没有落地，就靠这一条保证 `git push` 不跑两遍。
func (s *server) startTask(req taskRequest) (*task, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.tasks[req.ID]; ok {
		return existing, false, nil
	}
	if s.stopping {
		return nil, false, errors.New("helper 正在退出")
	}

	// bash -lc 与 `ssh <host> "cd … && 命令"` 的语义一致：登录 shell（PATH 里有 nvm、conda），
	// 工作目录交给 cmd.Dir，不在命令里拼 cd。
	cmd := exec.Command("bash", "-lc", req.Command)
	cmd.Dir = req.Cwd
	if len(req.Env) > 0 {
		cmd.Env = append(os.Environ(), req.Env...)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// stdout 与 stderr 进同一根管道：交织顺序与终端里看到的一致，也只需要一个缓冲。
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, false, err
	}
	cmd.Stdout = writer
	cmd.Stderr = writer
	if err := cmd.Start(); err != nil {
		reader.Close()
		writer.Close()
		return nil, false, err
	}
	writer.Close()

	t := &task{
		id:      req.ID,
		command: req.Command,
		cwd:     req.Cwd,
		pid:     cmd.Process.Pid,
		started: time.Now(),
		state:   stateRunning,
		output:  newOutputRing(taskBufferBytes),
		changed: make(chan struct{}),
		done:    make(chan struct{}),
		readers: map[*int64]struct{}{},
		drained: make(chan struct{}),
	}
	s.tasks[t.id] = t
	s.order = append(s.order, t.id)
	s.pruneTasksLocked()

	go func() {
		t.pump(reader)
		reader.Close()
		code, signal := exitStatus(cmd.Wait())
		t.finish(code, signal)
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
	return t, true, nil
}

// pruneTasksLocked 只清已结束的：在跑的任务无论多老都留着，否则重连后就找不到它了。
func (s *server) pruneTasksLocked() {
	cutoff := time.Now().Add(-taskRetentionAge)
	kept := make([]string, 0, len(s.order))
	settled := 0
	for i := len(s.order) - 1; i >= 0; i-- {
		t := s.tasks[s.order[i]]
		t.mu.Lock()
		ended, finished := t.state != stateRunning, t.finished
		t.mu.Unlock()
		if ended {
			settled++
			if settled > taskRetention || finished.Before(cutoff) {
				delete(s.tasks, t.id)
				continue
			}
		}
		kept = append(kept, t.id)
	}
	// 倒序收集的，翻回时间顺序。
	for i, j := 0, len(kept)-1; i < j; i, j = i+1, j-1 {
		kept[i], kept[j] = kept[j], kept[i]
	}
	s.order = kept
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
		if !t.running() {
			continue
		}
		s.logger.Printf("终止任务 %s（%s）", t.id, reason)
		t.cancel(stateCancelled)
	}
}

func (t *task) pump(reader io.Reader) {
	buffer := make([]byte, pumpBufferSize)
	for {
		count, err := reader.Read(buffer)
		if count > 0 {
			t.append(buffer[:count])
		}
		if err != nil {
			return
		}
	}
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

// /v1/tasks：GET 列出，POST 创建（幂等）。
func (s *server) handleTasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.mu.Lock()
		views := make([]taskView, 0, len(s.order))
		for _, id := range s.order {
			views = append(views, s.tasks[id].snapshot())
		}
		s.mu.Unlock()
		sort.SliceStable(views, func(i, j int) bool { return views[i].StartedAt < views[j].StartedAt })
		writeJSON(w, http.StatusOK, map[string]any{"tasks": views})
	case http.MethodPost:
		s.createTask(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "只支持 GET/POST")
	}
}

func (s *server) createTask(w http.ResponseWriter, r *http.Request) {
	var req taskRequest
	if !decodeBody(w, r, &req) {
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	if req.ID == "" || len(req.ID) > taskMaxIDLength || strings.ContainsAny(req.ID, "/?#") {
		writeError(w, http.StatusBadRequest, "bad_request",
			fmt.Sprintf("id 长度需要在 1 到 %d 之间，且不含 / ? #", taskMaxIDLength))
		return
	}
	if strings.TrimSpace(req.Command) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "command 不能为空")
		return
	}
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
		req.Cwd = path
	}
	t, created, err := s.startTask(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "start_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t.snapshot(), "created": created})
}

// /v1/tasks/{id}、/v1/tasks/{id}/stream、/v1/tasks/{id}/cancel。
func (s *server) handleTaskAction(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/v1/tasks/")
	id, action, _ := strings.Cut(rest, "/")
	t := s.taskByID(id)
	if t == nil {
		writeError(w, http.StatusNotFound, "not_found", "任务不存在或已过期")
		return
	}
	switch {
	case action == "" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"task": t.snapshot()})
	case action == "stream" && r.Method == http.MethodGet:
		offset, err := queryInt(r, "offset", 0)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		t.stream(w, r, offset)
	case action == "cancel" && r.Method == http.MethodPost:
		t.cancel(stateCancelled)
		writeJSON(w, http.StatusOK, map[string]any{"task": t.snapshot()})
	default:
		writeError(w, http.StatusNotFound, "not_found", "未知的任务子路径")
	}
}

// stream 从 offset 推输出直到任务结束；连接断开只结束这条流，不碰任务。
// 帧：output{offset,data(base64)}，gap{offset,bytes}，exit{state,code,signal,durationMs,output}。
// output 帧的 offset 是这段数据起点的绝对偏移，客户端记 offset+len 作为续读位置。
func (t *task) stream(w http.ResponseWriter, r *http.Request, offset int64) {
	stream := openStream(w)
	if stream == nil {
		return
	}
	// 立刻刷出响应头：任务可能很久没有输出，客户端要先知道流已建立。
	stream.flusher.Flush()
	keepAlive := time.NewTicker(taskKeepAlive)
	defer keepAlive.Stop()
	// 登记成读者：sent 是这条流已经写进连接的偏移，生产者据此背压。离开时注销并放行生产者。
	sent := offset
	t.mu.Lock()
	t.readers[&sent] = struct{}{}
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.readers, &sent)
		t.drainedLocked()
		t.mu.Unlock()
	}()
	for {
		t.mu.Lock()
		chunk, next, gap := t.output.readFrom(offset)
		ended := t.state != stateRunning && !t.finished.IsZero()
		view := t.snapshotLocked()
		changed := t.changed
		t.mu.Unlock()

		if gap > 0 {
			stream.send(map[string]any{"type": "gap", "offset": offset, "bytes": gap})
			offset += gap
		}
		if len(chunk) > 0 {
			stream.send(map[string]any{"type": "output", "offset": offset, "data": chunk})
		}
		offset = next
		t.mu.Lock()
		sent = offset
		t.drainedLocked()
		t.mu.Unlock()
		if ended {
			stream.send(map[string]any{
				"type":       "exit",
				"state":      view.State,
				"code":       view.ExitCode,
				"signal":     view.Signal,
				"durationMs": view.DurationMs,
				"output":     view.Output,
			})
			return
		}
		if stream.failed() {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-changed:
		case <-keepAlive.C:
			stream.comment("keep-alive")
		}
	}
}
