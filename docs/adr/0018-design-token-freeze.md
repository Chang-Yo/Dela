# 0018. Design token 的名字定稿并冻结

- 状态：部分取代（「只能新增，不能改名或删除」由 [0023](0023-design-token-naming.md) 取代）
- 日期：2026-11-14

## 背景

v3 把样式收拢到 `src/ui/tokens.css` 之后，token 名仍带着来源的痕迹：`bui-accent` 带 beautiful-ui 前缀，`green`/`orange`/`red` 按色相命名，`hover-2` 同时充当加深悬停、选中态和次要按钮底色，引导页、@ 引用和拖放落点各自借用了日历色。名字说不清用途，调一处的值就会牵动别处。

## 决定

- 下列名字定稿。此后只能新增，不能改名或删除；值可以随设计调整。
  - 表面与文字：`page`、`surface`、`inset`、`hover`、`hover-strong`、`selected`、`fill`、`field`、`line`、`line-strong`、`ink`、`ink-2`、`ink-3`、`code`
  - 强调色：`accent`、`accent-ink`、`accent-tint`、`on-accent`
  - 状态：`success`、`warning`、`danger`，以及各自的 `-tint`
  - 不随主题变化：`scrim`、`media`、`on-media`、`paper`、`window-close`、`alipay`、`wechat`
  - 只经 `var()` 取用的变量：`tooltip-bg`、`tooltip-fg`、`tooltip-border`；日历色 `cal-{rose,peach,sand,sage,teal,blue,lilac,slate}-{bg,text}`，名字与数据库里的事件颜色 key 一一对应；代码高亮 `syntax-*`
  - 阴影 `hairline`、`hairline-strong`、`focus`、`invalid`、`tooltip`、`thumb`、`inset-highlight`、`btn`、`card`、`raised`、`overlay`；圆角 `chip`、`control`、`card`、`window`；层级 `drawer`、`scrim`、`overlay`、`takeover`、`toast`；时长 `fast`、`base`、`slow`、`slower`；缓动 `out-strong`；字体 `sans`、`mono`、`script`；动画 `fade-in`、`overlay-in`、`pop-in`、`dialog-in`、`drawer-left`、`drawer-right`、`sheet-up`、`pill-in`、`pill-out`
  - 字号只用 Tailwind 内置的 `xs` 至 `3xl`
- `hover-strong`、`selected`、`fill` 目前取同一个值，按用途分名是为了以后能分开调。
- `globals.css` 里给 streamdown 的 shadcn 色名和 `radius-*` 是第三方适配层，不属于 Dela token，不在冻结范围内，界面代码不得使用。
- `pnpm lint` 运行 `scripts/lint-styles.ts`：禁止 shadcn 别名、Tailwind 原生色板、任意值，以及 token 之外的圆角、时长、层级与字号；并用 Tailwind 编译器找出写了却不生成 CSS 的类名。

## 后果

- 新界面只需在上面的名字里选；缺少合适的名字时新增一个，而不是借用别的用途的 token。
- 拼错或已删除的 token 名在 lint 阶段报错，不再静默失效。
- 之后调整正文字号、给次要按钮单独定色，只改值或新增名字，不需要改动调用处。
