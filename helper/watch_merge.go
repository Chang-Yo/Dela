package main

import (
	"log"
	"sort"
	"sync"
	"time"
)

const (
	// 合并窗口：npm install / git checkout 会在几百毫秒里造出上万次结构变化，
	// 窗口太小会把它们打成碎片发给 Dela。
	watchMergeWindow = 200 * time.Millisecond
	// 单条 change 最多带这么多目录。再多就不值得逐条列：让调用方整块重读更便宜。
	watchMaxChangePaths = 256
	// 每个订阅者的队列长度。进程内订阅者数量不设限（Dela 侧自己管），但队列必须有界。
	watchSubscriberQueue = 256
)

// change = 这些目录的直接子项可能变了，reset = 这些内容都要重读；reason 仅供调用方排查。
const (
	watchReasonOverflow = "overflow"         // 内核队列溢出：所有 id 都得重读
	watchReasonTooMany  = "too-many-changes" // 单批路径超过 watchMaxChangePaths
	watchReasonSlowSub  = "subscriber-slow"  // 某个订阅者读得太慢，它的队列被丢弃
)

// watchEvent 是 SSE 里 data: 后面的 JSON，形状由 Dela 侧定死。
type watchEvent struct {
	Type   string   `json:"type"`
	ID     string   `json:"id"`
	Paths  []string `json:"paths,omitempty"`
	Reason string   `json:"reason,omitempty"`
}

// 纯集合运算，不碰 inotify，单测可以直接喂；并发安全由调用方（watchHub 的 mu）负责。
type watchBatch struct {
	pending map[string]*watchPending
	global  string // 非空 = 所有 id 都要重读（内核溢出）
}

type watchPending struct {
	paths map[string]bool
	reset string
}

func newWatchBatch() watchBatch {
	return watchBatch{pending: map[string]*watchPending{}}
}

// 明细长度天然有界：只在这个 id 正被监视的目录上调用，目录数由 watch.go 的 watchMaxPaths 封顶。
func (b *watchBatch) note(id, path string) {
	p := b.pending[id]
	if p == nil {
		p = &watchPending{paths: map[string]bool{}}
		b.pending[id] = p
	}
	if p.reset != "" || p.paths[path] {
		return
	}
	p.paths[path] = true
}

// overflow 处理内核队列溢出：溢出之后哪条事件丢了是不知道的，所以明细一律作废。
func (b *watchBatch) overflow() {
	b.pending = map[string]*watchPending{}
	b.global = watchReasonOverflow
}

// 一个 id 一轮最多一条事件：reset 优先于 change。
func (b *watchBatch) take() []watchEvent {
	pending := b.pending
	b.pending = map[string]*watchPending{}
	events := make([]watchEvent, 0, len(pending)+1)
	if b.global != "" {
		events = append(events, watchEvent{Type: "reset", ID: "*", Reason: b.global})
		b.global = ""
	}
	ids := make([]string, 0, len(pending))
	for id := range pending {
		ids = append(ids, id)
	}
	sort.Strings(ids) // 顺序固定，日志和单测都好读
	for _, id := range ids {
		event, ok := pending[id].event(id)
		if ok {
			events = append(events, event)
		}
	}
	return events
}

func (p *watchPending) event(id string) (watchEvent, bool) {
	if p.reset != "" {
		return watchEvent{Type: "reset", ID: id, Reason: p.reset}, true
	}
	if len(p.paths) == 0 {
		return watchEvent{}, false
	}
	if len(p.paths) > watchMaxChangePaths {
		return watchEvent{Type: "reset", ID: id, Reason: watchReasonTooMany}, true
	}
	paths := make([]string, 0, len(p.paths))
	for path := range p.paths {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return watchEvent{Type: "change", ID: id, Paths: paths}, true
}

// 发布绝不阻塞：读得慢的订阅者只丢自己的事件，补一条 reset 顶替——它错过了哪几条已算不出来。
type watchFanout struct {
	logger *log.Logger

	mu   sync.Mutex
	subs map[*watchSubscriber]bool
}

type watchSubscriber struct {
	ch chan watchEvent
}

func newWatchFanout(logger *log.Logger) *watchFanout {
	return &watchFanout{logger: logger, subs: map[*watchSubscriber]bool{}}
}

func (f *watchFanout) subscribe() *watchSubscriber {
	sub := &watchSubscriber{ch: make(chan watchEvent, watchSubscriberQueue)}
	f.mu.Lock()
	f.subs[sub] = true
	f.mu.Unlock()
	return sub
}

func (f *watchFanout) unsubscribe(sub *watchSubscriber) {
	f.mu.Lock()
	delete(f.subs, sub)
	f.mu.Unlock()
}

func (f *watchFanout) publish(events []watchEvent) {
	if len(events) == 0 {
		return
	}
	// 锁里只做非阻塞发送：所有通道写都在同一把锁下，订阅者不会被并发写。
	f.mu.Lock()
	defer f.mu.Unlock()
	for sub := range f.subs {
		for _, event := range events {
			f.send(sub, event)
		}
	}
}

func (f *watchFanout) send(sub *watchSubscriber, event watchEvent) {
	select {
	case sub.ch <- event:
		return
	default:
	}
	// 队列满：整个丢掉，换成一条 reset。排空之后队列必然有空位，这条 reset 一定放得进去。
	dropped := 0
drain:
	for {
		select {
		case <-sub.ch:
			dropped++
		default:
			break drain
		}
	}
	f.logger.Printf("订阅者落后，丢弃 %d 条事件并改发 reset", dropped)
	select {
	case sub.ch <- watchEvent{Type: "reset", ID: "*", Reason: watchReasonSlowSub}:
	default:
	}
	select {
	case sub.ch <- event:
	default:
	}
}
