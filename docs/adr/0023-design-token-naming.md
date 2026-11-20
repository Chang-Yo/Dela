# 0023. Design token 按用途命名，改名走 ADR

- 状态：已接受
- 日期：2026-11-20
- 取代：[0018](0018-design-token-freeze.md) 中「只能新增，不能改名或删除」

## 背景

0018 在 v3 迁移期间冻结了 token 名字，避免新旧两套名字同时流传。迁移完成后，冻结只剩下副作用：明显不合适的名字也无法修正，业务专用的颜色和通用 token 混在同一份名单里，看不出哪些是组件库的一部分。

0018 选定的名字本身是对的：它们按用途命名（`danger` 而不是 `red`，`line-strong` 而不是 `gray-300`），与业内主流设计系统的做法一致。`hover-strong`、`selected`、`fill` 目前同值，但用途不同，分名仍然成立。

## 决定

- **保留 0018 定下的名字**，不换成 shadcn 的 `background`、`foreground`、`muted` 等别名；`scripts/lint-styles.ts` 继续禁止这些别名。
- **新名字按用途命名，不按色相或数值命名。** 缺少合适的名字时新增，不借用别的用途的 token。
- **改名或删除允许，但必须写 ADR**，并在同一个提交里完成：全局替换所有用法，同步 `scripts/lint-styles.ts` 与 `src/ui/cn.ts` 的 `extendTailwindMerge`。不留新旧并存的过渡期。
- `tokens.css` 里的 token 分两类，分段书写：
  - **通用 token**：表面、文字、边框、强调色、状态色、阴影、圆角、层级、时长、缓动、字体 `sans` 与 `mono`、通用动画。组件库只依赖这一类。
  - **应用调色板**：只为 Dela 的某个功能存在，例如日历色 `cal-*`（名字与数据库里的颜色 key 一一对应）、代码高亮 `syntax-*`、赞助页的 `alipay`、`wechat`、Windows 关闭按钮的 `window-close`、外部文档白底 `paper`、引导页手写体 `font-script`。它们被多个模块共用，所以仍放在 `tokens.css`，但 `src/ui` 的组件不使用它们。

## 后果

- token 名字仍然稳定：改名的成本（ADR + 一次性全局替换）足够高，不会随手发生。
- 拼错或已删除的名字照旧在 `pnpm lint` 阶段报错。
- 判断一个 token 能否被组件使用，只需看它在 `tokens.css` 的哪一段。
