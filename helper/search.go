package main

// 文件查找与内容搜索：agent 的 find / grep 工具。有 ripgrep 就交给它（快、懂 .gitignore），
// 没有就在 Go 里遍历——两条路返回同一种结构，Dela 不需要知道远端装没装 rg。
// 两条路的忽略规则不完全一样：rg 额外遵守 .gitignore，Go 遍历只跳过 .git 与 node_modules。

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	// 单次请求的上限：模型一次看不了更多，给大仓库兜底。
	globMaxLimit   = 5000
	searchMaxLimit = 1000
	searchMaxCtx   = 20
	// 单行文本上限：压缩过的 js 一行几 MB，原样回传会撑爆响应。
	searchLineLimit = 500
	// 跳过超过这个大小的文件（Go 遍历时）：rg 默认也不会把它们当文本看。
	searchFileLimit = 16 << 20
	searchTimeout   = 60 * time.Second
)

var skippedDirs = map[string]bool{".git": true, "node_modules": true}

// rgPath 在每次请求时查：远端用户可能中途装上 rg，helper 又会常驻一小时。
func rgPath() string {
	found, err := exec.LookPath("rg")
	if err != nil {
		return ""
	}
	return found
}

// globPattern 与 Pi 的 find 语义一致：不含 `/` 的模式匹配任意深度的文件名。
func globPattern(pattern string) string {
	pattern = strings.TrimPrefix(strings.TrimSpace(pattern), "/")
	if !strings.Contains(pattern, "/") {
		return "**/" + pattern
	}
	return pattern
}

// matchGlob 支持 `**`（任意层，含零层）、`*`、`?` 与 `[...]`，`*` 不跨目录。
func matchGlob(pattern, name string) bool {
	return matchSegments(strings.Split(pattern, "/"), strings.Split(name, "/"))
}

func matchSegments(pattern, name []string) bool {
	for len(pattern) > 0 {
		if pattern[0] == "**" {
			rest := pattern[1:]
			for i := 0; i <= len(name); i++ {
				if matchSegments(rest, name[i:]) {
					return true
				}
			}
			return false
		}
		if len(name) == 0 {
			return false
		}
		if ok, err := path.Match(pattern[0], name[0]); err != nil || !ok {
			return false
		}
		pattern, name = pattern[1:], name[1:]
	}
	return len(name) == 0
}

type globResult struct {
	Files     []string `json:"files"`
	Truncated bool     `json:"truncated"`
	Backend   string   `json:"backend"`
}

func (s *server) handleGlob(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Pattern string `json:"pattern"`
		Limit   int    `json:"limit"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	root, ok := searchRoot(w, req.Path)
	if !ok {
		return
	}
	if strings.TrimSpace(req.Pattern) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "pattern 不能为空")
		return
	}
	limit := clamp(req.Limit, 1, globMaxLimit, 1000)
	ctx, cancel := context.WithTimeout(r.Context(), searchTimeout)
	defer cancel()
	result, err := globFiles(ctx, root, globPattern(req.Pattern), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "glob_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func globFiles(ctx context.Context, root, pattern string, limit int) (globResult, error) {
	if rg := rgPath(); rg != "" {
		files, truncated, err := rgFiles(ctx, rg, root, pattern, limit)
		if err == nil {
			return globResult{Files: files, Truncated: truncated, Backend: "rg"}, nil
		}
	}
	files := []string{}
	truncated := false
	err := walkFiles(ctx, root, func(rel string, _ fs.DirEntry) bool {
		if !matchGlob(pattern, rel) {
			return true
		}
		if len(files) >= limit {
			truncated = true
			return false
		}
		files = append(files, rel)
		return true
	})
	return globResult{Files: files, Truncated: truncated, Backend: "walk"}, err
}

func rgFiles(ctx context.Context, rg, root, pattern string, limit int) ([]string, bool, error) {
	cmd := exec.CommandContext(ctx, rg, "--files", "--hidden", "--no-messages",
		"-g", pattern, "-g", "!.git", "-g", "!node_modules")
	cmd.Dir = root
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, false, err
	}
	if err := cmd.Start(); err != nil {
		return nil, false, err
	}
	files := []string{}
	truncated := false
	scanner := bufio.NewScanner(out)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	for scanner.Scan() {
		if len(files) >= limit {
			truncated = true
			break
		}
		files = append(files, filepath.ToSlash(strings.TrimPrefix(scanner.Text(), "./")))
	}
	_ = cmd.Process.Kill()
	waitErr := cmd.Wait()
	// rg 没有匹配时退出码 1；被我们提前杀掉也会报错。只有「什么都没读到且启动参数有误」才算失败。
	if len(files) == 0 && waitErr != nil && exitCodeOf(waitErr) > 1 {
		return nil, false, waitErr
	}
	return files, truncated, nil
}

// walkFiles 按字典序遍历普通文件（不跟随符号链接），visit 返回 false 立即停止。
func walkFiles(ctx context.Context, root string, visit func(rel string, entry fs.DirEntry) bool) error {
	stop := errors.New("stop")
	err := filepath.WalkDir(root, func(full string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil // 读不了的子目录跳过，不让整次查找失败
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if entry.IsDir() {
			if full != root && skippedDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(root, full)
		if err != nil {
			return nil
		}
		if !visit(filepath.ToSlash(rel), entry) {
			return stop
		}
		return nil
	})
	if errors.Is(err, stop) {
		return nil
	}
	return err
}

type searchMatch struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
	// Context 是匹配行前后的上下文行（不含匹配行本身），按行号升序。
	Context []searchLine `json:"context,omitempty"`
}

type searchLine struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

type searchResult struct {
	Matches   []searchMatch `json:"matches"`
	Truncated bool          `json:"truncated"`
	Backend   string        `json:"backend"`
}

type searchRequest struct {
	Path       string `json:"path"`
	Pattern    string `json:"pattern"`
	Glob       string `json:"glob"`
	IgnoreCase bool   `json:"ignoreCase"`
	Literal    bool   `json:"literal"`
	Context    int    `json:"context"`
	Limit      int    `json:"limit"`
}

func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	var req searchRequest
	if !decodeBody(w, r, &req) {
		return
	}
	root, ok := searchRoot(w, req.Path)
	if !ok {
		return
	}
	if req.Pattern == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "pattern 不能为空")
		return
	}
	req.Limit = clamp(req.Limit, 1, searchMaxLimit, 100)
	req.Context = clamp(req.Context, 0, searchMaxCtx, 0)
	ctx, cancel := context.WithTimeout(r.Context(), searchTimeout)
	defer cancel()
	result, err := searchFiles(ctx, root, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "search_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func searchFiles(ctx context.Context, root string, req searchRequest) (searchResult, error) {
	if rg := rgPath(); rg != "" {
		return rgSearch(ctx, rg, root, req)
	}
	return walkSearch(ctx, root, req)
}

// rgSearch 读 `rg --json`：结构化输出，文件名里有冒号也不会解析错。
func rgSearch(ctx context.Context, rg, root string, req searchRequest) (searchResult, error) {
	args := []string{"--json", "--hidden", "--no-messages", "-g", "!.git", "-g", "!node_modules"}
	if req.IgnoreCase {
		args = append(args, "--ignore-case")
	}
	if req.Literal {
		args = append(args, "--fixed-strings")
	}
	if req.Context > 0 {
		args = append(args, "--context", fmt.Sprint(req.Context))
	}
	if glob := strings.TrimPrefix(req.Glob, "**/"); glob != "" {
		args = append(args, "-g", glob)
	}
	args = append(args, "-e", req.Pattern, ".")
	cmd := exec.CommandContext(ctx, rg, args...)
	cmd.Dir = root
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		return searchResult{}, err
	}
	if err := cmd.Start(); err != nil {
		return searchResult{}, err
	}
	result := searchResult{Matches: []searchMatch{}, Backend: "rg"}
	collector := newContextCollector(req.Context)
	scanner := bufio.NewScanner(out)
	scanner.Buffer(make([]byte, 64<<10), 64<<20)
	for scanner.Scan() {
		var event struct {
			Type string `json:"type"`
			Data struct {
				Path       struct{ Text string } `json:"path"`
				Lines      struct{ Text string } `json:"lines"`
				LineNumber int                   `json:"line_number"`
			} `json:"data"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			continue
		}
		file := filepath.ToSlash(strings.TrimPrefix(event.Data.Path.Text, "./"))
		text := trimLine(event.Data.Lines.Text)
		switch event.Type {
		case "begin":
			collector.reset()
		case "context":
			collector.context(&result, file, event.Data.LineNumber, text)
		case "match":
			if len(result.Matches) >= req.Limit {
				result.Truncated = true
				break
			}
			collector.match(&result, file, event.Data.LineNumber, text)
		}
		if result.Truncated {
			break
		}
	}
	_ = cmd.Process.Kill()
	waitErr := cmd.Wait()
	// 退出码 2 是 rg 自己报错（正则写错最常见）：把它的原话带回去，模型才知道改哪里。
	if !result.Truncated && waitErr != nil && exitCodeOf(waitErr) == 2 && len(result.Matches) == 0 {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = waitErr.Error()
		}
		return searchResult{}, errors.New(message)
	}
	return result, nil
}

// contextCollector 把上下文行挂到最近的匹配上：匹配之前的行先攒着，匹配之后的行追加到它身上。
type contextCollector struct {
	size        int
	pending     []searchLine
	pendingFile string
	file        string
	last        *searchMatch
	after       int
}

func newContextCollector(size int) *contextCollector { return &contextCollector{size: size} }

func (c *contextCollector) reset() {
	c.pending, c.pendingFile, c.file, c.last, c.after = nil, "", "", nil, 0
}

func (c *contextCollector) context(result *searchResult, file string, line int, text string) {
	if c.size == 0 {
		return
	}
	if c.last != nil && c.file == file && c.after < c.size {
		c.last.Context = append(c.last.Context, searchLine{Line: line, Text: text})
		c.after++
		return
	}
	if c.pendingFile != file {
		c.pending, c.pendingFile = nil, file
	}
	c.pending = append(c.pending, searchLine{Line: line, Text: text})
	if len(c.pending) > c.size {
		c.pending = c.pending[len(c.pending)-c.size:]
	}
}

func (c *contextCollector) match(result *searchResult, file string, line int, text string) {
	match := searchMatch{Path: file, Line: line, Text: text}
	if c.pendingFile == file {
		match.Context = append(match.Context, c.pending...)
	}
	c.pending = nil
	result.Matches = append(result.Matches, match)
	c.file = file
	c.last = &result.Matches[len(result.Matches)-1]
	c.after = 0
}

// walkSearch 是没有 rg 时的退路：RE2 不支持反向引用与环视，写了会在编译正则时报错。
func walkSearch(ctx context.Context, root string, req searchRequest) (searchResult, error) {
	source := req.Pattern
	if req.Literal {
		source = regexp.QuoteMeta(source)
	}
	if req.IgnoreCase {
		source = "(?i)" + source
	}
	pattern, err := regexp.Compile(source)
	if err != nil {
		return searchResult{}, fmt.Errorf("正则无效（远端没有 rg，按 Go RE2 语法解析）：%v", err)
	}
	glob := strings.TrimPrefix(req.Glob, "**/")
	result := searchResult{Matches: []searchMatch{}, Backend: "walk"}
	err = walkFiles(ctx, root, func(rel string, entry fs.DirEntry) bool {
		if glob != "" && !matchGlob(globPattern(glob), rel) {
			return true
		}
		if info, err := entry.Info(); err != nil || info.Size() > searchFileLimit {
			return true
		}
		return searchFile(filepath.Join(root, rel), rel, pattern, req, &result)
	})
	return result, err
}

// searchFile 返回 false 表示已经到上限，调用方停止遍历。
func searchFile(full, rel string, pattern *regexp.Regexp, req searchRequest, result *searchResult) bool {
	body, err := os.ReadFile(full)
	if err != nil || bytes.IndexByte(body[:min(len(body), 8000)], 0) >= 0 {
		return true // 读不了或是二进制：跳过
	}
	lines := strings.Split(strings.TrimSuffix(string(body), "\n"), "\n")
	collector := newContextCollector(req.Context)
	lastEmitted := 0
	for index, line := range lines {
		if !pattern.MatchString(line) {
			continue
		}
		if len(result.Matches) >= req.Limit {
			result.Truncated = true
			return false
		}
		number := index + 1
		// 与 rg 一致：上下文不重复输出已经报过的行。
		for before := max(number-req.Context, lastEmitted+1); before < number; before++ {
			collector.context(result, rel, before, trimLine(lines[before-1]))
		}
		collector.match(result, rel, number, trimLine(line))
		lastEmitted = number
		for after := number + 1; after <= min(number+req.Context, len(lines)); after++ {
			if pattern.MatchString(lines[after-1]) {
				break
			}
			collector.context(result, rel, after, trimLine(lines[after-1]))
			lastEmitted = after
		}
	}
	return true
}

func trimLine(text string) string {
	text = strings.TrimRight(text, "\r\n")
	if len(text) > searchLineLimit {
		// 按 rune 截：不把一个汉字切成两半。
		cut := searchLineLimit
		for cut > 0 && !utf8RuneStart(text[cut]) {
			cut--
		}
		return text[:cut] + "…"
	}
	return text
}

func utf8RuneStart(b byte) bool { return b&0xC0 != 0x80 }

func searchRoot(w http.ResponseWriter, raw string) (string, bool) {
	root, err := requireAbsPath(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_path", err.Error())
		return "", false
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		writeError(w, http.StatusNotFound, "not_found", fmt.Sprintf("Path not found: %s", root))
		return "", false
	}
	return root, true
}

func clamp(value, low, high, fallback int) int {
	if value == 0 {
		return fallback
	}
	return max(low, min(value, high))
}

func exitCodeOf(err error) int {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}
