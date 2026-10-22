// dela-helper 是 Dela 在远端运行的常驻 runtime：远程项目的全部工具调用都经它执行。只绑回环地址，
// 由 Dela 经 `ssh -L` 隧道访问，每个请求带 token。它的生命周期不随隧道：断线期间任务照跑，
// Dela 重连后复用同一个实例并接回任务；连续一段时间没有任何请求才退出。
// 它不做沙箱：权限就是启动它的 SSH 用户的权限（与 `ssh <host> <命令>` 一致）。协议见 helper/README.md。
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	protocolVersion = 2
	helperVersion   = "0.3.1"
	idleTick        = 10 * time.Second
	minTokenLength  = 16
)

type server struct {
	token  string
	idle   time.Duration
	logger *log.Logger
	http   *http.Server
	// bound：自己监听的端口。端口发现要把它从清单里排除（用户要预览的是别的服务）。
	bound int

	watch *watchHub

	mu       sync.Mutex
	lastSeen time.Time
	tasks    map[string]*task
	order    []string
	stopping bool
}

func (s *server) touch() {
	s.mu.Lock()
	s.lastSeen = time.Now()
	s.mu.Unlock()
}

func (s *server) idleFor() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return time.Since(s.lastSeen)
}

// auth：token 只放在 0600 文件里，不从命令行读（命令行会出现在 ps 里）。
func (s *server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "缺少或错误的 token")
			return
		}
		s.touch()
		next(w, r)
	}
}

func (s *server) register(mux *http.ServeMux) {
	mux.HandleFunc("/v1/hello", s.auth(s.handleHello))
	mux.HandleFunc("/v1/heartbeat", s.auth(s.handleHeartbeat))
	mux.HandleFunc("/v1/fs/list", s.auth(s.handleList))
	mux.HandleFunc("/v1/fs/stat", s.auth(s.handleStat))
	mux.HandleFunc("/v1/fs/read", s.auth(s.handleRead))
	mux.HandleFunc("/v1/fs/write", s.auth(s.handleWrite))
	mux.HandleFunc("/v1/watch", s.auth(s.handleWatch))
	mux.HandleFunc("/v1/ports", s.auth(s.handlePorts))
	mux.HandleFunc("/v1/fs/glob", s.auth(s.handleGlob))
	mux.HandleFunc("/v1/fs/search", s.auth(s.handleSearch))
	mux.HandleFunc("/v1/tasks", s.auth(s.handleTasks))
	mux.HandleFunc("/v1/tasks/", s.auth(s.handleTaskAction))
}

// hello 说握手需要的东西（版本对不上就不该继续用这条通道），外加主目录：
// 目录选择器从这里起步，省掉一次单独的 ssh 往返。
func (s *server) handleHello(w http.ResponseWriter, r *http.Request) {
	home, _ := os.UserHomeDir()
	writeJSON(w, http.StatusOK, map[string]any{
		"protocol":      protocolVersion,
		"helperVersion": helperVersion,
		"home":          home,
	})
}

func (s *server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *server) stop(reason string) {
	s.mu.Lock()
	if s.stopping {
		s.mu.Unlock()
		return
	}
	s.stopping = true
	s.mu.Unlock()

	s.logger.Printf("退出：%s", reason)
	s.cancelAllTasks("服务退出")
	s.watch.close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.http.Shutdown(ctx); err != nil {
		s.logger.Printf("关闭服务出错：%v", err)
	}
}

// idleLoop 的空闲判定用的是「最后一次收到请求」：Dela 开着就有心跳，所以计时等于从最后一个
// 客户端断开算起。在跑的任务不续命——跑偏的任务不该把 helper 一直挂在服务器上。
func (s *server) idleLoop() {
	ticker := time.NewTicker(idleTick)
	defer ticker.Stop()
	for range ticker.C {
		if s.idleFor() <= s.idle {
			continue
		}
		s.stop(fmt.Sprintf("连续 %s 没有任何请求", s.idle))
		return
	}
}

func main() {
	port := flag.Int("port", 0, "监听端口；0 表示由系统分配")
	tokenFile := flag.String("token-file", "", "存放访问 token 的文件（至少 16 字节）")
	runFile := flag.String("run-file", "", "把端口、pid 与版本写到这个文件：Dela 重连时据此复用这个实例")
	lockFile := flag.String("lock-file", "", "启动时独占加锁的文件：同一目录只允许一个实例")
	idle := flag.Duration("idle-timeout", time.Hour, "这么久收不到任何请求就退出，并终止在跑的任务")
	showVersion := flag.Bool("version", false, "打印版本后退出")
	flag.Parse()

	logger := log.New(os.Stderr, "dela-helper: ", log.LstdFlags)
	if *showVersion {
		fmt.Println(helperVersion)
		return
	}

	// 锁要在读 token 之前拿：两个 Dela 同时连上来时，没抢到锁的那个直接退出（退出码 3），
	// 启动脚本据此改为复用已在跑的实例。锁随进程退出由内核释放。
	if *lockFile != "" {
		if err := acquireLock(*lockFile); err != nil {
			logger.Printf("已有实例在运行：%v", err)
			os.Exit(3)
		}
	}
	token, err := readToken(*tokenFile)
	if err != nil {
		logger.Fatalf("token 不可用：%v", err)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		logger.Fatalf("监听失败：%v", err)
	}
	bound := listener.Addr().(*net.TCPAddr).Port
	s := &server{
		token:    token,
		idle:     *idle,
		logger:   logger,
		bound:    bound,
		lastSeen: time.Now(),
		tasks:    map[string]*task{},
		watch:    newWatchHub(logger),
	}
	mux := http.NewServeMux()
	s.register(mux)
	s.http = &http.Server{Handler: mux, ReadHeaderTimeout: 15 * time.Second}

	if *runFile != "" {
		if err := writeRunFile(*runFile, bound, os.Getpid()); err != nil {
			logger.Printf("写 run-file 失败：%v", err)
		}
		defer os.Remove(*runFile)
	}
	// Dela 读这一行拿到端口：格式固定，改动必须同步 Dela 侧的解析。
	fmt.Printf("DELA-HELPER port=%d pid=%d version=%s\n", bound, os.Getpid(), helperVersion)

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signals
		s.stop("收到信号")
	}()
	go s.idleLoop()

	if err := s.http.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Fatalf("服务异常结束：%v", err)
	}
}

type runState struct {
	Port    int    `json:"port"`
	PID     int    `json:"pid"`
	Version string `json:"version"`
}

// acquireLock 用 flock 独占加锁，不阻塞；fd 故意不关，进程活着锁就在。
func acquireLock(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return err
	}
	return nil
}

func writeRunFile(path string, port, pid int) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	body, err := json.Marshal(runState{Port: port, PID: pid, Version: helperVersion})
	if err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o600)
}

func readToken(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("需要 --token-file")
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	token := strings.TrimSpace(string(body))
	if len(token) < minTokenLength {
		return "", fmt.Errorf("token 至少 %d 字节", minTokenLength)
	}
	return token, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("写响应失败：%v", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
