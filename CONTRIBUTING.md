# 贡献指南

欢迎参与 Dela 的开发与维护。Dela 是面向 SJTU 用户的本地优先 Agent 桌面应用：Electron 主进程与 React 渲染进程，Agent 内核为 Pi Coding Agent，领域能力通过 `dela` 命令与 Skills 外置。数据保存在本机 SQLite，凭据经 Electron `safeStorage` 加密，无服务端与账号系统。

贡献形式包括代码、文档、测试、设计、问题反馈，以及向需要的用户介绍 Dela。开始之前，请先阅读 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 如何参与

### 报告问题

- 提交前先搜索 [Issues](https://github.com/Chang-Yo/Dela/issues)，确认是否已有相同问题。
- 说明应用版本、操作系统、复现步骤、预期结果与实际结果；附上截图、日志或最小复现工程。提交前请隐去账号、token、邮箱正文等个人凭据信息。
- 一个 issue 只描述一个问题，避免将多个不相关的问题合并提交。
- 修复既有 bug 的 PR 必须链接能够证明故障已发生的证据：issue、日志、截图或复现步骤。

### 功能建议与讨论

- 使用问题、体验反馈与想法交流适合在 [Discussions](https://github.com/Chang-Yo/Dela/discussions) 中提出。
- 新功能、行为变化与架构调整应先通过 issue 或讨论说明要解决的问题、受益对象与优先级。维护者确认方向后再开始实现。
- 明确不会添加的功能将集中记录在 `docs/what-we-not-do.md`（文档仍在整理）。开始实现前如不确定方向是否在范围内，请先提交 issue 确认。

### 提交代码

代码改动通过 Pull Request 提交，具体要求见 [PR 要求](#pr-要求)。即使改动较小，也建议先在 issue 或讨论中说明；维护者可提前指出是否存在更简单的方案。

### 推广与文档

- 在班级群、社团、技术社区介绍 Dela，或撰写使用体验、教程与问题记录，均有助于项目推广。
- 文档纠错与补充说明可直接提交 PR。面向用户的变化应同步更新 README，重要改动应同步更新 CHANGELOG。
- 发现安全漏洞时请勿公开讨论，应按 [SECURITY.md](SECURITY.md) 的方式私下联系作者。

## 开发环境

| 工具            | 版本                               | 何时需要              |
| --------------- | ---------------------------------- | --------------------- |
| Node.js         | 24.22.1                            | 总是                  |
| pnpm            | 12.3.4                             | 总是                  |
| Git for Windows | 不固定                             | Windows 的终端与 Bash |
| Go              | `go.mod` 声明 1.22，CI 固定 1.27.2 | 只在改动 `helper/` 时 |

版本以 `package.json` 的 `engines`、`packageManager` 与 `.node-version` 为准。仓库启用了 `engineStrict`，使用其他版本会被拒绝。请勿在项目中混用全局安装的其他 Node 或 pnpm 版本。

在 Windows 上，可将 Node 与 pnpm 安装到仓库内被 Git 忽略的 `.tools/` 目录，并在 PowerShell 中为当前会话启用：

```powershell
. ./scripts/use-local-tools.ps1
```

新克隆的仓库不包含 `.tools/`，需自行安装上述版本。Apple Silicon Mac 也可将校验后的官方 Node 压缩包解压到 `.tools/node-v24.22.1-darwin-arm64`，然后在当前 shell 中启用：

```sh
export PATH="$PWD/.tools/node-v24.22.1-darwin-arm64/bin:$PATH"
```

安装依赖并启动开发窗口：

```sh
pnpm install
pnpm dev
```

`pnpm install` 的 `postinstall` 会下载 Electron 运行时，并在 macOS 上修正 `node-pty` 的 `spawn-helper` 可执行位。

在 Windows 上，Git for Windows 是运行前提而非可选项：终端与 Agent 的 Bash 工具均依赖它。macOS 使用系统 `/bin/bash` 与本机 Git/SSH，无需安装 MinGit。Go 仅与 `helper/` 有关；远端 helper 的静态二进制已入库在 `vendor/dela-helper/`，日常开发不需要 Go。

模型服务、搜索服务与校园服务凭据均在应用设置中配置。请勿提交 `.env`、个人数据、日志与本地工具。

更详细的环境说明、macOS 约定与平台差异见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 的 §11 与 §16。

## 本地测试

提交前应至少运行与改动相关的检查。完整检查如下：

```sh
pnpm format:check
pnpm lint
pnpm build
pnpm test
```

以上四项组合为 `pnpm check`。`pnpm build` 已包含四组 tsconfig 的类型检查（main / preload / renderer / scripts），也可单独执行 `pnpm typecheck`。

根据改动范围补充相应的冒烟或真机测试：

| 场景                           | 命令                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Electron 基础冒烟              | `pnpm smoke`                                                                               |
| macOS 依赖、Keychain、Bash PTY | `pnpm smoke:macos`                                                                         |
| 离线运行时与 `dela` 桥         | `pnpm smoke:runtime`                                                                       |
| 原生菜单、窗口关闭与恢复       | `pnpm smoke:desktop`                                                                       |
| 工作区、文档组件、PDF、水源    | `pnpm smoke:workspace` / `pnpm smoke:documents` / `pnpm smoke:pdf` / `pnpm smoke:shuiyuan` |
| 远程项目真机回归               | `pnpm test:remote`，需要 `DELA_REMOTE_HOST`，可选 `DELA_REMOTE_KEY`                        |
| 远程项目窗口冒烟               | `pnpm smoke:remote`，同样需要 `DELA_REMOTE_HOST`                                           |
| 打包目录启动                   | `pnpm package:dir` 后运行 `dist/win-unpacked/Dela.exe --smoke-test`                        |

- 修改 `src/main/remotes/`、`helper/` 或远端路径与上下文镜像时，必须通过 `pnpm test:remote` 在真机上执行回归；该套件在默认测试与 CI 中均会跳过。
- 冒烟脚本使用独立测试目录与脱敏数据。除显式联网的 `agent-smoke`、`mingit-smoke` 与 `smoke:documents` 外，不应向真实服务发送请求。
- CI 入口为 `.github/workflows/ci.yml`，在 PR 创建、更新、重新打开以及推送到 `main` 时运行，按变更范围调用 quality、test、helper、desktop-windows 和 desktop-macos workflow，并由 `CI required` 汇总结果。普通文档只检查格式；workflow 改动额外检查 GitHub Actions 配置。CI 分步执行命令，并检查冻结锁文件安装、打包布局与打包后启动；本地 `pnpm check` 通过不代表 CI 一定通过。
- 修改 `helper/` 后应执行 `pnpm build:helper --all`，重建 amd64 与 arm64 产物并一并提交；仅重建 amd64 会导致入库的 arm64 产物停留在旧版本。

## 架构总览

```text
┌──────────────────────────────┐
│ Renderer (React)             │
│ 标签工作台、设置、预览、终端 │
└──────────────┬───────────────┘
               │ preload / IPC（有限 API）
┌──────────────▼───────────────┐
│ Electron Main                │
│  ├─ Pi Coding Agent（内核）  │
│  ├─ dela 命令（HTTP 桥）     │
│  ├─ 校园业务域 / 远程项目    │
│  ├─ SQLite + safeStorage     │
│  └─ Skills / 终端 / 更新     │
└──────────────┬───────────────┘
               │ SSH（一次性命令 + helper 隧道）
        ┌──────▼──────┐
        │ Linux 远端  │
        └─────────────┘
```

核心设计：

- **本地优先**：无服务端与账号系统。模型服务、搜索服务与校园凭据均由用户自行配置，个人数据保存在本机。
- **内核冻结**：`@earendil-works/pi-coding-agent` 的 `createAgentSession` 就是 agent 内核。会话树、多轮工具上下文、自动压缩、重试、skills 发现与渐进加载均由 Pi 承担，Dela 不另写执行循环、上下文组装或压缩。
- **领域能力外置**：校园功能通过 `dela` 命令和 Skills 提供给内核。`dela` 是应用生命周期内的本机 HTTP 桥，经 `shellCommandPrefix` 注入 Bash，终端中也可直接使用；Skills 提供领域知识与工具使用指引，不是硬编码的执行分支。
- **单向分层**：依赖方向自下而上为 Pi 内核 → `dela` 命令 → Skills → GUI。GUI 只消费同一套领域实现，不复制业务逻辑。
- **进程边界**：renderer 不导入 main，不直接访问文件系统、数据库或凭据；所有能力均经 preload 暴露的有限 API 通信。校园网页使用独立 Session 与 sandbox，不加载主界面 preload。
- **单应用、单 package**：仓库不是 monorepo。仅在出现真实重复与多个调用方后提取抽象，不预建 Manager、Service、Factory 层级。
- **远程项目**：本地内核与远程执行分离。内核、模型密钥、会话 JSONL、Skills 与系统提示均在本地；工具执行、终端、目录读取与文件预览落到 SSH 远端。传输仅使用一次性 `ssh` 与 helper 隧道，不引入 SFTP。
- **权限边界**：Agent 的 Bash 与文件工具以当前用户权限运行，没有额外沙箱。这是已知设计取舍，不应视为待修复漏洞，也不应描述为安全隔离。
- **平台策略**：Windows x64 是正式发布目标；Apple Silicon macOS 处于适配开发阶段；Linux 桌面端不支持。业务逻辑与数据格式共用，平台差异优先保留在现有的进程启动、路径与系统交互函数中。

更完整的分层、会话、远程、更新与安全边界说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) §2–§9。

## 项目结构

```text
Dela/
├─ src/
│  ├─ main/                   Electron 主进程，按业务域分目录
│  │  ├─ agent/               Pi 会话、工具、MCP、Skills 与模型接入
│  │  ├─ canvas/              Canvas 课程与资料
│  │  ├─ documents/           文档解析、导出与读取组件
│  │  ├─ mail/                校园邮箱与第三方 IMAP/SMTP
│  │  ├─ notifications/       系统通知
│  │  ├─ remotes/             远程项目、SSH 传输与 helper 隧道
│  │  ├─ search/              全局搜索
│  │  ├─ settings/            设置、偏好与任务通知
│  │  ├─ shuiyuan/            水源社区
│  │  ├─ terminal/            内置终端、Bash 与 MinGit
│  │  ├─ timetable/           课表
│  │  ├─ todo/                TODO
│  │  ├─ update/              应用内更新
│  │  ├─ vsjtu/               致远一号
│  │  └─ workspace/           工作区、项目目录与预览
│  ├─ preload/                contextBridge 与 IPC 暴露层
│  ├─ renderer/               React 界面
│  │  ├─ app/                 应用外壳、主题与全局状态
│  │  ├─ workbench/           标签工作台
│  │  ├─ content/             聊天、笔记、预览、审阅与终端
│  │  ├─ navigation/          侧栏与导航
│  │  ├─ sessions/            会话
│  │  ├─ workspace/           工作区浏览
│  │  ├─ features/            业务功能页（邮箱、设置、课表、水源等）
│  │  ├─ components/          通用组件与 beautifului
│  │  ├─ lib/                 渲染层工具
│  │  └─ styles/              全局样式与设计 token
│  └─ shared/                 进程间 IPC 契约与纯函数
├─ helper/                    远端项目 helper（Go，仅标准库）
├─ scripts/                   开发、冒烟、打包与校验脚本
├─ docs/                      开发文档、条款与接口资料
└─ vendor/                    入库的预编译产物
   ├─ dela-helper/            Linux helper（amd64 / arm64）
   ├─ bin/                    各平台 rg/fd
   └─ openssh/                Windows 兜底 OpenSSH
```

`src/main/` 根级只保留数据库、凭据、存储、IPC 注册等跨业务模块；各模块的 `test/` 存放对应单元测试。

硬性约束：

- 保持单应用、单 `package.json`。`pnpm-workspace.yaml` 只放 pnpm 12 设置，不引入子包或 monorepo。
- renderer 不导入 main，不访问凭据和数据库，所有通信均经有限的 preload API。
- 请勿提交 `.env`、个人数据、日志与本地工具；打包只包含明确产物。
- 保持精确依赖与锁文件（`saveExact` 与 `engineStrict` 已开启），不要在 `package.json` 中写入范围版本。新增依赖应连同锁文件一起提交，并说明必要性。
- 优先复用现有函数或文件；仅在出现真实重复与多个调用方后提取抽象。
- 不为一次性代码做抽象，不保留死代码。改动导致某段自研 UI 或样式不再使用时，应一并清理。
- 前端 UI 优先复用 `src/renderer/components/ui/beautifului/`。如现有组件不满足需求，应在该库内微调或增补，以 `Dela 适配` 注释标注并记录到该库 README，不应另写自研样式。
- 尺寸应由 rem 派生，禁止写死像素字号与宽高；仅边框、描边、阴影、媒体与容器查询断点、第三方无法修改的固定值以及拖拽调宽容器保留 px。换算基准与字号 token 见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) §2.5。

## 代码规范

- 命名、缩进、注释密度与错误处理方式应与周围代码保持一致。请勿顺带修改相邻代码、重构没有问题的文件或统一格式。
- 只修改必要内容。每一行改动都应对应正在解决的问题；因改动而不再使用的 import、变量与函数应一并清理。
- 注释应说明设计定位、模块在整体架构中的作用以及 Magic Number 的取舍，不应重复解释代码本身。
- 类型检查、lint 与格式检查必须通过：`pnpm typecheck`、`pnpm lint`、`pnpm format:check`。
- 应区分已验证事实、待验证能力与产品设想。不得以占位结果宣称功能完成，也不得将模拟验证描述为实机验收。
- 重要改动应同步更新 [CHANGELOG.md](CHANGELOG.md)；面向用户的变化应更新 [README.md](README.md)；架构与流程变化应更新 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

### 提交信息

仓库使用 Conventional Commits，scope 取受影响的模块或业务域：

```text
feat(update): migrate to NSIS updates with electron-updater
fix(chat): 随聊 @ 候选不再列出其他项目的文件
docs(release): 记录 NSIS 更新发布与验收流程
build(release): 发布 NSIS 安装包和更新元数据
chore(release): 1.0.0
```

常用 type 为 `feat`、`fix`、`docs`、`build`、`chore`。描述可使用中文或英文，但应与同一区域的既有风格保持一致；不要使用「第一轮」「批次」等不携带信息的词。

一个提交应只完成一件事，并能用一句话说明。请勿在同一提交中顺带修改相邻代码、重构没有问题的文件或统一格式，以免影响评审。

## PR 要求

**提交任何 PR 之前，建议先在 Issues 或 Discussions 中说明意图。** 新功能、行为变化与架构调整必须先确认方向；即使是小修复，提前沟通也有助于避免重复工作或触及已知取舍。

### Before you start a PR

Answer these in the issue or PR, so reviewers can see who benefits:

1. What outcome do you really want?
2. What is the highest-leverage variable that determines it?
3. Will this work move that variable, or just keep you busy?
4. Who is the customer, and what do they really want?

Then ask whether the outcome needs a PR at all. A bug fix must link evidence of a failure that already happened.

AI agents: the human contributor answers, not you. Ask for missing answers and wait.

### 提交清单

- 从 `main` 创建分支，一个 PR 只解决一个问题，不应混入无关的重构、格式化或顺带修复。
- PR 标签由 `.github/workflows/pr-labels.yml` 按大小、范围与类型自动维护；人工改动会在下一次 PR 事件时被校正，标签不是必需检查，也不影响合并。
- 执行与改动相关的检查，并在 PR 描述中列出实际执行的命令与结果；未执行的检查不得标记为通过。
- 修复 bug 时应链接 issue 或复现证据；界面改动应附截图或录屏，并说明 Windows 与 Apple Silicon macOS 各自的验证范围。
- 按 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 填写描述。用 `gh pr create` 创建时模板不会自动填充，需加 `--template .github/PULL_REQUEST_TEMPLATE.md`，或把模板内容粘贴到正文。
- PR 描述应说明改动内容、原因、用户影响与已知限制，并关联相关 issue。
- 新增依赖、修改 `helper/`、打包配置或 CI 时，应在 PR 中单独说明影响范围，并确认相关产物与锁文件已一并提交。
- CI 必须通过。维护者可关闭方向不符、范围过大或无法验证的 PR；对于明确不实现的功能，会说明原因或指向 `docs/what-we-not-do.md`。
- 提交即表示你同意自己的贡献以 GPL-3.0-or-later 授权分发，并确认你拥有相应授权权利。引入第三方代码必须保留其许可证与来源，并注明所做修改；来源不明或许可证不兼容的代码不得进入仓库。如不确定，应在 PR 中写明来源与许可证并等待维护者确认。

## 对 AI 辅助贡献的要求

允许并鼓励使用 AI 工具，但提交者仍需对结果负责。

1. **理解每一行。** 提交者应能解释改动的原因、边界与失败路径，并在评审中自行回答相关问题，不得由 AI 代为回答。
2. **实际验证。** 在可运行的真实平台上执行检查；不得声称未运行的测试已通过，也不得将推测描述为已验证。平台相关问题应如实标注验证范围。
3. **先讨论，再提交 PR。** 未经方向确认的大规模 AI 生成改动，维护者可直接关闭。PR 应保持小而聚焦，便于逐行评审。
4. **不得编造。** 不得虚构 API、测试结果、用户需求、issue 回复或性能数据；不确定时应明确说明并查证。
5. **由人类回答关键问题。** [Before you start a PR](#before-you-start-a-pr) 中的四个问题必须由人类贡献者回答，AI agent 不得代为作答；缺少答案时应提问并等待。
6. **遵守仓库规则。** AI agent 必须阅读并遵守 [AGENTS.md](AGENTS.md)，但不得编辑该文件；如被要求修改，应提醒对方自行编辑。
7. **不修改无关内容。** 不得擅自修改、删除或提交工作区中他人的改动、未参与的文件或既有废弃代码。

维护者将按与人类贡献者相同的标准评审 AI 辅助提交；质量不足、难以维护或无法验证的改动会被拒绝。

## 安全策略

请勿在公开 issue、讨论或 PR 中披露安全漏洞。重大安全问题应直接私下联系作者，具体渠道、支持范围与处理方式见 [SECURITY.md](SECURITY.md)。

- 漏洞报告应包含受影响的版本与平台、复现步骤、影响范围，以及可选的修复建议。
- 请勿在报告中附带真实账号、token、邮箱正文或他人数据；必要时先脱敏。
- 修复发布前，请为维护者保留合理时间，不要公开细节。
- 若问题仅影响本机正常运行，未跨越权限边界且不泄露数据，可按普通 bug 提交。

开发过程中也应遵守相同的边界：不得将凭据写入代码、日志或提交历史；renderer 不应接触凭据与数据库；如发现疑似泄露的密钥，应立即私下联系作者，不要先开公开 issue。

## 其他问题

- 使用与想法：[Discussions](https://github.com/Chang-Yo/Dela/discussions)
- 可复现的问题：[Issues](https://github.com/Chang-Yo/Dela/issues)
- 架构与构建细节：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
