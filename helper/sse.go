package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// sseWriter 串行化同一条流上的多个写者：同一个 ResponseWriter 不能并发写。
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

// 长驻的流靠它早一步发现连接已坏。
func (s *sseWriter) failed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.broken
}

// SSE 注释帧（客户端忽略），用于安静连接上的保活。
func (s *sseWriter) comment(text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.broken {
		return
	}
	if _, err := fmt.Fprintf(s.w, ": %s\n\n", text); err != nil {
		s.broken = true
		return
	}
	s.flusher.Flush()
}

// openStream 写好 SSE 响应头；连接不支持流式时已经写了错误，返回 nil。
func openStream(w http.ResponseWriter) *sseWriter {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "no_stream", "当前连接不支持流式响应")
		return nil
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	return &sseWriter{w: w, flusher: flusher}
}
