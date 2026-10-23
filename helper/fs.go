package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const (
	statBatchLimit = 512
	bodyLimit      = 1 << 20
	// access(2) 的 R_OK；syscall 包没有导出这个常量。
	accessRead = 4
)

type dirEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Directory  bool   `json:"directory"`
	Size       int64  `json:"size"`
	ModifiedAt int64  `json:"modifiedAt"`
}

type statEntry struct {
	Path      string `json:"path"`
	Exists    bool   `json:"exists"`
	Directory bool   `json:"directory"`
	// Readable：当前用户能否打开它（文件可读、目录可列），替代 `test -r`。
	Readable   bool  `json:"readable"`
	Size       int64 `json:"size"`
	ModifiedAt int64 `json:"modifiedAt"`
}

// 只接受绝对路径：远端工具的 cwd 语义由调用方（Dela）自己保证，helper 不猜相对路径。
func requireAbsPath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", errors.New("缺少 path")
	}
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("必须是绝对路径：%s", path)
	}
	if strings.ContainsRune(path, '\x00') {
		return "", errors.New("路径含非法字符")
	}
	return filepath.Clean(path), nil
}

func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, bodyLimit)).Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "请求体不是合法 JSON")
		return false
	}
	return true
}

func queryInt(r *http.Request, name string, fallback int64) (int64, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("%s 必须是非负整数", name)
	}
	return value, nil
}

// 列一层：用 os.ReadDir 的 lstat 语义（符号链接算文件）。
// 带 `"locate": true` 时路径不是目录也不报错，而是回答它是什么（kind: directory/file/missing）：
// 向导的目录选择器一次请求就要知道「存在吗、是目录吗、里面有什么」。
func (s *server) handleList(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path   string `json:"path"`
		Locate bool   `json:"locate"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	path, err := requireAbsPath(req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_path", err.Error())
		return
	}
	if req.Locate {
		info, err := os.Stat(path)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"path": path, "kind": "missing"})
			return
		}
		if !info.IsDir() {
			writeJSON(w, http.StatusOK, map[string]any{"path": path, "kind": "file"})
			return
		}
	}
	entries, err := listEntries(path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "kind": "directory", "entries": entries})
}

func listEntries(path string) ([]dirEntry, error) {
	items, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	entries := make([]dirEntry, 0, len(items))
	for _, item := range items {
		info, err := item.Info()
		if err != nil {
			continue // 单条读不到不该让整层失败
		}
		entries = append(entries, dirEntry{
			Name:       info.Name(),
			Path:       filepath.Join(path, info.Name()),
			Directory:  info.IsDir(),
			Size:       info.Size(),
			ModifiedAt: info.ModTime().UnixMilli(),
		})
	}
	return entries, nil
}

func (s *server) handleStat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Paths []string `json:"paths"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "paths 不能为空")
		return
	}
	if len(req.Paths) > statBatchLimit {
		writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("一次最多 %d 个路径", statBatchLimit))
		return
	}
	items := make([]statEntry, 0, len(req.Paths))
	for _, raw := range req.Paths {
		path, err := requireAbsPath(raw)
		if err != nil {
			items = append(items, statEntry{Path: raw})
			continue
		}
		info, err := os.Lstat(path)
		if err != nil {
			items = append(items, statEntry{Path: path})
			continue
		}
		items = append(items, statEntry{
			Path:       path,
			Exists:     true,
			Directory:  info.IsDir(),
			Readable:   syscall.Access(path, accessRead) == nil,
			Size:       info.Size(),
			ModifiedAt: info.ModTime().UnixMilli(),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// 片段读取：offset/length 都是可选的，length 省略或为 0 表示读到结尾。
func (s *server) handleRead(w http.ResponseWriter, r *http.Request) {
	path, err := requireAbsPath(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_path", err.Error())
		return
	}
	offset, err := queryInt(r, "offset", 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	length, err := queryInt(r, "length", 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	file, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusNotFound, "open_failed", err.Error())
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "stat_failed", err.Error())
		return
	}
	if info.IsDir() {
		writeError(w, http.StatusBadRequest, "is_directory", "目录不能按文件读取")
		return
	}
	if offset > info.Size() {
		writeError(w, http.StatusRequestedRangeNotSatisfiable, "bad_range",
			fmt.Sprintf("offset 超出文件大小（%d > %d）", offset, info.Size()))
		return
	}
	if offset > 0 {
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			writeError(w, http.StatusInternalServerError, "seek_failed", err.Error())
			return
		}
	}
	remaining := info.Size() - offset
	want := remaining
	if length > 0 && length < remaining {
		want = length
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(want, 10))
	w.Header().Set("X-Dela-File-Size", strconv.FormatInt(info.Size(), 10))
	w.WriteHeader(http.StatusOK)
	if _, err := io.CopyN(w, file, want); err != nil {
		s.logger.Printf("发送 %s 中断：%v", path, err)
	}
}

// 原子写：同目录临时文件 + rename，避免 Dela 读到写了一半的文件。
// `parents=1` 时先建缺失的父目录：agent 的 write 工具要 mkdir -p 语义，省一次往返。
func (s *server) handleWrite(w http.ResponseWriter, r *http.Request) {
	path, err := requireAbsPath(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_path", err.Error())
		return
	}
	dir := filepath.Dir(path)
	if r.URL.Query().Get("parents") == "1" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			writeError(w, http.StatusBadRequest, "mkdir_failed", err.Error())
			return
		}
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		writeError(w, http.StatusBadRequest, "no_directory", fmt.Sprintf("目录不存在：%s", dir))
		return
	}
	temp, err := os.CreateTemp(dir, ".dela-tmp-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "temp_failed", err.Error())
		return
	}
	tempName := temp.Name()
	defer func() {
		if tempName != "" {
			os.Remove(tempName)
		}
	}()
	size, copyErr := io.Copy(temp, r.Body)
	closeErr := temp.Close()
	if copyErr != nil || closeErr != nil {
		writeError(w, http.StatusInternalServerError, "write_failed", fmt.Sprint(copyErr, closeErr))
		return
	}
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	if err := os.Chmod(tempName, mode); err != nil {
		writeError(w, http.StatusInternalServerError, "chmod_failed", err.Error())
		return
	}
	if err := os.Rename(tempName, path); err != nil {
		writeError(w, http.StatusInternalServerError, "rename_failed", err.Error())
		return
	}
	tempName = ""
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "size": size})
}
