//go:build linux

package main

// 这些用例要真的内核 inotify 与真的 SSE 连接，只能在 Linux 上跑（helper 本身也只支持 Linux）。

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testToken = "0123456789abcdef"

func waitEvent(t *testing.T, sub *watchSubscriber, timeout time.Duration) watchEvent {
	t.Helper()
	select {
	case event := <-sub.ch:
		return event
	case <-time.After(timeout):
		t.Fatalf("等事件超时（%s）", timeout)
	}
	return watchEvent{}
}

func drainEvents(sub *watchSubscriber) {
	for {
		select {
		case <-sub.ch:
		default:
			return
		}
	}
}

func TestWatchHubRealInotify(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "nope")
	hub := newWatchHub(testLogger())
	defer hub.close()
	sub := hub.fanout.subscribe()
	defer hub.fanout.unsubscribe(sub)

	watching, skipped, err := hub.set("t1", []string{dir, missing, dir})
	if err != nil {
		t.Fatalf("set 失败：%v", err)
	}
	if watching != 1 {
		t.Errorf("watching=%d，想要 1（重复路径 + 不存在的目录）", watching)
	}
	if len(skipped) != 1 || skipped[0] != missing {
		t.Errorf("skipped=%+v，想要 [%s]", skipped, missing)
	}

	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	event := waitEvent(t, sub, 5*time.Second)
	if event.Type != "change" || event.ID != "t1" || len(event.Paths) != 1 || event.Paths[0] != dir {
		t.Fatalf("新建文件的事件不对：%+v", event)
	}

	// 只改内容（覆盖写已有文件）不该刷新：远端树只显示名字与类型
	drainEvents(sub)
	if err := os.WriteFile(file, []byte("yyyy"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-sub.ch:
		t.Errorf("内容变化不该发事件：%+v", event)
	case <-time.After(watchMergeWindow * 2):
	}

	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if event = waitEvent(t, sub, 5*time.Second); event.ID != "t1" {
		t.Errorf("删目录的事件不对：%+v", event)
	}
	deadline := time.Now().Add(2 * time.Second)
	for len(hub.byPath) != 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if len(hub.byPath) != 0 || len(hub.byWD) != 0 {
		t.Errorf("IN_IGNORED 之后记账应该清空：%+v", hub.byPath)
	}
	drainEvents(sub)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if watching, _, err = hub.set("t1", []string{dir}); err != nil || watching != 1 {
		t.Fatalf("重新 POST 之后 watching=%d err=%v，想要 1", watching, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if event = waitEvent(t, sub, 5*time.Second); event.Type != "change" || event.Paths[0] != dir {
		t.Fatalf("重新加上 watch 之后的事件不对：%+v", event)
	}

	hub.forgetID("t1")
	drainEvents(sub)
	if err := os.WriteFile(filepath.Join(dir, "c.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-sub.ch:
		t.Errorf("DELETE 之后不该再有事件：%+v", event)
	case <-time.After(watchMergeWindow*2 + 100*time.Millisecond):
	}

	// 同一个目录被两个 id 看时只加一次内核 watch；一个 id 走掉不能影响另一个
	if _, _, err := hub.set("t1", []string{dir}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := hub.set("t2", []string{dir}); err != nil {
		t.Fatal(err)
	}
	if len(hub.byPath) != 1 || len(hub.byPath[dir].ids) != 2 {
		t.Fatalf("同一目录应该只占一个 watch 且引用计数为 2：%+v", hub.byPath[dir])
	}
	hub.forgetID("t1")
	if len(hub.byPath) != 1 {
		t.Fatalf("还有 t2 在看，watch 不该被摘掉：%+v", hub.byPath)
	}
	drainEvents(sub)
	if err := os.WriteFile(filepath.Join(dir, "d.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if event = waitEvent(t, sub, 5*time.Second); event.ID != "t2" {
		t.Fatalf("t1 走掉之后 t2 应该照常收到事件：%+v", event)
	}
}

func TestWatchHTTPStream(t *testing.T) {
	dir := t.TempDir()
	logger := testLogger()
	s := &server{token: testToken, logger: logger, lastSeen: time.Now(), tasks: map[string]*task{}, watch: newWatchHub(logger)}
	mux := http.NewServeMux()
	s.register(mux)
	endpoint := httptest.NewServer(mux)
	defer endpoint.Close()

	post, err := http.NewRequest(http.MethodPost, endpoint.URL+"/v1/watch",
		strings.NewReader(fmt.Sprintf(`{"id":"stream","paths":[%q]}`, dir)))
	if err != nil {
		t.Fatal(err)
	}
	post.Header.Set("Authorization", "Bearer "+testToken)
	response, err := http.DefaultClient.Do(post)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), `"watching":1`) {
		t.Fatalf("POST /v1/watch 返回 %d %s", response.StatusCode, body)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// 响应头必须马上到：加超时是为了让「响应头被 net/http 攒着不发」这种回归快速失败，
	// 而不是挂到 go test 的 10 分钟总超时。
	requestCtx, stopWaiting := context.WithTimeout(ctx, 30*time.Second)
	defer stopWaiting()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint.URL+"/v1/watch", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+testToken)
	stream, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET /v1/watch 没能及时返回响应头（是不是没 Flush？）：%v", err)
	}
	defer stream.Body.Close()
	if contentType := stream.Header.Get("Content-Type"); contentType != "text/event-stream; charset=utf-8" {
		t.Errorf("Content-Type=%q", contentType)
	}
	lines := make(chan string, 16)
	go func() {
		reader := bufio.NewReader(stream.Body)
		for {
			line, err := reader.ReadString('\n')
			if line != "" {
				lines <- line
			}
			if err != nil {
				close(lines)
				return
			}
		}
	}()

	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	var event watchEvent
	timeout := time.After(5 * time.Second)
	for event.Type == "" {
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatal("流在收到事件之前就结束了")
			}
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
				t.Fatalf("事件不是合法 JSON：%q", line)
			}
		case <-timeout:
			t.Fatal("等 SSE 事件超时")
		}
	}
	if event.Type != "change" || event.ID != "stream" || len(event.Paths) != 1 || event.Paths[0] != dir {
		t.Fatalf("SSE 事件不对：%+v", event)
	}

	cancel()
	stream.Body.Close()
	deadline := time.Now().Add(3 * time.Second)
	for {
		s.watch.fanout.mu.Lock()
		subscribers := len(s.watch.fanout.subs)
		s.watch.fanout.mu.Unlock()
		if subscribers == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("断开之后还剩 %d 个订阅者", subscribers)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
