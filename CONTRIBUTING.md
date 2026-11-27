# 贡献指南

欢迎参与 Dela 的开发与维护。Dela 是面向 SJTU 用户的本地优先 Agent 桌面应用：Electron 主进程与 React 渲染进程，Agent 内核为 Pi Coding Agent，领域能力通过 `dela` 命令与 Skills 外置。数据保存在本机 SQLite，账号凭据经 Electron `safeStorage` 加密，模型服务与 MCP 配置在 `~/.dela` 下的 JSON 中，无服务端与账号系统。

贡献形式包括代码、文档、测试、设计、问题反馈，以及向需要的用户介绍 Dela。开始之前，请先阅读本指南的[架构](#架构)与 [AGENTS.md](AGENTS.md)。

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

代码改动通过以 `dev` 为目标的 Pull Request 提交，具体要求见 [PR 要求](#pr-要求)。即使改动较小，也建议先在 issue 或讨论中说明；维护者可提前指出是否存在更简单的方案。

### 分支与合并流程

- `dev` 是默认开发分支。从最新的 `dev` 创建功能分支，贡献 PR 统一提交到 `dev`；使用 GitHub CLI 时指定 `--base dev`。
- `main` 用于发布集成，只有仓库管理员可以发起 `dev` → `main` 的 PR。普通贡献者不得向 `main` 提交 PR。
- 合并前完成评审与相关检查，合并后删除功能分支。fork 贡献者从上游 `dev` 同步代码，PR 目标选择 `Chang-Yo/Dela:dev`。

### 推广与文档

- 在班级群、社团、技术社区介绍 Dela，或撰写使用体验、教程与问题记录，均有助于项目推广。
- 文档纠错与补充说明可直接提交 PR。面向用户的变化应同步更新 README，重要改动应同步更新 CHANGELOG。
- 发现安全漏洞时请勿公开讨论，应按 [SECURITY.md](SECURITY.md) 的方式私下联系作者。

## 开发环境

| 工具            | 版本                               | 何时需要                 |
| --------------- | ---------------------------------- | ------------------------ |
| Node.js         | `.node-version`                    | 总是                     |
| pnpm            | `package.json` 的 `packageManager` | 总是                     |
| Git for Windows | 不固定                             | Windows 上 Agent 的 Bash |
| Go              | `go.mod` 声明 1.22，CI 固定 1.27.2 | 只在改动 `helper/` 时    |

CI 使用上述固定版本，本地推荐与 CI 一致。`package.json` 的 `engines` 声明兼容范围，`engineStrict` 拒绝范围之外的版本。

在 Windows 上，可将 Node 与 pnpm 安装到仓库内被 Git 忽略的 `.tools/` 目录，并在 PowerShell 中为当前会话启用：

```powershell
. ./scripts/use-local-tools.ps1
```

新克隆的仓库不包含 `.tools/`，需自行安装上述版本。Apple Silicon Mac 也可将校验后的官方 Node 压缩包解压到 `.tools/`，保留原目录名，然后在当前 shell 中启用：

```sh
export PATH="$PWD/.tools/node-v$(cat .node-version)-darwin-arm64/bin:$PATH"
```

安装依赖并启动开发窗口：

```sh
pnpm install
pnpm dev
```

`pnpm install` 的 `postinstall` 会下载 Electron 运行时，并在 macOS 上修正 `node-pty` 的 `spawn-helper` 可执行位。

在 Windows 上，Git for Windows 是运行前提而非可选项：Agent 的 Bash 工具依赖它（内置终端跟随系统 shell，不依赖它）。macOS 使用系统 `/bin/bash` 与本机 Git/SSH，无需安装 MinGit。Go 仅与 `helper/` 有关；远端 helper 的静态二进制已入库在 `vendor/dela-helper/`，日常开发不需要 Go。

模型服务、搜索服务与校园服务凭据均在应用设置中配置。请勿提交 `.env`、个人数据、日志与本地工具。

构建基线为 Windows 10 x64 与 macOS 13.0 arm64；这只是构建基线，不代表最低系统已经过实机验收。

macOS 本地验证不找签名身份、不发布：先运行 `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dist --mac --arm64 -c.electronDist=node_modules/electron/dist`，再用 `scripts/verify-macos-package.ts` 与 `--smoke-test` 检查 `.app`。这些检查不代表正式签名应用、全部账号业务或全部模型调用已验收。

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

| 场景                     | 命令                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Electron 基础冒烟        | `pnpm smoke`                                                                                     |
| 离线运行时与 `dela` 桥   | `pnpm smoke:runtime`                                                                             |
| 原生菜单、窗口关闭与恢复 | `pnpm smoke:desktop`                                                                             |
| 工作区、水源             | `pnpm smoke:workspace` / `pnpm smoke:shuiyuan`                                                   |
| 远程项目真机回归         | `pnpm test:remote`（先 `pnpm fetch:remote-rg`），需要 `DELA_REMOTE_HOST`，可选 `DELA_REMOTE_KEY` |
| 远程项目窗口冒烟         | `pnpm smoke:remote`，同样需要 `DELA_REMOTE_HOST`                                                 |
| 打包目录启动             | `pnpm package:dir` 后运行 `dist/win-unpacked/Dela.exe --smoke-test`                              |

- 修改 `src/core/remote/`、`src/modules/remotes/`、`helper/` 或远端路径与上下文镜像时，必须通过 `pnpm test:remote` 在真机上执行回归；该套件在默认测试与 CI 中均会跳过。
- 涉及构建、原生依赖或打包时，另跑 `pnpm smoke` 并启动打包目录。
- 冒烟脚本使用独立测试目录与脱敏数据。除显式联网的 `agent-smoke` 外，不应向真实服务发送请求；启动应用的冒烟必须把 home 指向临时目录。
- CI 入口为 `.github/workflows/ci.yml`，在 PR 变更及推送到 `dev`、`main` 时运行，按变更范围调用 quality、test、helper、desktop-windows 和 desktop-macos workflow，并由 `CI required` 汇总结果。普通文档只检查格式；workflow 改动额外检查 GitHub Actions 配置。CI 分步执行命令，并检查冻结锁文件安装、打包布局与打包后启动；本地 `pnpm check` 通过不代表 CI 一定通过。
- 修改 `helper/` 后应执行 `pnpm build:helper --all`，重建 amd64 与 arm64 产物并一并提交；仅重建 amd64 会导致入库的 arm64 产物停留在旧版本。
- 升级 `extraResources` 时按各目录 README 的升级步骤做（`vendor/openssh/`、`vendor/bin/`），并在打包目录里实跑：`ssh.exe -V` 与一次真实连接，rg、fd 的 `--version`。MinGit 只改 `scripts/prepare-runtime.ts` 里成对的版本与 SHA256 常量；远端 rg 的版本与 SHA256 只在 `scripts/fetch-remote-rg.ts`，二进制不入库。helper 由发布与 CI 从当次源码重建。

## 架构

改代码前先读这一节。依赖规则由 `pnpm lint` 检查；设计原则靠评审守住，要推翻其中一条，先和维护者讨论，理由写进 commit。

```text
┌──────────────────────────────┐
│ Renderer (React)             │
│ 标签工作台、设置、预览、终端 │
└──────────────┬───────────────┘
               │ preload / IPC（契约白名单）
┌──────────────▼───────────────┐
│ Electron Main                │
│  ├─ Pi Coding Agent（内核）  │
│  ├─ dela 命令（HTTP 桥）     │
│  ├─ 模块 / 远程项目          │
│  ├─ SQLite + safeStorage     │
│  └─ Skills / 终端 / 更新     │
└──────────────┬───────────────┘
               │ SSH（一次性命令 + helper 隧道）
        ┌──────▼──────┐
        │ Linux 远端  │
        └─────────────┘
```

### 目录与分层

```text
Dela/
├─ src/
│  ├─ core/                   Agent 内核，不依赖 Electron、React 与业务
│  │  ├─ protocol/            Agent 协议、模块契约工具与桌面私有视图类型（只依赖 zod）
│  │  ├─ agent/               Pi 接入、会话、旁问、子 Agent 与后台任务
│  │  ├─ capabilities/        工具、Skills、MCP、联网与注册表
│  │  ├─ remote/              远程执行后端与 helper 通道
│  │  ├─ data/                会话表的结构与迁移
│  │  ├─ config-files.ts      ~/.dela 下的 JSON 配置（模型服务、联网搜索、MCP）
│  │  └─ ports.ts             宿主端口（HostPorts）
│  ├─ ui/                     Design System（fork 自 beautiful-ui），零业务依赖
│  │  └─ agent/               Agent 对话外观组件（消息、工具卡片、输入框）
│  ├─ modules/                通用模块，没有交大也成立（chat、mail、note、notifications、
│  │                          onboarding、preview、remotes、search、settings、terminal、
│  │                          todo、update、workspace）
│  ├─ sjtu/                   交大模块，离开交大就没有意义，经 register() 向通用模块登记
│  │  ├─ campus/              校园统一身份认证会话（课表、课堂视频、水源共用）
│  │  ├─ canvas/              Canvas 课程资料、作业与公告
│  │  ├─ classroom/           课堂视频回看（v.sjtu.edu.cn）
│  │  ├─ jwc/                 教务处通知
│  │  ├─ mail/                交大邮箱的服务器预设，登记给通用邮件模块
│  │  ├─ shuiyuan/            水源社区
│  │  └─ timetable/           课表（只读）
│  └─ app/                    宿主与外壳
│     ├─ module.ts            模块与视图定义，模块唯一可引用的 app 文件
│     ├─ modules.ts           主进程模块清单
│     ├─ views.ts             渲染端视图清单
│     ├─ main/                Electron 入口、数据库、旧版数据过渡、IPC 注册与宿主端口实现
│     ├─ preload/             contextBridge 与按契约白名单放行的 bridge
│     └─ renderer/            外壳界面：shell、workbench、navigation、workspace、settings、styles
├─ helper/                    远程项目的 Go helper
├─ scripts/                   开发、冒烟、打包与校验脚本
├─ docs/                      条款与功能边界
├─ vendor/                    入库的 helper 产物、rg/fd 与 Windows 兜底 OpenSSH
├─ LICENSES/                  随源码分发的第三方许可证
├─ assets/                    图标与品牌素材
└─ build/                     打包用图标等构建资源
```

每个模块按需包含 `index.ts`（模块定义，主进程侧出口）、`contract.ts`（main 与 view 之间的契约）、`main/`、`view/`（`view/index.ts` 是界面侧出口）、`data/`（`data/schema.ts` 是本模块的表与迁移）；Agent 的命令域与 Skill 放在 `main/agent/`。测试放在源码旁或同目录的 `test/` 下。

依赖规则：

1. `core` 不依赖 Electron、React，也不引用 `app`、`modules`、`sjtu`、`ui`，宿主能力经 `core/ports.ts` 注入；`core/protocol` 只依赖 zod
2. `ui` 只依赖 react、radix、cva、lucide、zustand、DOMPurify 与样式工具；`ui/agent` 建在基础组件之上，基础组件不能反过来引用它
3. 模块之间只通过对方的 `index.ts`、`contract.ts` 或 `view/index.ts` 引用；`view/` 只能引用 `core/protocol`、`app/module.ts`、其他模块的 `contract.ts` 与 `ui`，不能引用本模块的 `main/`；主进程侧不能引用 `view/`
4. `core`、`modules`、`app` 都不能引用 `sjtu`，例外是 `app/modules.ts`、`app/views.ts` 两份清单。通用模块需要交大数据时，在通用模块的 `index.ts` 里开注册口，由交大模块注册进来。CI 还会去掉全部交大模块后再做类型检查、构建与冒烟
5. 模块只能引用 `app/module.ts`，不能引用 app 的其他部分
6. `app/module.ts` 不引用任何模块，它与模块共用的类型放在 `core/protocol`
7. 项目快捷方式的 sourceId 前缀以模块名开头（如 `canvas-`、`shuiyuan-topic:`），前缀重叠时登记直接报错

### 改动落在哪里

| 你要做的事                         | 改动位置                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------- |
| 只改某个功能的界面                 | `modules/x/view` 或 `sjtu/x/view`                                         |
| 交大接口改版，或需要从学校取新数据 | `sjtu/x/main`                                                             |
| 新增一个交大功能                   | 新建 `sjtu/x/`，并在 app 的两份清单里按需各加一行                         |
| 让 Agent 获得某个领域的新能力      | 对应模块 `main/agent/` 里的命令域与 Skill                                 |
| 一个模块需要另一个模块的数据       | 调用对方的 `index.ts`；通用模块需要交大数据时开注册口                     |
| 让 Agent 获得通用的新工具          | `core/capabilities`                                                       |
| 移动端也需要的新能力               | `core/protocol`，**先和维护者确认版本策略**                               |
| 新的跨模块概念                     | `core` 或 `app/module.ts`，**先和维护者讨论**，结论补进下面的「设计原则」 |

拿不准放 `modules` 还是 `sjtu` 时，问一句：如果交大不存在，这个功能还有意义吗？

### 设计原则

- **优化目标**：单用户桌面应用，响应速度取决于 LLM。不追求可伸缩与极致性能，保持单一部署单元，不拆进程，不引入微服务；单应用、单 `package.json`，不做 monorepo。按功能组织目录，让改动范围能从目录预测。
- **本地优先**：无服务端与账号系统。模型服务、联网搜索与 MCP 是 `~/.dela` 下的明文 JSON，与 Claude Code、Codex 的做法一致，方便 magpie 等工具管理，读写时保留不认识的字段与条目；学校账号的凭据经 `safeStorage` 加密保存。
- **Pi 是 core 的私有引擎**：执行循环、会话树、上下文组装与压缩、重试与 Skills 加载都交给 Pi，Dela 不另写。Pi 的类型不出 `core`，界面只看 Dela 自己的视图类型。模型厂商以 Pi 的目录为准，Dela 不维护自己的预设。第三方能力只经 Agent Skills（项目级只认 `.agents/skills`）与 MCP 接入，不支持 Pi Packages 与代码钩子。
- **领域能力外置**：校园功能经 `dela` 命令与 Skills 交给内核。`dela` 是应用运行期间的本机 HTTP 桥，经 `shellCommandPrefix` 注入 Agent 的 Bash（内置终端不注入）；Skills 提供领域知识与用法指引，不是硬编码的执行分支。
- **两种契约**：模块的 `contract.ts` 只连接同一模块的 main 与 view，可以随时改。Agent 协议（`core/protocol/agent.ts`）由桌面与移动端共用，只能新增，不兼容的改动要升 `AGENT_PROTOCOL_VERSION`。新功能先判断它属于 Agent 交互（进协议）还是桌面便利功能（不进协议）。协议 v1 以单用户为前提：不做多端冲突处理，不加事件序号，本地路径照传。
- **进程边界**：renderer 不导入 main，不直接访问文件系统、数据库或凭据，只经 preload 按契约白名单放行的 `bridge` 通信。校园网页使用独立 Session 与 sandbox，不加载主界面 preload。
- **数据归属**：会话与项目文件归桌面端 core，移动端经协议访问；待办、笔记、草稿只在桌面；学校数据由桌面端与移动端各自直连学校。跨部署单元时，重复比耦合好。
- **数据库**：只有一个 `dela.db`。谁的表谁在 `data/schema.ts` 声明，只有表的主人写自己表的 SQL；迁移按 `YYYYMMDD-简述` 命名登记，fork 与上游不会撞号；跨模块外键只能顺着代码的依赖方向。
- **模块协作的优先顺序**：直接调用对方的 `index.ts`；一个使用方、多个提供方时，由使用方开注册口；有多个监听方时才用事件。注册表是主进程唯一允许的模块级可变状态，只在启动时写入，不做自动扫描。
- **界面状态按归属放**：后端数据只在 TanStack Query 的缓存里存一份；主进程推送的完整状态写入同名查询的缓存，增量事件流进领域 store，都只在启动时订阅一次；页面跳转只有 `navigate(target)`；外壳的接入点是视图定义里的声明式字段。
- **不提前抽象校园**：只有交大一个样本，不建「高校兼容层」。出现第二所学校时，再从两份真实实现里提炼共性。
- **待办是用户安排的唯一入口**：课表只显示学校课程，只读。需要同时看课程与个人安排时，由 Agent 分别读取，界面不合并。
- **远程项目**：内核、模型密钥、会话、Skills 与系统提示都在本地；工具执行、终端、目录读取与文件预览落到 SSH 远端。传输只用一次性 `ssh` 与 helper 隧道，不引入 SFTP。
- **权限边界**：Agent 的 Bash 与文件工具以当前用户权限运行，没有额外沙箱。这是已知设计取舍，不应视为待修复漏洞，也不应描述为安全隔离。
- **平台**：正式发布 Windows x64 与 Apple Silicon macOS，Linux 桌面端不支持。业务逻辑与数据格式共用，平台差异收在进程启动、路径与系统交互函数里。

## 代码规范

- 命名、缩进、注释密度与错误处理方式应与周围代码保持一致。请勿顺带修改相邻代码、重构没有问题的文件或统一格式。
- 只修改必要内容。每一行改动都应对应正在解决的问题；因改动而不再使用的 import、变量与函数应一并清理。
- 注释应说明设计定位、模块在整体架构中的作用以及 Magic Number 的取舍，不应重复解释代码本身。
- 类型检查、lint 与格式检查必须通过：`pnpm typecheck`、`pnpm lint`、`pnpm format:check`。
- 保持精确依赖与锁文件（`saveExact` 与 `engineStrict` 已开启），不要在 `package.json` 中写入范围版本。新增依赖应连同锁文件一起提交，并说明必要性。`dependencies` 只放主进程运行时要加载的包（electron-builder 会连闭包原样收进 asar），渲染层依赖放 `devDependencies`；放错边等于把 npm 目录再装一遍，安装包会变大。
- 优先复用现有函数或文件；仅在出现真实重复与多个调用方后提取抽象。
- 不为一次性代码做抽象，不保留死代码。改动导致某段自研 UI 或样式不再使用时，应一并清理。
- 前端 UI 优先复用 `src/ui`。如现有组件不满足需求，应在该目录内微调或增补，不应另写自研样式。
- 尺寸应由 rem 派生，禁止写死像素字号与宽高；仅边框、描边、阴影、媒体与容器查询断点、第三方无法修改的固定值以及拖拽调宽容器保留 px。换算基准与字号约定见 [src/ui/README.md](src/ui/README.md)。
- 应区分已验证事实、待验证能力与产品设想。不得以占位结果宣称功能完成，也不得将模拟验证描述为实机验收。
- 重要改动应同步更新 [CHANGELOG.md](CHANGELOG.md)，条目保持简短：更新内容弹窗会原样展示每个版本的条目；面向用户的变化应更新 [README.md](README.md)；架构与流程变化应更新本文件。

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

### 提交清单

- 遵守[分支与合并流程](#分支与合并流程)。一个 PR 只解决一个问题，不应混入无关的重构、格式化或顺带修复。
- PR 标签由 `.github/workflows/pr-labels.yml` 按大小、类型与改动的架构层和模块（`core`、`sjtu`、`mod:chat`、`sjtu:canvas` 等，缺少时自动创建）维护；人工改动会在下一次 PR 事件时被校正，标签不是必需检查，也不影响合并。
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

## 发布

面向维护者。tag 与 `package.json` 版本一致、`latest.yml` 与 `app-update.yml` 齐全、已公开的版本不覆盖重发，这些由 `release.yml` 检查；这里只记检查不到的事。

- Rulesets 无法限制 PR 发起人或来源分支，合并前需确认指向 `main` 的 PR 由管理员发起且来自 `dev`。
- 升版用 `pnpm version:patch`、`version:minor`、`version:major` 或 `version:bump`，它们只改 `package.json` 的版本，不建 commit 与 tag。
- 发版前把 `CHANGELOG.md` 的 `## Unreleased` 改成 `## <版本> - <发布日>`。更新内容弹窗只认 `## X.Y.Z - 日期`，留在 `Unreleased` 下的条目会被静默跳过。
- 推 `v*` tag 触发 `release.yml`。`CI required` 会按路径跳过任务，不能替代全部发布检查。
- 更新源是自有 CDN 的 Generic provider，由独立侧同步，CI 不持有 CDN 凭据；同步时安装包与 blockmap 必须先于元数据就绪。
- 云端冒烟不能替代签名、公证与自动更新验收。

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
- 架构：本指南的[架构](#架构)；编码规则：[AGENTS.md](AGENTS.md)
