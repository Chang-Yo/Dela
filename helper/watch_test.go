package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"syscall"
	"testing"
)

func testLogger() *log.Logger { return log.New(io.Discard, "", 0) }

// 按内核 struct inotify_event 布局拼事件：名字按 4 字节补齐。
func packInotifyEvent(buffer []byte, wd int32, mask uint32, name string) []byte {
	nameLen := len(name)
	if pad := nameLen % 4; pad != 0 {
		nameLen += 4 - pad
	}
	event := make([]byte, syscall.SizeofInotifyEvent+nameLen)
	binary.NativeEndian.PutUint32(event[0:4], uint32(wd))
	binary.NativeEndian.PutUint32(event[4:8], mask)
	binary.NativeEndian.PutUint32(event[12:16], uint32(nameLen))
	copy(event[syscall.SizeofInotifyEvent:], name)
	return append(buffer, event...)
}

func TestIsStructural(t *testing.T) {
	cases := []struct {
		name string
		mask uint32
		want bool
	}{
		{"create", syscall.IN_CREATE, true},
		{"create 带 IN_ISDIR", syscall.IN_CREATE | syscall.IN_ISDIR, true},
		{"delete", syscall.IN_DELETE, true},
		{"moved_from", syscall.IN_MOVED_FROM, true},
		{"moved_to", syscall.IN_MOVED_TO, true},
		{"delete_self", syscall.IN_DELETE_SELF, true},
		{"move_self", syscall.IN_MOVE_SELF, true},
		{"modify 不算", syscall.IN_MODIFY, false},
		{"close_write 不算", syscall.IN_CLOSE_WRITE, false},
		{"attrib 不算", syscall.IN_ATTRIB, false},
		{"ignored 不算", syscall.IN_IGNORED, false},
		{"q_overflow 不算", syscall.IN_Q_OVERFLOW, false},
		{"空 mask", 0, false},
	}
	for _, c := range cases {
		if got := isStructural(c.mask); got != c.want {
			t.Errorf("isStructural(%s)=%v，想要 %v", c.name, got, c.want)
		}
	}
}

func TestSplitInotifyEvents(t *testing.T) {
	buffer := packInotifyEvent(nil, 3, syscall.IN_CREATE, "a.txt")
	buffer = packInotifyEvent(buffer, -1, syscall.IN_Q_OVERFLOW, "")
	buffer = packInotifyEvent(buffer, 9, syscall.IN_MOVE_SELF, "longer-name.txt")

	want := []inotifyEvent{
		{wd: 3, mask: syscall.IN_CREATE},
		{wd: -1, mask: syscall.IN_Q_OVERFLOW},
		{wd: 9, mask: syscall.IN_MOVE_SELF},
	}
	got := splitInotifyEvents(buffer)
	if len(got) != len(want) {
		t.Fatalf("解析出 %d 条事件，想要 %d 条：%+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("第 %d 条事件是 %+v，想要 %+v", i, got[i], want[i])
		}
	}
	// 半条事件（缓冲区被切开）只能丢掉，不能越界
	if tail := splitInotifyEvents(buffer[:len(buffer)-1]); len(tail) != 2 {
		t.Errorf("截断的缓冲区解析出 %d 条事件，想要 2 条", len(tail))
	}
}

func TestWatchBatchMergeAndDedupe(t *testing.T) {
	batch := newWatchBatch()
	batch.note("a", "/x")
	batch.note("a", "/x")
	batch.note("a", "/y")
	batch.note("b", "/z")

	events := batch.take()
	if len(events) != 2 {
		t.Fatalf("发出 %d 条事件，想要 2 条：%+v", len(events), events)
	}
	if events[0].Type != "change" || events[0].ID != "a" || strings.Join(events[0].Paths, ",") != "/x,/y" {
		t.Errorf("第一条事件不对：%+v", events[0])
	}
	if events[1].Type != "change" || events[1].ID != "b" || strings.Join(events[1].Paths, ",") != "/z" {
		t.Errorf("第二条事件不对：%+v", events[1])
	}
	if again := batch.take(); len(again) != 0 {
		t.Errorf("take 之后应该是空的，却拿到 %+v", again)
	}
}

func TestWatchBatchChangePathLimitAndReset(t *testing.T) {
	// 正好达到上限仍发 change，超过才 reset。
	batch := newWatchBatch()
	for i := 0; i < watchMaxChangePaths; i++ {
		batch.note("a", pathN(i))
	}
	events := batch.take()
	if len(events) != 1 || events[0].Type != "change" || len(events[0].Paths) != watchMaxChangePaths {
		t.Fatalf("%d 个路径应该是 change，得到 %+v", watchMaxChangePaths, events)
	}

	// 超过上限换成 reset：逐条列不如让调用方重读。
	batch = newWatchBatch()
	for i := 0; i <= watchMaxChangePaths; i++ {
		batch.note("a", pathN(i))
	}
	batch.note("b", "/other")

	events = batch.take()
	if len(events) != 2 || events[0].Type != "reset" || events[0].ID != "a" ||
		events[0].Reason != watchReasonTooMany || events[1].ID != "b" {
		t.Fatalf("%d 个路径应该是 reset(%s)、b 照常 change，得到 %+v", watchMaxChangePaths+1, watchReasonTooMany, events)
	}
	// reset 是一次性的：它已经让调用方重读该 id 的全部内容，下一轮的新变化照常发 change
	batch.note("a", "/late")
	events = batch.take()
	if len(events) != 1 || events[0].Type != "change" || strings.Join(events[0].Paths, ",") != "/late" {
		t.Fatalf("reset 发出去之后的新变化应该照常发 change，得到 %+v", events)
	}
}

func TestWatchBatchOverflow(t *testing.T) {
	batch := newWatchBatch()
	batch.note("a", "/x")
	batch.overflow()

	events := batch.take()
	if len(events) != 1 || events[0].ID != "*" || events[0].Type != "reset" ||
		events[0].Reason != watchReasonOverflow {
		t.Fatalf("溢出应该广播一条 reset(*, %s)，得到 %+v", watchReasonOverflow, events)
	}
	batch.note("a", "/y")
	events = batch.take()
	if len(events) != 1 || events[0].ID != "a" || strings.Join(events[0].Paths, ",") != "/y" {
		t.Fatalf("溢出之后的新变化应该照常发，得到 %+v", events)
	}
	if again := batch.take(); len(again) != 0 {
		t.Errorf("广播不该重复发：%+v", again)
	}
}

func TestWatchFanoutPublish(t *testing.T) {
	fanout := newWatchFanout(testLogger())
	first := fanout.subscribe()
	second := fanout.subscribe()
	fanout.publish([]watchEvent{{Type: "change", ID: "a", Paths: []string{"/x"}}})
	for name, sub := range map[string]*watchSubscriber{"第一个": first, "第二个": second} {
		select {
		case event := <-sub.ch:
			if event.ID != "a" {
				t.Errorf("%s订阅者收到 %+v", name, event)
			}
		default:
			t.Errorf("%s订阅者没收到事件", name)
		}
	}
	fanout.publish(nil)
	select {
	case event := <-first.ch:
		t.Errorf("空事件不该发出去：%+v", event)
	default:
	}
	fanout.unsubscribe(first)
	fanout.publish([]watchEvent{{Type: "change", ID: "b"}})
	select {
	case event := <-first.ch:
		t.Errorf("退订之后不该再收到事件：%+v", event)
	default:
	}
}

func TestWatchFanoutSlowSubscriber(t *testing.T) {
	fanout := newWatchFanout(testLogger())
	slow := fanout.subscribe()
	fast := fanout.subscribe()
	// 只读 fast，把 slow 的队列灌满。发布方一次都不能被卡住。
	for i := 0; i < watchSubscriberQueue+1; i++ {
		fanout.publish([]watchEvent{{Type: "change", ID: "a", Paths: []string{"/x"}}})
		<-fast.ch
	}
	var got []watchEvent
	for {
		select {
		case event := <-slow.ch:
			got = append(got, event)
			continue
		default:
		}
		break
	}
	if len(got) != 2 {
		t.Fatalf("慢订阅者队列应该只剩 reset + 最后一条事件，得到 %d 条：%+v", len(got), got)
	}
	if got[0].Type != "reset" || got[0].ID != "*" || got[0].Reason != watchReasonSlowSub {
		t.Errorf("第一条应该是 reset(*, %s)，得到 %+v", watchReasonSlowSub, got[0])
	}
	if got[1].Type != "change" || got[1].ID != "a" {
		t.Errorf("第二条应该是最后那次 change，得到 %+v", got[1])
	}
}

func TestWatchHubHandleEvent(t *testing.T) {
	hub := newWatchHub(testLogger())
	defer hub.close()
	dir := &watchedDir{wd: 5, path: "/data/project", ids: map[string]bool{"a": true, "b": true}}
	hub.byWD[dir.wd] = dir
	hub.byPath[dir.path] = dir

	hub.handleEvent(inotifyEvent{wd: 5, mask: syscall.IN_MODIFY})
	if len(hub.batch.pending) != 0 {
		t.Fatalf("内容变化不该产生待发事件：%+v", hub.batch.pending)
	}
	hub.handleEvent(inotifyEvent{wd: 5, mask: syscall.IN_CREATE | syscall.IN_ISDIR})
	events := hub.batch.take()
	if len(events) != 2 {
		t.Fatalf("两个 id 都应该收到 change，得到 %+v", events)
	}
	hub.handleEvent(inotifyEvent{wd: 99, mask: syscall.IN_CREATE})
	if len(hub.batch.pending) != 0 {
		t.Fatalf("不认识的 wd 不该产生待发事件：%+v", hub.batch.pending)
	}
	hub.handleEvent(inotifyEvent{wd: -1, mask: syscall.IN_Q_OVERFLOW})
	if events := hub.batch.take(); len(events) != 1 || events[0].ID != "*" {
		t.Fatalf("溢出应该广播 reset(*)：%+v", events)
	}
}

func TestWatchSetValidation(t *testing.T) {
	s := &server{token: "0123456789abcdef", logger: testLogger(), watch: newWatchHub(testLogger())}
	defer s.watch.close()

	var manyPaths strings.Builder
	manyPaths.WriteString(`{"id":"a","paths":[`)
	for i := 0; i <= watchMaxPaths; i++ {
		if i > 0 {
			manyPaths.WriteString(",")
		}
		manyPaths.WriteString(`"/tmp/x"`)
	}
	manyPaths.WriteString(`]}`)

	cases := []struct {
		name string
		body string
	}{
		{"id 为空", `{"id":"","paths":[]}`},
		{"id 太长", `{"id":"` + strings.Repeat("i", watchMaxIDLength+1) + `","paths":[]}`},
		{"paths 太多", manyPaths.String()},
		{"相对路径", `{"id":"a","paths":["relative/dir"]}`},
		{"不是 JSON", `{"id":"a",`},
	}
	for _, c := range cases {
		recorder := httptest.NewRecorder()
		s.handleWatch(recorder, httptest.NewRequest(http.MethodPost, "/v1/watch", strings.NewReader(c.body)))
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("%s：状态码 %d，想要 400（%s）", c.name, recorder.Code, recorder.Body.String())
			continue
		}
		var payload struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil || payload.Error.Code != "bad_request" {
			t.Errorf("%s：错误体不对：%s", c.name, recorder.Body.String())
		}
	}

	recorder := httptest.NewRecorder()
	s.handleWatch(recorder, httptest.NewRequest(http.MethodPut, "/v1/watch", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Errorf("PUT 的状态码 %d，想要 405", recorder.Code)
	}

	// DELETE 幂等：没监视过的 id 也是 200 {"ok":true}，而且不该去建 inotify
	recorder = httptest.NewRecorder()
	s.handleWatch(recorder, httptest.NewRequest(http.MethodDelete, "/v1/watch?id=nobody", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"ok":true`) {
		t.Errorf("DELETE 未知 id 应该是 200 且 ok=true：%d %s", recorder.Code, recorder.Body.String())
	}
	if s.watch.fd >= 0 {
		t.Errorf("没人 watch 不该建 inotify fd")
	}
}

func pathN(i int) string {
	return fmt.Sprintf("/data/dir-%d", i)
}
