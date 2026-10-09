// dela-helper 是 Dela 在远端运行的常驻工具服务：只绑回环地址，由 Dela 经 `ssh -L`
// 隧道访问，每个请求都要带 token。它不做沙箱：权限就是启动它的那个 SSH 用户的权限，
// 与一次性的 `ssh <host> <命令>` 完全一致。协议见 docs/remote-helper.md。
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
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	protocolVersion = 1
	helperVersion   = "0.1.0"
	idleTick        = 10 * time.Second
	minTokenLength  = 16
)

type server struct {
	token  string
	idle   time.Duration
	logger *log.Logger
	http   *http.Server

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
	mux.HandleFunc("/v1/fs/hash", s.auth(s.handleHash))
	mux.HandleFunc("/v1/exec", s.auth(s.handleExec))
	mux.HandleFunc("/v1/exec/", s.auth(s.handleExecAction))
	mux.HandleFunc("/v1/tasks", s.auth(s.handleTasks))
}

func (s *server) handleHello(w http.ResponseWriter, r *http.Request) {
	home, _ := os.UserHomeDir()
	writeJSON(w, http.StatusOK, map[string]any{
		"protocol":      protocolVersion,
		"helperVersion": helperVersion,
		"pid":           os.Getpid(),
		"platform":      runtime.GOOS + "/" + runtime.GOARCH,
		"home":          home,
		"features": []string{
			"fs.list", "fs.stat.batch", "fs.read.range", "fs.write.atomic", "fs.hash",
			"exec.stream", "exec.cancel", "tasks", "heartbeat",
		},
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
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.http.Shutdown(ctx); err != nil {
		s.logger.Printf("关闭服务出错：%v", err)
	}
}

// idleLoop 的空闲判定用的是「最后一次收到请求」，所以客户端靠心跳保活，长任务不会把自己算成空闲。
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
	runFile := flag.String("run-file", "", "把端口与 pid 写到这个文件，仅用于排查残留进程")
	idle := flag.Duration("idle-timeout", 5*time.Minute, "这么久收不到任何请求就退出，并终止在跑的任务")
	showVersion := flag.Bool("version", false, "打印版本后退出")
	flag.Parse()

	logger := log.New(os.Stderr, "dela-helper: ", log.LstdFlags)
	if *showVersion {
		fmt.Println(helperVersion)
		return
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
		lastSeen: time.Now(),
		tasks:    map[string]*task{},
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
