package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	// 一次 POST 的 paths 上限：Dela 每次重发当前展开的全部目录，给足余量即可。
	watchMaxPaths    = 4096
	watchMaxIDLength = 128
	// 读缓冲区：一次 read 尽量把内核队列取空，少几次系统调用。
	watchReadBuffer = 64 << 10
	// 等 inotify 可读的超时。有事件时 epoll 立刻返回，这个超时只是让读循环能定期看到 stop。
	watchWaitMs = 200
	// 事件流上的保活间隔。见 watchStream 里的说明。
	watchKeepAlive = 30 * time.Second
)

// watchMask 只订结构变化。远端文件树只显示名字与类型，构建工具写文件产生的 IN_MODIFY /
// IN_CLOSE_WRITE 不需要刷新，订了只会把事件量放大几个数量级。
// IN_DELETE_SELF / IN_MOVE_SELF 是「被监视的目录本身没了」，必须报，否则树里会留着不存在的目录。
const watchMask = syscall.IN_CREATE | syscall.IN_DELETE | syscall.IN_MOVED_FROM |
	syscall.IN_MOVED_TO | syscall.IN_DELETE_SELF | syscall.IN_MOVE_SELF

func isStructural(mask uint32) bool { return mask&watchMask != 0 }

// inotifyEvent 只留判定要用的两个字段。name 是发生变化的具体子项，而协议上报的是目录本身，
// 所以解析时只按 len 跳过它（len 已经包含内核补齐的对齐字节）。
type inotifyEvent struct {
	wd   int32
	mask uint32
}

// 每条 inotify 事件的总长天然是 4 字节的倍数，循环不会在名字中间切开。
func splitInotifyEvents(buffer []byte) []inotifyEvent {
	events := make([]inotifyEvent, 0, len(buffer)/syscall.SizeofInotifyEvent)
	for len(buffer) >= syscall.SizeofInotifyEvent {
		size := syscall.SizeofInotifyEvent + int(binary.NativeEndian.Uint32(buffer[12:16]))
		if size > len(buffer) {
			break // 只可能是半条事件，丢掉比越界好
		}
		events = append(events, inotifyEvent{
			wd:   int32(binary.NativeEndian.Uint32(buffer[0:4])),
			mask: binary.NativeEndian.Uint32(buffer[4:8]),
		})
		buffer = buffer[size:]
	}
	return events
}

// watchHub 持有进程里唯一的 inotify 实例，fd 惰性创建：没人 watch 就不占内核资源。
// 目录与 id 是多对多（Dela 可能有多个 id 看着同一棵树），所以按路径做全局记账，
// 同一目录只加一次内核 watch，watchedDir.ids 的大小就是引用计数；否则重复的 watch 会
// 先把 inotify 额度耗光，再让删除时的解引用变得没法对账。
type watchHub struct {
	logger *log.Logger
	fanout *watchFanout

	stop     chan struct{}
	stopOnce sync.Once

	mu      sync.Mutex
	stopped bool
	fd      int // -1 表示还没建；只有 inotifyLoop 会把它们关掉并置回 -1
	epfd    int
	byWD    map[int32]*watchedDir
	byPath  map[string]*watchedDir
	sets    map[string]map[string]bool // id -> 正在看的目录集合
	batch   watchBatch
}

type watchedDir struct {
	wd   int32
	path string
	ids  map[string]bool
}

func newWatchHub(logger *log.Logger) *watchHub {
	return &watchHub{
		logger: logger,
		fanout: newWatchFanout(logger),
		stop:   make(chan struct{}),
		fd:     -1,
		epfd:   -1,
		byWD:   map[int32]*watchedDir{},
		byPath: map[string]*watchedDir{},
		sets:   map[string]map[string]bool{},
		batch:  newWatchBatch(),
	}
}

// set 把 id 的监视集合整体替换成 paths，返回真正在看的目录数与跳过的路径。
// 跳过的（不存在、不是目录、inotify 额度不足）不进集合，所以调用方下次 POST 同一批路径会再试一次。
func (h *watchHub) set(id string, paths []string) (int, []string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopped {
		return 0, nil, errors.New("helper 正在退出")
	}
	if err := h.ensureLocked(); err != nil {
		return 0, nil, err
	}
	wanted := make(map[string]bool, len(paths))
	skipped := make([]string, 0)
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() {
			skipped = append(skipped, path)
			continue
		}
		wanted[path] = true // 调用方可能重复送同一个目录
	}
	current := h.sets[id]
	if current == nil {
		current = map[string]bool{}
		h.sets[id] = current
	}
	// 先摘后加：换一批目录时不会短暂地同时占着新旧两份额度。
	for path := range current {
		if !wanted[path] {
			h.releaseLocked(id, path)
		}
	}
	watching := 0
	for path := range wanted {
		if current[path] {
			watching++ // 已经在看，不重复加内核 watch
			continue
		}
		if err := h.attachLocked(id, path); err != nil {
			h.logger.Printf("监视 %s 失败：%v", path, err)
			skipped = append(skipped, path)
			continue
		}
		watching++
	}
	sort.Strings(skipped)
	return watching, skipped, nil
}

// forgetID 停止 id 的全部监视。幂等：id 不存在也当成功（调用方可能重复 DELETE）。
func (h *watchHub) forgetID(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for path := range h.sets[id] {
		h.releaseLocked(id, path)
	}
	delete(h.sets, id)
	delete(h.batch.pending, id) // 已经不看这些目录了，别再往调用方那边发
}

// attachLocked 让 id 看住 path。同一路径已经有人看时只是加一个引用。
func (h *watchHub) attachLocked(id, path string) error {
	if dir := h.byPath[path]; dir != nil {
		dir.ids[id] = true
		h.sets[id][path] = true
		return nil
	}
	// IN_ONLYDIR：Stat 与加 watch 之间目录可能被换成文件，有这个标志就不会误把文件当目录看。
	wd, err := syscall.InotifyAddWatch(h.fd, path, watchMask|syscall.IN_ONLYDIR)
	if err != nil {
		return err
	}
	dir := &watchedDir{wd: int32(wd), path: path, ids: map[string]bool{id: true}}
	h.byWD[dir.wd] = dir
	h.byPath[dir.path] = dir
	h.sets[id][path] = true
	return nil
}

// releaseLocked 解除 id 对 path 的引用；没有别的 id 在看就摘掉内核 watch，避免泄漏。
func (h *watchHub) releaseLocked(id, path string) {
	dir := h.byPath[path]
	if dir == nil {
		return
	}
	delete(dir.ids, id)
	if set := h.sets[id]; set != nil {
		delete(set, path)
	}
	if len(dir.ids) == 0 {
		h.forgetLocked(dir)
	}
}

// forgetLocked 摘掉一个内核 watch 与它的记账（引用计数到 0）。
func (h *watchHub) forgetLocked(dir *watchedDir) {
	h.dropLocked(dir)
	if h.fd < 0 {
		return
	}
	// EINVAL：内核已经自己摘掉了（目录被删/移走后的 IN_IGNORED），不是问题。
	if _, err := syscall.InotifyRmWatch(h.fd, uint32(dir.wd)); err != nil && !errors.Is(err, syscall.EINVAL) {
		h.logger.Printf("摘除 watch %s 失败：%v", dir.path, err)
	}
}

// dropLocked 只丢记账，不碰内核。
func (h *watchHub) dropLocked(dir *watchedDir) {
	delete(h.byWD, dir.wd)
	delete(h.byPath, dir.path)
}

// ensureLocked 惰性建 inotify 实例（调用方持锁）。用 epoll 而不是阻塞 read，是因为关 fd 唤不醒
// 卡在 read 里的 goroutine；epoll 带超时，读循环就能定期看到 stop。
func (h *watchHub) ensureLocked() error {
	if h.fd >= 0 {
		return nil
	}
	fd, err := syscall.InotifyInit1(syscall.IN_CLOEXEC | syscall.IN_NONBLOCK)
	if err != nil {
		return fmt.Errorf("inotify 不可用：%w", err)
	}
	epfd, err := syscall.EpollCreate1(syscall.EPOLL_CLOEXEC)
	if err != nil {
		syscall.Close(fd)
		return fmt.Errorf("epoll 不可用：%w", err)
	}
	if err := syscall.EpollCtl(epfd, syscall.EPOLL_CTL_ADD, fd, &syscall.EpollEvent{
		Events: syscall.EPOLLIN,
		Fd:     int32(fd),
	}); err != nil {
		syscall.Close(epfd)
		syscall.Close(fd)
		return fmt.Errorf("监听 inotify 失败：%w", err)
	}
	h.fd, h.epfd = fd, epfd
	go h.mergeLoop()
	go h.inotifyLoop(fd, epfd)
	return nil
}

// close 在 helper 退出时调用：只发停止信号，fd 由读循环自己关（谁开的谁关，
// 免得关到已经被别的请求复用的 fd 号）。读循环最多等一个 watchWaitMs 就收尾。
func (h *watchHub) close() {
	h.stopOnce.Do(func() {
		h.mu.Lock()
		h.stopped = true
		h.mu.Unlock()
		close(h.stop)
	})
}

// inotifyLoop 是唯一的读者，退出时负责关掉自己的 fd。
func (h *watchHub) inotifyLoop(fd, epfd int) {
	buffer := make([]byte, watchReadBuffer)
	ready := make([]syscall.EpollEvent, 8)
	for {
		select {
		case <-h.stop:
			h.closeFDs(fd, epfd)
			return
		default:
		}
		count, err := syscall.EpollWait(epfd, ready, watchWaitMs)
		if err != nil {
			if errors.Is(err, syscall.EINTR) {
				continue
			}
			h.closeFDs(fd, epfd) // EBADF 之类：fd 已经没了
			return
		}
		if count <= 0 {
			continue
		}
		h.drain(fd, buffer)
	}
}

// drain 读到 EAGAIN 为止：epoll 是水平触发，一次可读就该把队列读空。
func (h *watchHub) drain(fd int, buffer []byte) {
	for {
		count, err := syscall.Read(fd, buffer)
		if count > 0 {
			for _, event := range splitInotifyEvents(buffer[:count]) {
				h.handleEvent(event)
			}
		}
		switch {
		case errors.Is(err, syscall.EAGAIN):
			return
		case errors.Is(err, syscall.EINTR):
			continue
		case err != nil:
			h.logger.Printf("读 inotify 失败：%v", err)
			return
		case count == 0:
			return
		}
	}
}

func (h *watchHub) closeFDs(fd, epfd int) {
	h.mu.Lock()
	if h.fd == fd {
		h.fd, h.epfd = -1, -1
	}
	h.mu.Unlock()
	syscall.Close(epfd)
	syscall.Close(fd)
}

// handleEvent 处理一条 inotify 事件。wd == -1 是内核队列溢出：丢的是哪几条不知道，只能整块重读。
func (h *watchHub) handleEvent(event inotifyEvent) {
	if event.wd < 0 || event.mask&syscall.IN_Q_OVERFLOW != 0 {
		h.mu.Lock()
		h.batch.overflow()
		h.mu.Unlock()
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	dir := h.byWD[event.wd]
	if dir == nil {
		return // 已经被摘掉的 watch 的尾巴事件
	}
	if isStructural(event.mask) {
		for id := range dir.ids {
			h.batch.note(id, dir.path)
		}
	}
	if event.mask&syscall.IN_IGNORED != 0 {
		// 目录被删/被移走时内核自己摘掉了 watch。记账跟着作废：目录可能再回来，
		// 所以连 id 的集合一起清掉，调用方下一次 POST 同一批路径时会重新加上 watch。
		for id := range dir.ids {
			delete(h.sets[id], dir.path)
		}
		h.dropLocked(dir)
	}
}

// mergeLoop 是唯一的发布者：每 200ms 把攒下的变化合成事件发出去。
func (h *watchHub) mergeLoop() {
	ticker := time.NewTicker(watchMergeWindow)
	defer ticker.Stop()
	for {
		select {
		case <-h.stop:
			return
		case <-ticker.C:
			h.mu.Lock()
			events := h.batch.take()
			h.mu.Unlock()
			h.fanout.publish(events)
		}
	}
}

func (s *server) handleWatch(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		s.watchSet(w, r)
	case http.MethodDelete:
		s.watchForget(w, r)
	case http.MethodGet:
		s.watchStream(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "只支持 POST/DELETE/GET")
	}
}

// POST /v1/watch：把 id 的整套监视集合换成 paths。幂等，同一个 id 重复 POST 只留最后一次。
func (s *server) watchSet(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID    string   `json:"id"`
		Paths []string `json:"paths"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	id := strings.TrimSpace(req.ID)
	if len(id) == 0 || len(id) > watchMaxIDLength {
		writeError(w, http.StatusBadRequest, "bad_request",
			fmt.Sprintf("id 长度需要在 1 到 %d 之间", watchMaxIDLength))
		return
	}
	if len(req.Paths) > watchMaxPaths {
		writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("一次最多 %d 个路径", watchMaxPaths))
		return
	}
	paths := make([]string, 0, len(req.Paths))
	for _, raw := range req.Paths {
		path, err := requireAbsPath(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		paths = append(paths, path)
	}
	watching, skipped, err := s.watch.set(id, paths)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "watch_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"watching": watching, "skipped": skipped})
}

// DELETE /v1/watch?id=：停掉 id 的监视。id 不存在也算成功。
func (s *server) watchForget(w http.ResponseWriter, r *http.Request) {
	s.watch.forgetID(strings.TrimSpace(r.URL.Query().Get("id")))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GET /v1/watch：SSE。事件就是 JSON，change 让调用方重读这几个目录层，
// reset 让它重读该 id（或所有 id）下面的全部内容。
func (s *server) watchStream(w http.ResponseWriter, r *http.Request) {
	// 先订阅再写响应头：这中间的窗口里的事件会进队列，不会丢。
	sub := s.watch.fanout.subscribe()
	defer s.watch.fanout.unsubscribe(sub)

	stream := openStream(w)
	if stream == nil {
		return
	}
	// 立刻把响应头刷出去。net/http 是懒发送：不刷的话要等第一条事件客户端才拿得到响应，
	// 「流已建立」和「第一条变化」就分不开了（Dela 侧只能一直等）。
	stream.flusher.Flush()

	// 保活：安静的目录可能几小时没有结构变化，而 Dela 侧把「这条流多久没有字节」当作
	// 隧道半死的信号（心跳走的是另一条请求，不给这条流带数据）。注释帧不算事件，
	// 客户端只认 data: 前缀，所以它既续了看门狗，又不会被当成变化。
	keepAlive := time.NewTicker(watchKeepAlive)
	defer keepAlive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepAlive.C:
			stream.comment("keep-alive")
			if stream.failed() {
				return
			}
		case event := <-sub.ch:
			stream.send(event)
			if stream.failed() {
				return
			}
		}
	}
}
