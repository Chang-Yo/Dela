//go:build linux

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOutputRingKeepsTail(t *testing.T) {
	ring := newOutputRing(8)
	ring.write([]byte("abcdef"))
	ring.write([]byte("ghij"))
	chunk, next, gap := ring.readFrom(0)
	if string(chunk) != "cdefghij" || next != 10 || gap != 2 {
		t.Fatalf("readFrom(0) = %q next=%d gap=%d", chunk, next, gap)
	}
	chunk, next, gap = ring.readFrom(7)
	if string(chunk) != "hij" || next != 10 || gap != 0 {
		t.Fatalf("readFrom(7) = %q next=%d gap=%d", chunk, next, gap)
	}
	if chunk, _, _ = ring.readFrom(10); len(chunk) != 0 {
		t.Fatalf("读到结尾之后还有内容：%q", chunk)
	}
	ring.write([]byte("0123456789XY"))
	chunk, next, gap = ring.readFrom(10)
	if string(chunk) != "456789XY" || next != 22 || gap != 4 {
		t.Fatalf("超过容量的单次写入：%q next=%d gap=%d", chunk, next, gap)
	}
}

func newTestServer(t *testing.T) (*server, *httptest.Server) {
	t.Helper()
	logger := testLogger()
	s := &server{token: testToken, logger: logger, lastSeen: time.Now(), tasks: map[string]*task{}, watch: newWatchHub(logger)}
	mux := http.NewServeMux()
	s.register(mux)
	endpoint := httptest.NewServer(mux)
	t.Cleanup(func() {
		s.cancelAllTasks("测试结束")
		endpoint.Close()
		s.watch.close()
	})
	return s, endpoint
}

func call(t *testing.T, endpoint *httptest.Server, method, path, body string) (int, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(method, endpoint.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+testToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var value map[string]any
	_ = json.NewDecoder(response.Body).Decode(&value)
	return response.StatusCode, value
}

type frame struct {
	Type   string `json:"type"`
	Offset int64  `json:"offset"`
	Data   []byte `json:"data"`
	Bytes  int64  `json:"bytes"`
	State  string `json:"state"`
	Code   int    `json:"code"`
}

// readStream 读帧直到 exit 或 stop 返回 true；ctx 取消即断开连接。
func readStream(ctx context.Context, t *testing.T, endpoint *httptest.Server, id string, offset int64, stop func(frame) bool) []frame {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/v1/tasks/%s/stream?offset=%d", endpoint.URL, id, offset), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+testToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	frames := []frame{}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 64<<10), 16<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var f frame
		if err := json.Unmarshal([]byte(line[6:]), &f); err != nil {
			t.Fatalf("帧不是 JSON：%s", line)
		}
		frames = append(frames, f)
		if f.Type == "exit" || (stop != nil && stop(f)) {
			break
		}
	}
	return frames
}

func outputOf(frames []frame) string {
	var buffer bytes.Buffer
	for _, f := range frames {
		if f.Type == "output" {
			buffer.Write(f.Data)
		}
	}
	return buffer.String()
}

func TestTaskCreateIsIdempotent(t *testing.T) {
	_, endpoint := newTestServer(t)
	marker := filepath.Join(t.TempDir(), "count")
	body := fmt.Sprintf(`{"id":"once","command":"echo x >> %s","cwd":"/"}`, marker)
	status, first := call(t, endpoint, http.MethodPost, "/v1/tasks", body)
	if status != http.StatusOK || first["created"] != true {
		t.Fatalf("第一次创建：%d %v", status, first)
	}
	readStream(context.Background(), t, endpoint, "once", 0, nil)
	status, second := call(t, endpoint, http.MethodPost, "/v1/tasks", body)
	if status != http.StatusOK || second["created"] != false {
		t.Fatalf("重复创建应只返回已有任务：%d %v", status, second)
	}
	content, _ := os.ReadFile(marker)
	if string(content) != "x\n" {
		t.Fatalf("命令执行了不止一次：%q", content)
	}
}

// 断开输出流不能取消任务：这是「重连后接回」的前提。
func TestTaskSurvivesStreamDisconnect(t *testing.T) {
	_, endpoint := newTestServer(t)
	call(t, endpoint, http.MethodPost, "/v1/tasks",
		`{"id":"long","command":"echo first; sleep 1; echo second; exit 7","cwd":"/"}`)
	ctx, cancel := context.WithCancel(context.Background())
	early := readStream(ctx, t, endpoint, "long", 0, func(f frame) bool { return f.Type == "output" })
	cancel()
	seen := int64(len(outputOf(early)))
	if outputOf(early) != "first\n" {
		t.Fatalf("断开前读到 %q", outputOf(early))
	}

	rest := readStream(context.Background(), t, endpoint, "long", seen, nil)
	if outputOf(rest) != "second\n" {
		t.Fatalf("续读得到 %q，想要只有 second", outputOf(rest))
	}
	exit := rest[len(rest)-1]
	if exit.Type != "exit" || exit.State != "exited" || exit.Code != 7 {
		t.Fatalf("退出帧 %+v", exit)
	}
}

func TestTaskStreamReportsGap(t *testing.T) {
	_, endpoint := newTestServer(t)
	// 输出超过缓冲容量：从 0 续读时最旧的部分已经被覆盖。
	command := fmt.Sprintf("head -c %d /dev/zero | tr '\\0' a; printf END", taskBufferBytes+1000)
	call(t, endpoint, http.MethodPost, "/v1/tasks", fmt.Sprintf(`{"id":"big","command":%q,"cwd":"/"}`, command))
	// 第一次读只为等任务结束（边读边写时不一定有 gap），结束后再从头读才必然被覆盖。
	readStream(context.Background(), t, endpoint, "big", 0, nil)
	frames := readStream(context.Background(), t, endpoint, "big", 0, nil)
	if frames[0].Type != "gap" || frames[0].Bytes != 1003 {
		t.Fatalf("第一帧应是 gap(1003)，得到 %+v", frames[0])
	}
	output := outputOf(frames)
	if len(output) != taskBufferBytes || !strings.HasSuffix(output, "END") {
		t.Fatalf("续读长度 %d，结尾 %q", len(output), output[max(0, len(output)-5):])
	}
}

// 连着的时候输出不能丢：缓冲只兜断线，读者在场时生产者等读者。
func TestTaskStreamIsLosslessWhileAttached(t *testing.T) {
	_, endpoint := newTestServer(t)
	size := 3*taskBufferBytes + 12345
	command := fmt.Sprintf("head -c %d /dev/zero | tr '\\0' a", size)
	call(t, endpoint, http.MethodPost, "/v1/tasks", fmt.Sprintf(`{"id":"flood","command":%q,"cwd":"/"}`, command))
	frames := readStream(context.Background(), t, endpoint, "flood", 0, nil)
	for _, f := range frames {
		if f.Type == "gap" {
			t.Fatalf("读者在场时出现 gap：%+v", f)
		}
	}
	if got := len(outputOf(frames)); got != size {
		t.Fatalf("收到 %d 字节，想要 %d", got, size)
	}
}

func TestTaskCancelKillsProcessGroup(t *testing.T) {
	_, endpoint := newTestServer(t)
	pidFile := filepath.Join(t.TempDir(), "child")
	call(t, endpoint, http.MethodPost, "/v1/tasks",
		fmt.Sprintf(`{"id":"tree","command":"sleep 60 & echo $! > %s; wait","cwd":"/"}`, pidFile))
	deadline := time.Now().Add(5 * time.Second)
	var child int
	for time.Now().Before(deadline) {
		if body, err := os.ReadFile(pidFile); err == nil && len(body) > 0 {
			fmt.Sscan(string(body), &child)
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if child == 0 {
		t.Fatal("子进程没起来")
	}
	call(t, endpoint, http.MethodPost, "/v1/tasks/tree/cancel", "")
	frames := readStream(context.Background(), t, endpoint, "tree", 0, nil)
	if exit := frames[len(frames)-1]; exit.State != "cancelled" {
		t.Fatalf("取消后的状态 %+v", exit)
	}
	// 孙进程被 bash 留下后由 init 回收：信号到了也要一小会儿才从 /proc 消失，期间可能是僵尸。
	deadline = time.Now().Add(3 * time.Second)
	for {
		status, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", child))
		if err != nil || strings.Contains(string(status), ") Z ") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("孙进程 %d 还活着", child)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestTaskTimeout(t *testing.T) {
	_, endpoint := newTestServer(t)
	call(t, endpoint, http.MethodPost, "/v1/tasks", `{"id":"slow","command":"sleep 30","cwd":"/","timeoutMs":200}`)
	frames := readStream(context.Background(), t, endpoint, "slow", 0, nil)
	if exit := frames[len(frames)-1]; exit.State != "timeout" {
		t.Fatalf("超时状态 %+v", exit)
	}
}

func TestStopCancelsRunningTasks(t *testing.T) {
	s, endpoint := newTestServer(t)
	s.http = &http.Server{}
	call(t, endpoint, http.MethodPost, "/v1/tasks", `{"id":"orphan","command":"sleep 30","cwd":"/"}`)
	s.stop("空闲到期")
	select {
	case <-s.taskByID("orphan").done:
	case <-time.After(10 * time.Second):
		t.Fatal("helper 退出时没有终止任务")
	}
	if state := s.taskByID("orphan").snapshot().State; state != "cancelled" {
		t.Fatalf("状态 %s", state)
	}
	if status, _ := call(t, endpoint, http.MethodPost, "/v1/tasks", `{"id":"late","command":"true","cwd":"/"}`); status == http.StatusOK {
		t.Fatal("退出中还能创建任务")
	}
}

func TestPruneKeepsRunningTasks(t *testing.T) {
	s := &server{tasks: map[string]*task{}}
	old := time.Now().Add(-2 * taskRetentionAge)
	add := func(id string, state taskState, finished time.Time) {
		s.tasks[id] = &task{id: id, state: state, finished: finished}
		s.order = append(s.order, id)
	}
	add("ancient-running", stateRunning, time.Time{})
	add("ancient-done", stateExited, old)
	for i := 0; i < taskRetention+5; i++ {
		add(fmt.Sprintf("done-%03d", i), stateExited, time.Now())
	}
	s.pruneTasksLocked()
	if s.tasks["ancient-running"] == nil {
		t.Fatal("在跑的任务被清掉了")
	}
	if s.tasks["ancient-done"] != nil || s.tasks["done-000"] != nil {
		t.Fatal("过期或超额的已结束任务没清掉")
	}
	if len(s.order) != taskRetention+1 || s.order[0] != "ancient-running" {
		t.Fatalf("剩下 %d 条，第一条 %s", len(s.order), s.order[0])
	}
}

func TestAcquireLockIsExclusive(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "lock")
	if err := acquireLock(lock); err != nil {
		t.Fatal(err)
	}
	// flock 按打开的文件描述，同进程里再开一次也会冲突。
	if err := acquireLock(lock); err == nil {
		t.Fatal("第二次加锁应当失败")
	}
}
