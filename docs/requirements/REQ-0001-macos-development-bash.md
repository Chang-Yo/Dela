---
id: REQ-0001
title: macOS 本地开发使用系统 Bash
status: done
created: 2026-10-17
updated: 2026-10-17
released_in:
---

# REQ-0001 macOS 本地开发使用系统 Bash

## 需求

- 场景：在 macOS 源码调试时，终端误报缺少 Git for Windows，导致本地终端和 Agent 无法使用。
- 期望：macOS 改用系统 `/bin/bash`；Windows 继续使用 Git Bash / MinGit，正式发布范围仍仅限 Windows。

## 验收

- [x] macOS 本地终端与 Agent 使用 `/bin/bash`，不传入 Windows 专用配置。
- [x] Windows 的 Git Bash、MinGit 和 ConPTY 行为保持不变。
- [x] 终端测试、全量测试、构建与 Electron 冒烟通过。

## 记录

- `2026-10-17` 提出：macOS 调试界面提示“未找到 Git Bash”。
- `2026-10-17` 完成：Commit `553c9f9`；终端测试 7 项、全量测试 891 项通过，`pnpm lint`、`pnpm build`、`pnpm smoke` 通过。
