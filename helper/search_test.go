//go:build linux

package main

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestMatchGlob(t *testing.T) {
	cases := []struct {
		pattern, name string
		want          bool
	}{
		{"**/*.ts", "a.ts", true},
		{"**/*.ts", "src/deep/a.ts", true},
		{"src/*.ts", "src/a.ts", true},
		{"src/*.ts", "src/deep/a.ts", false},
		{"src/**/a.ts", "src/a.ts", true},
		{"**/a?.go", "x/ab.go", true},
		{"**/*.ts", "a.tsx", false},
	}
	for _, c := range cases {
		if got := matchGlob(c.pattern, c.name); got != c.want {
			t.Errorf("matchGlob(%q, %q) = %v", c.pattern, c.name, got)
		}
	}
}

func fixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"a.ts":                "const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n",
		"src/b.ts":            "// alpha here\nexport {}\n",
		"src/c.go":            "package alpha\n",
		"name:with:colon.txt": "alpha in a file whose name has colons\n",
		"node_modules/x.ts":   "alpha\n",
		".git/config":         "alpha\n",
	}
	for name, body := range files {
		full := filepath.Join(root, name)
		os.MkdirAll(filepath.Dir(full), 0o755)
		os.WriteFile(full, []byte(body), 0o644)
	}
	return root
}

// 有 rg 与没有 rg 时结果要一致：Dela 侧只认一种结构。
func TestGlobBackendsAgree(t *testing.T) {
	root := fixture(t)
	walk, err := globFiles(context.Background(), root, globPattern("*.ts"), 100)
	if err != nil || walk.Backend == "" {
		t.Fatal(err)
	}
	want := []string{"a.ts", "src/b.ts"}
	if rg := rgPath(); rg != "" {
		files, _, err := rgFiles(context.Background(), rg, root, globPattern("*.ts"), 100)
		if err != nil {
			t.Fatal(err)
		}
		sort.Strings(files)
		if !reflect.DeepEqual(files, want) {
			t.Errorf("rg: %v", files)
		}
	}
	var walked []string
	walkFiles(context.Background(), root, func(rel string, _ os.DirEntry) bool {
		if matchGlob(globPattern("*.ts"), rel) {
			walked = append(walked, rel)
		}
		return true
	})
	if !reflect.DeepEqual(walked, want) {
		t.Errorf("walk: %v", walked)
	}
}

func TestSearchBackendsAgree(t *testing.T) {
	root := fixture(t)
	req := searchRequest{Pattern: "alpha", Limit: 100}
	walk, err := walkSearch(context.Background(), root, req)
	if err != nil {
		t.Fatal(err)
	}
	results := map[string]searchResult{"walk": walk}
	if rg := rgPath(); rg != "" {
		got, err := rgSearch(context.Background(), rg, root, req)
		if err != nil {
			t.Fatal(err)
		}
		results["rg"] = got
	}
	for backend, result := range results {
		var where []string
		for _, match := range result.Matches {
			where = append(where, match.Path)
		}
		sort.Strings(where)
		want := []string{"a.ts", "name:with:colon.txt", "src/b.ts", "src/c.go"}
		if !reflect.DeepEqual(where, want) {
			t.Errorf("%s 命中 %v", backend, where)
		}
	}
}

func TestSearchContextAndLimit(t *testing.T) {
	root := fixture(t)
	req := searchRequest{Pattern: "beta", Glob: "*.ts", Context: 1, Limit: 10}
	check := func(backend string, result searchResult) {
		if len(result.Matches) != 1 {
			t.Fatalf("%s 命中 %d 条", backend, len(result.Matches))
		}
		match := result.Matches[0]
		want := []searchLine{{1, "const alpha = 1;"}, {3, "const gamma = 3;"}}
		if match.Line != 2 || !reflect.DeepEqual(match.Context, want) {
			t.Errorf("%s 上下文 %+v", backend, match)
		}
	}
	walk, _ := walkSearch(context.Background(), root, req)
	check("walk", walk)
	if rg := rgPath(); rg != "" {
		got, _ := rgSearch(context.Background(), rg, root, req)
		check("rg", got)
	}

	limited, _ := walkSearch(context.Background(), root, searchRequest{Pattern: "const", Limit: 2})
	if len(limited.Matches) != 2 || !limited.Truncated {
		t.Errorf("上限：%d 条，truncated=%v", len(limited.Matches), limited.Truncated)
	}
}

func TestWalkSearchRejectsUnsupportedRegex(t *testing.T) {
	if _, err := walkSearch(context.Background(), t.TempDir(), searchRequest{Pattern: `(a)\1`, Limit: 1}); err == nil {
		t.Fatal("RE2 不支持的反向引用应当报错，而不是静默返回空结果")
	}
}
