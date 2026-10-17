---
id: REQ-0002
title: macOS 开发窗口与授权流程适配
status: done
created: 2026-10-17
updated: 2026-10-17
released_in:
---

# REQ-0002 macOS 开发窗口与授权流程适配

## 需求

- 场景：macOS 源码调试时，应用内部刷新会打开 Chrome，标题栏与系统按钮重叠，水源授权窗口也无法方便地退出。
- 期望：应用内刷新留在 Dela；标题栏正确避让红黄绿按钮；水源授权可关闭且不会重复打开多个窗口。

## 验收

- [x] 同源重载留在应用内，真正的外部链接仍交给系统浏览器。
- [x] macOS 不重复显示 Windows 窗口按钮，标题栏与红黄绿按钮不重叠。
- [x] 水源授权支持系统关闭按钮和 `Escape`，重复发起时复用现有窗口。
- [x] 相关测试、构建及 Electron、水源冒烟通过。

## 记录

- `2026-10-17` 提出：本地调试、标题栏和水源授权退出问题。
- `2026-10-17` 完成：Commit `bffd643`；相关单测 7 项、全量测试 895 项通过，`pnpm lint`、`pnpm build`、`pnpm smoke`、`pnpm smoke:shuiyuan` 通过，并完成 macOS 实机验证。
