# beautiful-ui（vendored）

来源：<https://github.com/slev12397/beautiful-ui>（MIT，见 [LICENSE](./LICENSE)）。
以 shadcn 风格整库复制进本仓库，目录结构与上游一致：

- `atoms/` — 上游 `components/atoms/*`，组件库内部积木（Button、Chip、StreamText 等）。
- `primitives/` — 上游 `components/primitives/*`，面向产品的组件（ThinkingState、ToolChips、PromptBar 等）。
- `beautifului.css` — 上游 `app/globals.css` 的库部分：设计 token、`@theme` 映射、共享 keyframes 与组件专属 CSS。由 `styles/globals.css` 引入。

## 相对上游的适配（同步新版本时需重放）

1. **内部导入改路径**：`@/components/atoms/` → `@/components/ui/beautifului/atoms/`，`@/components/primitives/` → `@/components/ui/beautifului/primitives/`。`@/lib/utils` 与 Dela 既有实现一致，未改。
2. **accent 命名空间**：Dela 的 shadcn token 已占用 `--accent`（hover 灰），上游的品牌蓝改为 `--bui-accent` / `--bui-accent-ink` / `--bui-accent-tint`，对应工具类 `bg-bui-accent`、`text-bui-accent-ink` 等。组件 API（`variant="accent"`）不变。
3. **SidebarNav 图标**：上游依赖付费图标库 `@central-icons-react`，按官方 README 建议换为 lucide-react 等义图标（见文件头注释）。
4. **字体 token 未引入**：上游 `--font-sans/--font-mono` 绑定 Next.js 字体，沿用 Dela 字体。
5. **阴影值内联**：上游通过 `shadow-plugin` 提供 `--shadow-xs…lg`，此处将所需层级值直接内联进 token，未引入该依赖（避免全局改变 Dela 既有 `shadow-*` 工具类）。
6. **`@custom-variant dark`**：上游 globals.css 中的 dark 变体定义移入 `beautifului.css`（Dela 此前未定义）。
7. **Dela 增补的受控/内容 props**（各组件内以 `Dela 适配` 注释标注）：
   - `primitives/ThinkingState.tsx`：`working`（受控进行态，接管演示时间线）、`defaultExpanded`、`renderBody`（自定义轨迹内容）、`fill`（满宽）；非受控用法与上游一致。
   - `primitives/CodeBlock.tsx`：`plain`（跳过内置语法高亮）、`fill`（满宽）、`bodyClassName`（追加到代码主体）。
8. **Dela 新增文件**：`atoms/IconButton.tsx` — 从 PromptBar 控件按钮提炼的静默图标钮（上游无此 atom）。
9. **全局 token 统一**（2026-10-08）：`styles/globals.css` 的 shadcn 语义变量（`--background`、`--muted-foreground`、`--border` 等）全部映射到本库 token，不再另定颜色值；跟随系统的深色由 `app/theme.ts` 解析为 `:root.dark`，与本库只认 `.dark` 的约定一致。`components/ui/` 下的 shadcn 基础件（button / input / textarea / switch / select / dropdown-menu / context-menu / tooltip）保留 API，外观改用本库 token、圆角与 `pop-in` 动效，浮层样式集中在 `components/ui/menu-styles.ts`。
10. **`.bui-light` 固定浅色作用域**（2026-10-08）：`beautifului.css` 在 `.dark` 之后复制一份浅色 token 到 `.bui-light`，供首启引导这类恒白画布在深色主题下仍使用浅色 token。

## 已知特性（源自上游设计）

组件内置“演示时间线”（ThinkingState 的阶段定时器、ToolChips 的逐行揭示、PromptBar 的 `demo` 自走演示）。在真实数据流中使用时：

- 传入内容 props（`rows` / `steps` / `sources` 等）覆盖演示数据；
- 需要外部状态控制时，使用为 Dela 增补的受控 props（各组件内以 `Dela 适配` 注释标注）；
- `PromptBar` 需 `demo={false}` 关闭自走演示。

## 升级方式

官方除 GitHub 仓库外还提供 shadcn registry（`https://www.beautifului.dev/r/registry.json`，27 项 = foundation + 5 atoms + 21 primitives；`agentscreen` 仅仓库有）。两条渠道已核对一致（2026-10-07）：token/keyframes 与本目录逐项相同，差异仅为上文第 2、5 条适配。

```bash
# 渠道一：clone 仓库（globals.css 为 shadow 展开后的完整样式，本目录即由此组装）
git clone --depth 1 https://github.com/slev12397/beautiful-ui.git /tmp/beautiful-ui

# 渠道二：registry 逐项拉取（foundation=token 基座，每组件附带独立 CSS 与依赖清单）
curl -sL https://www.beautifului.dev/r/foundation.json
curl -sL https://www.beautifului.dev/r/sidebar-nav.json
```

不用 `npx shadcn add`：它会安装付费图标依赖 `@central-icons-react/*` 并按 shadcn 目录落盘；取 JSON 中 `files[].content` 手动对比即可。注意 registry 版 `--shadow-*` 引用 `--shadow-xs…lg`（shadow-plugin 尺度），仓库版是展开值，本目录内联的是后者。同步后按上文「相对上游的适配」重放修改。

