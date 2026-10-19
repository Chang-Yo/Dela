# beautiful-ui（vendored）

来源：<https://github.com/slev12397/beautiful-ui>（MIT，见 [LICENSE](./LICENSE)）。
以 shadcn 风格整库复制进本仓库，目录结构与上游一致：

- `atoms/` — 上游 `components/atoms/*`，组件库内部积木（IconButton、Shimmer、ProgressRing 等）。
- `primitives/` — 上游 `components/primitives/*`，面向产品的组件（当前仅 CodeBlock）。
- `beautifului.css` — 上游 `app/globals.css` 的库部分：设计 token、`@theme` 映射与共享 keyframes。由 `styles/globals.css` 引入。

## 相对上游的适配（同步新版本时需重放）

1. **内部导入改路径**：`@/components/atoms/` → `@/components/ui/beautifului/atoms/`，`@/components/primitives/` → `@/components/ui/beautifului/primitives/`。`@/lib/utils` 与 Dela 既有实现一致，未改。
2. **accent 命名空间**：Dela 的 shadcn token 已占用 `--accent`（hover 灰），上游的品牌蓝改为 `--bui-accent` / `--bui-accent-ink` / `--bui-accent-tint`，对应工具类 `bg-bui-accent`、`text-bui-accent-ink` 等。组件 API（`variant="accent"`）不变。
3. **只保留在用的组件**（2026-10-14）：删除 Dela 未引用的 atoms（Button、Chip、EntityChip、StreamText、TextRow、ValuePill）与 primitives（AgentScreen、ApprovalCard、ChatComposer、ContextCards、DiffTable、FilterTable、FineTuneCard、Flowchart、GlideMenu、InsightCards、LoadingState、PromptBar、RecommendationCard、RecordsTable、SearchList、SelectionActions、SidebarNav、StreamingText、TaskRows、ThinkingState、ToolChips），以及它们专属的 CSS 与 keyframes（`fade-up`、`eq-bounce`、`caret-blink`、`pixel-on`、`records-pulse`）。需要其中某个组件时从上游重新取用并重放本节适配。按钮统一用 `components/ui/button.tsx`（圆角矩形，shadcn 变体名），上游胶囊形 Button 不再使用。
4. **字体 token 未引入**：上游 `--font-sans/--font-mono` 绑定 Next.js 字体，沿用 Dela 字体。
5. **阴影值内联**：上游通过 `shadow-plugin` 提供 `--shadow-xs…lg`，此处将所需层级值直接内联进 token，未引入该依赖（避免全局改变 Dela 既有 `shadow-*` 工具类）。
6. **`@custom-variant dark`**：上游 globals.css 中的 dark 变体定义移入 `beautifului.css`（Dela 此前未定义）。
7. **Dela 增补的受控/内容 props**（各组件内以 `Dela 适配` 注释标注）：
   - `primitives/CodeBlock.tsx`：`plain`（跳过内置语法高亮）、`fill`（满宽）、`bodyClassName`（追加到代码主体）、`tone="error"`（失败态左侧 `--red` 色条）。
   - `atoms/ProgressRing.tsx`：`tone="ink"`（中性墨色档，低干扰进度，如 composer 上下文占用）。
   - `atoms/Switch.tsx`（2026-10-14）：由原 `components/ui/switch.tsx` 并入，在上游外观（ink 轨道、白色滑块、ease-out-strong 位移）上增加三态 `indeterminate`（`aria-checked="mixed"`，整域开关部分开启时用）、`disabled`、聚焦环与 `type="button"`；`label` 改为必填；尺寸为 h-5 w-9（上游 h-6 w-10）。
   - `atoms/Toast.tsx`（2026-10-15）：增加 `neutral`、可选图标、右侧操作与正文下方内容槽，关闭回调改为可选；能力拓展复用通知卡片样式并显示安装进度，原有 error/success 通知保持原行为。
8. **Dela 新增文件**：`atoms/IconButton.tsx` — 从上游 PromptBar 控件按钮提炼的静默图标钮（上游无此 atom）；`atoms/Toast.tsx` — 应用内通知浮窗卡片（error/success 两个变体，tint 圆底图标 + rounded-card 浮岛，纯展示，宿主在 `app/toasts.tsx`）；`atoms/Slider.tsx` — radix Slider 封装（上游无此 atom），按上游 Switch 的中性语言（`bg-line-strong` 槽 / `bg-ink` 填充 / 白色拇指），受控 `value`/`onValueChange`，用于课堂视频音量等连续值调节。
9. **全局 token 统一**（2026-10-08）：`styles/globals.css` 的 shadcn 语义变量（`--background`、`--muted-foreground`、`--border` 等）全部映射到本库 token；唯一例外是 `--destructive-foreground`（本库没有对应档位，仍是裸色值）；跟随系统的深色由 `app/theme.ts` 解析为 `:root.dark`，与本库只认 `.dark` 的约定一致。`components/ui/` 下的 shadcn 基础件（button / input / textarea / select / dropdown-menu / context-menu / tooltip）保留 API，外观改用本库 token、圆角与 `pop-in` 动效，浮层样式集中在 `components/ui/menu-styles.ts`。
10. **`.bui-light` 固定浅色作用域**（2026-10-08）：`beautifului.css` 在 `.dark` 之后复制一份浅色 token 到 `.bui-light`，供首启引导这类恒白画布在深色主题下仍使用浅色 token。
11. **`atoms/SegmentedControl.tsx` 的段按钮加 `type="button"`**（2026-10-10）：用于表单内（邮箱连接表单的交大邮箱 / 第三方 IMAP 切换）时，无 type 会默认提交表单。
12. **圆角 token 改 rem**（2026-10-14）：`--radius-chip/control/card/window` 上游是 `6/8/10/14px`，改为 `0.375/0.5/0.625/0.875rem`，使圆角随「设置 › 外观 › 字号」的根字号缩放。默认 16px 根字号下与上游像素一致。
13. **CodeBlock 文件名行改正常行高**（2026-10-19）：`leading-none` 的 1em 行盒在字号调大后会裁掉下划线与字形下缘；文件名改用 `leading-normal`，头部由固定 `h-11` 改为 `min-h-11` + `py-2`，长路径仍由 `truncate` 省略。

## 升级方式

官方除 GitHub 仓库外还提供 shadcn registry（`https://www.beautifului.dev/r/registry.json`，27 项 = foundation + 6 个 `registry:ui` + 20 个 `registry:component`）。**两条渠道不是逐项对应的**：`agentscreen` 仅仓库有，且仓库里的 `atoms/Chip.tsx`、`Switch.tsx`、`ProgressRing.tsx`、`SegmentedControl.tsx`、`StatusPill.tsx`、`TextRow.tsx` 在 registry 中没有对应条目（逐个请求均 404）——它们来自同一次整库复制（2026-10-08），不是 Dela 的增补。token 与 keyframes 两条渠道一致；组件层面的差异见上文「相对上游的适配」。

```bash
# 渠道一：clone 仓库（globals.css 为 shadow 展开后的完整样式，本目录即由此组装）
git clone --depth 1 https://github.com/slev12397/beautiful-ui.git /tmp/beautiful-ui

# 渠道二：registry 逐项拉取（foundation=token 基座，每组件附带独立 CSS 与依赖清单）
curl -sL https://www.beautifului.dev/r/foundation.json
curl -sL https://www.beautifului.dev/r/sidebar-nav.json
```

不用 `npx shadcn add`：它会安装付费图标依赖 `@central-icons-react/*` 并按 shadcn 目录落盘；取 JSON 中 `files[].content` 手动对比即可。注意 registry 版 `--shadow-*` 引用 `--shadow-xs…lg`（shadow-plugin 尺度），仓库版是展开值，本目录内联的是后者。同步后按上文「相对上游的适配」重放修改。

