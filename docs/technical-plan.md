# Dela 桌面应用技术规划书

日期：2026-09-09
状态：开发基线；工程已初始化，前端骨架完成。邮箱已实现真实 IMAP 同步、阅读与 SMTP 发送；课表已实现 i.sjtu 会话接入、本地缓存、周/月视图和本地事件，真实账号同步及学期日期格式待验证（2026-09-11，见文末记录）；Canvas 课程资料、文件夹/项目、磁盘笔记、阅读工作区及明确选取正文的模型问答已实现（2026-09-12）；前台 Agent 工具循环、首页入口、邮件草稿及流式文字已接入（2026-09-13）；最新流式改动未验证，真实模型工具调用兼容性与最终打包验收待确认；模型服务已改为多提供商自定义配置（2026-09-14，见文末）。当前实现与验证边界见文末。

## 1. 产品定位与范围

Dela 是一个以 Project 为中心，连接交大校园信息和本地文件，提供轻量编辑与 Agent 协作的桌面工作台。

用户在这里整理资料、建立计划、保存成果，并在多次对话之间持续推进同一件事。课程、邮箱等聚合功能提供事实和操作入口；Agent 根据当前项目的上下文帮助用户工作。

已确定的方向：

- 本地单用户应用，不建设账号服务器和多租户系统。
- 使用 Electron，保持跨平台实现，首先在 Windows 完成验收。跨平台能力不等于已经验证各平台安装包。
- 优先完成主动打开使用的桌面工作台。移动端不纳入当前规划，也不为其提前抽象。
- 支持 Markdown、笔记、计划、检查清单和简单文本编辑。代码开发、运行调试与复杂文档编辑交给 VS Code 等专业软件。
- 校园资料按需关联进项目；不把每封邮件、每门课程自动创建成项目。
- 使用个人可取得的接口、标准协议和本人登录会话。以无法取得 jAccount client_id 为固定前提，不将申请官方应用凭据写入路线图。

首版不包含：云同步、通用插件市场、多 Agent 协作、手机端、无人值守后台自治、通用终端执行、完整 IDE 和 Office 编辑器。

以上首版排除项属于本规划的范围约束；后续如需调整，应先更新本文件。

## 2. 技术栈与版本

### 2.1 固定基线

下表版本来自本次讨论期间对官方文档和 npm 元数据的核对。版本存在和声明范围兼容，不代表整个组合已通过运行验证。初始化时使用精确版本，不使用 `latest`、`^`、`~` 作为直接依赖约束；提交锁文件。

| 层面          | 选型                        | 固定版本 | 职责                              |
| ------------- | --------------------------- | -------- | --------------------------------- |
| 桌面运行时    | Electron                    | 44.3.0   | 窗口、Session、系统能力           |
| 开发运行时    | Node.js                     | 24.21.0  | 安装、开发与构建                  |
| 包管理        | pnpm                        | 12.3.4   | 单包依赖管理                      |
| 语言          | TypeScript                  | 7.0.2    | 类型检查、共享契约                |
| 构建          | Vite                        | 8.2.2    | main/preload/renderer 构建        |
| React 插件    | @vitejs/plugin-react        | 6.1.1    | JSX 转换与开发刷新                |
| 界面          | react / react-dom           | 19.2.8   | 工作台 UI                         |
| 基础交互      | radix-ui                    | 1.6.7    | 菜单、对话框、提示等              |
| 样式          | CSS Modules + CSS Variables | 无独立包 | 组件样式、主题变量                |
| 类名组合      | clsx                        | 2.1.1    | 组合 CSS Modules 状态与变体       |
| 界面过渡      | framer-motion               | 13.2.0   | 面板、抽屉与页面切换动画          |
| 界面状态      | zustand                     | 5.0.15   | 面板、标签页、当前选择            |
| 参数校验      | zod                         | 4.5.4    | IPC、工具参数与必要的外部数据校验 |
| 数据库驱动    | better-sqlite3              | 13.0.3   | 本地 SQLite 访问                  |
| Markdown 编辑 | @codemirror/view            | 6.43.11  | 编辑器视图                        |
| Markdown 语言 | @codemirror/lang-markdown   | 6.5.2    | Markdown 编辑支持                 |
| 编辑器内核    | @codemirror/state           | 6.7.4    | 编辑器状态与事务                  |
| 编辑器语言    | @codemirror/language        | 6.12.4   | 高亮系统（HighlightStyle）        |
| 编辑器命令    | @codemirror/commands        | 6.11.0   | 撤销/重做与默认键位               |
| 代码块语言    | @codemirror/language-data   | 6.5.2    | 围栏代码块语言按需加载            |
| 高亮标签      | @lezer/highlight            | 1.2.3    | 语法标签定义                      |
| Markdown 展示 | react-markdown              | 10.1.0   | 文档和对话渲染                    |
| GFM           | remark-gfm                  | 4.0.1    | 表格、任务清单等                  |
| 代码高亮      | highlight.js                | 11.12.0  | Markdown 代码块展示               |
| 邮箱读取      | imapflow                    | 2.0.0    | IMAP 同步与查询                   |
| 邮件发送      | nodemailer                  | 10.0.1   | SMTP 发送与 MIME 构建             |
| 安装包        | electron-builder            | 26.15.3  | 打包和分发产物                    |
| 逻辑测试      | vitest                      | 5.0.0    | 状态、同步和工具执行测试          |

HTTP 和模型请求使用运行时 `fetch`；凭据保护使用 Electron `safeStorage`；文件操作使用 Node.js API。不额外引入 HTTP 服务端、ORM、Agent 框架或客户端请求框架。

CodeMirror 的其他必需模块已于 2026-09-12 随 Markdown 编辑器落地核对并固定到 `package.json` 和锁文件（见上表）。PDF、Office 解析库需要用真实课件验证后再选；其选型不得阻塞基础项目、文本编辑和 Canvas 元数据功能。

`clsx`、`framer-motion` 和 `highlight.js` 已随 2026-09-10 的前端重构安装并使用：clsx 组合 CSS Modules 的状态与变体；framer-motion 仅用于视图切换的少量过渡（`MotionConfig` 跟随系统减少动态效果设置）；highlight.js 只负责 Markdown 预览代码块展示，不执行代码。继续使用 Prettier 作为格式化工具，不引入 Biome。自动更新等到存在正式发布渠道、签名和更新服务后再选择并引入 `electron-updater`。

### 2.2 构建决定

直接使用 Vite 8 的配置与 JavaScript API，分别构建 main、preload 和 renderer，使用 electron-builder 打包。

不采用 electron-vite 5：其声明的 Vite 支持范围不包含 8。electron-vite 6 在本次核对时仍为 beta，因此不作为基线，也不通过忽略 peer dependency 错误强行组合。

- renderer 按 Chromium 浏览器目标构建。
- main 按 Electron 内置 Node.js 目标构建，Electron、Node 内置模块与原生依赖保持 external。
- preload 生成与沙箱环境兼容的独立产物，不依赖任意 Node.js 模块。
- 开发脚本负责构建顺序、启动 Electron、变更重启和退出清理；不扩展为通用构建框架。
- `better-sqlite3` 必须针对 Electron 运行时验证原生模块加载和打包，不能仅测试系统 Node.js。
- TypeScript 7 用于类型检查。若某个实际采用的工具依赖旧编译器 API，单独评估兼容包；不预先安装两套 TypeScript。
- 工具版本升级主要影响开发与构建性能，不据此承诺应用运行性能提升。

### 2.3 版本与变更纪律

2026-09-14 `release.yml` 新增 `publish-public` 任务：私有 Release 发布成功后，把同一批安装包发布到公开仓库 `Chang-Yo/Dela_releases` 的同名 tag Release，不带说明文字、不用 `--generate-notes`（公开仓库没有可生成的提交历史）；tag 不存在时由 GitHub 在该仓库默认分支最新提交上自动创建，因此不用 `--verify-tag`。跨仓库发布使用 fine-grained PAT（私有仓库 secret `PUBLIC_RELEASE_TOKEN`，仅授权该公开仓库 Contents 读写），内置 `GITHUB_TOKEN` 无跨仓库权限。同时私有与公开发布都改为可重跑同一 tag：Release 已存在时改用 `gh release upload --clobber` 覆盖同名资产再 `--draft=false`，替代原先“删除草稿后重跑”的约束，历史 tag 也可直接重跑补发公开 Release。自动更新元数据（`latest*.yml`、blockmap）暂不发布，待需要时再扩展。跨仓库发布与重跑覆盖行为待 GitHub 首次运行验证。

2026-09-13 `.github/workflows/check.yaml` 在 Ubuntu 上单独运行 Prettier 格式检查与 Oxlint；后者检查 TypeScript/JavaScript 正确性、未使用代码及 React Hook 调用规则。ESLint 暂不引入：其 TypeScript 插件当前 peer 依赖不支持本项目固定的 TypeScript 7。其余矩阵仍在 Windows x64、macOS x64/arm64、Ubuntu x64 上进行锁文件安装、类型与生产构建、单元测试、Electron 冒烟、目录打包和打包后启动检查。PR 创建、更新、重新打开及 main push 会触发；使用与发布一致的 runner 和 Node/pnpm 版本，只读权限，同一 PR/main 的新提交取消旧检查；不生成安装包或发布 Release。必需检查需另在 GitHub 分支规则中配置，跨平台结果待首次 CI 运行确认。

2026-09-11 新增 `.github/workflows/release.yml`：推送与包版本一致的 `v*` tag，或手动指定已有 tag，固定同一提交在 Windows、macOS Intel/Apple Silicon、Ubuntu runner 构建 NSIS、DMG、AppImage。运行基线选择 Windows 10 x64、macOS 13 x64/arm64、Ubuntu 24.04 x64；macOS 最低版本写入 electron-builder 配置。所有平台的生产构建、单元测试、Electron 与打包目录冒烟成功后统一发布 Release；预发布版本自动标记 prerelease。保留 `npmRebuild: false` 和随 better-sqlite3 13 提供的预编译模块，以各平台冒烟检查验证加载。未配置代码签名或 Apple 公证，未宣称最低系统实机兼容性和安装过程已验收；GitHub 跨平台运行结果待首次发布验证。操作方法、产物与重跑约束见 README「自动发布安装包」。

`package.json` 是已安装版本的执行依据，`pnpm-lock.yaml` 锁定传递依赖；本文件记录选择理由和固定基线。初始化设置 `packageManager`，记录开发 Node.js 版本。

应用升版通过 `version:patch`、`version:minor`、`version:major` 或 `version:bump <版本/递增类型>` 调用 npm 内置 SemVer 命令，仅修改包版本，不自动提交、打 tag 或发布。preload 构建时内联 `package.json` 的 version，冒烟检查与 `app.getVersion()` 比较，移除原有 `0.1.0` 硬编码。单包 pnpm 锁文件不保存根应用版本，升版不需要更新依赖锁文件。

本次发布配置本地验证（2026-09-11）：actionlint、相关文件 Prettier 检查、`pnpm build`、7 个单元测试、`pnpm smoke`、Windows x64 NSIS 安装包生成和 `win-unpacked/Dela.exe --smoke-test` 均通过。未执行 NSIS 安装向导，未推送 tag 或创建远端 Release。

初始化验收未通过时记录具体冲突，再局部修改选型与本表，不静默降级。升级必须独立检查类型、构建、核心测试和安装包启动。原生依赖安装脚本仅允许明确需要的包，不全局放开。

## 3. 仓库组织

采用单仓库、单 `package.json`。不引入 Turborepo/Nx，不拆分内部 package。pnpm 12 使用 `pnpm-workspace.yaml` 保存项目设置，仅包含根包，不配置子包；这不改变单应用组织方式。三个进程分别构建，不意味着三个独立产品。

```text
Dela/
|-- README.md
|-- AGENTS.md                         # 后续编码约束
|-- background.md                     # 用户背景与已知约束
|-- knowledge/
|   `-- SJTU_API_References.md         # 公开参考索引
|-- docs/
|   `-- technical-plan.md             # 产品与技术基线（本文）
|-- src/
|   |-- main/
|   |   |-- index.ts                  # 生命周期、主窗口
|   |   |-- ipc.ts                    # 共用 IPC 来源校验
|   |   |-- database.ts               # 数据库初始化与迁移
|   |   |-- credentials.ts            # 凭据保护
|   |   |-- storage.ts                # 共用存储路径规则
|   |   |-- resources.ts              # 跨业务文件流转
|   |   |-- mail/
|   |   |   |-- api.ts                # 邮箱业务入口
|   |   |   |-- ipc.ts                # 邮箱 IPC、对话框与退出协作
|   |   |   |-- send.ts               # MIME/SMTP 与写信附件
|   |   |   `-- drafts.ts             # Agent 原始草稿与本地编辑草稿
|   |   |-- canvas/
|   |   |   |-- api.ts                # 课程、资料与同步
|   |   |   `-- ipc.ts                # 页面通信与下载对话框
|   |   |-- timetable/
|   |   |   |-- api.ts                # 课表与日程业务
|   |   |   `-- ipc.ts                # 课表页面通信
|   |   |-- workspace/
|   |   |   |-- api.ts                # 条目、笔记、文件操作
|   |   |   |-- ipc.ts                # 工作区页面通信
|   |   |   `-- preview.ts            # PDF 预览协议
|   |   `-- agent/
|   |       |-- api.ts                # 聊天上下文、保存和运行态
|   |       |-- ipc.ts                # 聊天 IPC（兼容 workspace 通道名）
|   |       |-- loop.ts               # 模型请求、流式响应与工具循环
|   |       `-- tools.ts              # 工具描述与领域调用
|   |-- preload/
|   |   `-- index.ts                  # contextBridge
|   |-- renderer/
|   |   |-- index.html
|   |   |-- main.tsx                  # 仅挂载 React
|   |   |-- App.tsx                   # 应用外壳与页面入口
|   |   |-- styles/
|   |   |   |-- tokens.css            # 设计 token 与明暗主题
|   |   |   `-- globals.css           # reset 与窗口级全局规则
|   |   |-- components/               # 真实复用的 UI；样式就近放置
|   |   `-- features/
|   |       |-- home/
|   |       |-- projects/
|   |       |-- sources/
|   |       |-- mail/
|   |       |-- timetable/
|   |       |-- chat/
|   |       |-- editor/
|   |       `-- settings/
|   `-- shared/
|       `-- api.ts                    # IPC 类型和参数约定
|-- scripts/
|   `-- dev.mjs                       # 启动、构建监听、退出清理
|-- resources/                        # 图标等随应用分发的资源
|-- vite.main.config.ts
|-- vite.preload.config.ts
|-- vite.renderer.config.ts
|-- electron-builder.yml
|-- tsconfig.json
|-- tsconfig.main.json
|-- tsconfig.preload.json
|-- tsconfig.renderer.json
|-- package.json
|-- pnpm-lock.yaml
|-- pnpm-workspace.yaml               # pnpm 12 设置，无子包
`-- .gitignore
```

这是目标组织约定，不要求预先建立空目录。React 组件使用同目录的 `*.module.css`，页面样式留在对应 feature；全局样式只保存设计 token、reset 和窗口级规则。模块可用 `index.ts` 暴露少量公共入口，但不建立导出整个 renderer 的总入口。测试紧邻实现，例如 `agent/run.test.ts`；测试样例必须脱敏。

不默认新增 Manager、Service、Factory、Adapter、Registry 等类型或层级。不创建无明确归属的巨大 `utils.ts`。界面样式与仅被本功能使用的组件放在对应 feature 中。

此前讨论中的 `product.md`、`architecture.md` 暂合并为本文，避免重复维护。只有出现需要独立展开的内容时再拆文档。

## 4. 进程与权限边界

```text
+-------------------------------+
| Renderer: React / editor / UI  |
+---------------+---------------+
                | typed app API
+---------------v---------------+
| Preload: contextBridge        |
+---------------+---------------+
                | validated IPC
+---------------v--------------------------------+
| Main: lifecycle / tasks / credentials / files   |
|       SQLite / Canvas / mail / model requests   |
+-----------+-------------------+----------------+
            |                   |
     local files & DB     campus / model services
```

- renderer 不直接导入 main，不接触凭据、SQLite 或通用文件系统 API。
- preload 暴露具体操作，不透传任意 IPC channel、任意路径读取或任意命令执行。
- main 校验 IPC 参数、调用来源和文件访问范围；共享类型不能替代运行时校验。
- 采用 context isolation、沙箱和关闭 renderer Node integration 的配置。
- 校园登录放在独立窗口与专用 Session 中，不挂载 Dela 的本地能力桥梁。失效后要求重新登录，不能把失效表现为无数据。
- 首版异步网络与小规模任务可由 main 调度。文档解析、索引等重计算在实际引入时放入 Worker/独立进程，避免阻塞窗口与应用生命周期。

## 5. 项目、文件与持久化

### 5.1 Project 的含义

Project 是用户主动围绕主题建立的持续工作空间，可以对应课程、Lab、科研、申请或长期阅读。普通文件夹可原地作为项目开展，不要求填写目标、截止时间或任务清单。项目保留来源引用、笔记、对话及打开的工作内容；不等于 Git 仓库，也不要求本地代码目录。

首版保存以下概念，不预先构建知识图谱：

| 概念       | 主要内容                                        |
| ---------- | ----------------------------------------------- |
| Project    | 名称、目标、背景、可选工作目录                  |
| 来源关联   | 平台标识、远端 ID、原文链接、本地路径、更新时间 |
| 会话与消息 | 所属项目、内容、明确引用的资料                  |
| 执行任务   | 用户要求、状态、工具步骤、输出、错误            |
| 成果       | 项目内的笔记、计划、草稿及其文件路径            |
| 同步状态   | 数据源、检查时间、成功时间、增量游标、错误      |

同一资料可以关联多个项目，关联关系不要求复制文件。界面选择和临时草稿状态由 React/Zustand 管理；SQLite 是持久业务状态的来源。

### 5.2 存储位置

| 数据                 | 位置与规则                                          |
| -------------------- | --------------------------------------------------- |
| SQLite、加密凭据     | Electron `app.getPath('userData')` 下；凭据单独保存 |
| 下载缓存、可重建索引 | 应用缓存目录，允许清理                              |
| 笔记与生成文件       | 用户选择的 Dela 工作目录                            |
| 已有 Lab 代码等      | 保留原目录，使用路径关联                            |
| 安装资源             | `resources/`，仅含应用静态资源                      |

关联目录中的原文件是事实来源。外部修改后刷新；保存前检查文件是否已变化，如有未保存修改则展示冲突，不直接覆盖。文件不存在或目录迁移时允许重新关联。

第一版在重新聚焦应用、打开文件和保存前检查变化，避免一开始递归监控整个磁盘。引入监听时仅针对必要目录，并忽略依赖和构建产物。

删除项目默认仅删除应用内记录和关联，不连带删除外部目录。文件覆盖前展示修改；删除或覆盖文件必须有明确的目标与用户意图。数据库修改使用事务和版本迁移，迁移前保留可恢复备份。

## 6. 主要界面草图

草图描述信息结构与交互，不规定最终颜色、字体和精确尺寸。为保证等宽对齐，框内使用英文短标签，正式界面使用中文。

### 6.1 首页：继续工作

```text
+--------------------------------------------------------------------+
| Dela                                      [Search]      [Settings] |
+---------------+----------------------------------------------------+
| Home          | Today                                              |
|               | Upcoming deadlines       Changes needing attention |
| Projects  [+] | [Lab 1: Friday]          [New course requirement]    |
|  Course A     |                                                    |
|  Lab 1        | Continue working                                   |
|  Research     | +-------------------+  +-------------------+       |
|               | | Lab 1             |  | Research          |       |
| Sources       | | Checklist: 3 left |  | Draft saved       |       |
|  Courses      | | [Open]            |  | [Open]            |       |
|  Mail         | +-------------------+  +-------------------+       |
|               |                                                    |
|               | Tasks: [Running] [Needs input] [Interrupted]        |
+---------------+----------------------------------------------------+
| Canvas: updated 10:30                     Mail: reconnect required |
+--------------------------------------------------------------------+
```

首页展示近期项目、截止事项、变化和待继续任务。读取已有数据不依赖模型；同步失败明确显示，不能用空列表替代错误。

### 6.2 项目空间：资料、成果与 Agent

```text
+----------------------------------------------------------------------------+
| Dela / Lab 1                         [Folder] [Open in VS Code] [Project ...]|
+----------------+-----------------------------------+-----------------------+
| Projects       | [Overview] [notes.md] [Checklist] | Agent                 |
|  Lab 1         +-----------------------------------+-----------------------+
|                | Goal / deadline / progress        | Session: Review   [+] |
| Project items  |                                   |                       |
|  Overview      | Current document or artifact      | You: Check the gaps   |
|  Requirements  |                                   |                       |
|  Slides.pdf    | - Requirement A                   | Reading requirements  |
|  Local folder  | - Requirement B                   | [2 steps completed]   |
|  notes.md      |                                   |                       |
|  Checklist     | [Edit] [Preview]                  | Result + sources      |
|                |                                   | [Save to project]     |
| [+ Add source] |                                   +-----------------------+
|                |                                   | Context: 3 items      |
|                |                                   | [Message ...]  [Send] |
+----------------+-----------------------------------+-----------------------+
| Saved                          Last checked: 10:35                         |
+----------------------------------------------------------------------------+
```

左右面板可调整和折叠，小窗口不强制显示三栏。中间是实际工作内容；对话成果可保存为文件或任务记录。新会话继续使用项目关联，但上下文按任务选择。

### 6.3 资料入口：先浏览，再关联

```text
+--------------------------------------------------------------------+
| Sources / Courses                         [Refresh] [Connection ...]|
+---------------+------------------------+---------------------------+
| Courses       | Course A               | Assignment 1              |
| Mail          |  Assignment 1          | Due: ...                  |
|               |  Slides                | Source: Canvas            |
|               |  Announcements         | Last synced: ...          |
|               |                        |                           |
|               | Course B               | Requirement preview       |
|               |                        |                           |
|               |                        | [Open original]           |
|               |                        | [Add to project]          |
|               |                        | [Create project]          |
+---------------+------------------------+---------------------------+
```

邮箱使用相同的列表与详情模式。用户可以直接查看、下载、跳转，不必先创建项目或询问 Agent。原始信息与模型推断的事项分别标识。

### 6.4 编辑与修改审阅

```text
+--------------------------------------------------------------------+
| Lab 1 / notes.md                         [Edit | Preview] [Save]    |
+---------------------------------+----------------------------------+
| Markdown source                 | Preview                          |
|                                 |                                  |
| # Next steps                    | Next steps                       |
| - [ ] Check input format        | [ ] Check input format           |
| - [ ] Update report             | [ ] Update report                |
+---------------------------------+----------------------------------+
| External change detected: [Compare] [Reload] [Save as]               |
+--------------------------------------------------------------------+
```

默认采用单视图切换，空间足够时可分屏。修改预览和应用入口仍为后续设想，当前 Agent 笔记写入直接执行并校验 revision；打开专业软件不代表能读取其中未保存的内容或终端状态。

### 6.5 连接设置与任务详情

```text
+--------------------------------------------------------------------+
| Settings / Connections                                             |
| Canvas       [Connected]     [Test] [Replace token] [Disconnect]    |
| Mail         [Needs login]   [Configure]                            |
| Model        [Configured]    [Test tool call]                       |
| Work folder  [Selected path] [Choose]                               |
+--------------------------------------------------------------------+
| Task: Review Lab 1                     Status: Needs input          |
| 1. Read requirements       Done                                    |
| 2. Read report             Done                                    |
| 3. Prepare checklist       Done     [Open output]                   |
| 4. Apply changes           Waiting  [Review changes]                |
|                                      [Cancel] [Continue]           |
+--------------------------------------------------------------------+
```

任务详情可作为抽屉或面板，不要求独立页面。展示操作摘要、参数、结果和错误，不展示或依赖模型的内部思维过程。

## 7. Harness 的执行约定

首版自行实现小型 TypeScript 执行循环，不引入通用 Agent 框架。校园工具先使用普通函数；只有实际需要消费外部 MCP 工具时再接入 MCP。

```text
User request -> Create run -> Select context -> Model response
                                  ^                  |
                                  |           tool call / answer
                                  |                  v
                              Save result <- Validate & execute
                                                     |
                                      needs input / done / failed
```

- 当前模型通过 `src/main/agent/loop.ts` 访问致远一号；API Key 不进入 renderer 或模型消息。
- 候选调用名沿用 background.md：`deepseek-chat`、`deepseek-reasoner`、`qwen`、`minimax`。实际工具调用、流式、中断与上下文限制需要逐个实测；不把名称当作能力保证。
- 上下文包括项目背景、当前请求、用户选中的资料和必要检索片段，不默认发送全部历史和全部文件。
- 邮件、课件、网页是资料，其中的指令不能扩大工具权限。
- 保存执行步骤和结果，支持取消、超时、步数限制以及错误显示。
- 当前仅保存基本聊天和逐项工具结果，运行态通过 `running` / `activeTool` 推送；完整任务状态机暂缓。
- 重启后不自动恢复执行；用户提供后续背景。已有工具结果保留，但当前后续模型请求只取最近 12 条对话的角色与正文，不自动重放历史工具结果。
- 当前写入工具直接执行用户请求，笔记沿用 revision 校验，尚无修改差异预览；邮件工具只准备草稿，由用户在编辑器点击发送。不提供提交作业工具。
- 首版不开放任意 shell。未来增加命令执行时单独设计目录范围、进程管理和结果记录。
- 本地存储不等于本地推理：发送给致远服务的上下文会离开本机。界面应能让用户了解所选资料范围。

## 8. 接口、同步与检索原则

优先次序：Canvas 和邮箱等个人可用协议，其次是已验证的个人网页会话接口。网页自动化仅在具体需求无法由接口满足时使用，不作为全站通用默认方案。

- 数据保留来源 ID、原文链接、来源更新时间（如有）和抓取时间。
- 同步处理分页、增量、重复数据、限流和登录失效；重试有上限。
- DDL 优先使用系统明确返回且适用于当前用户的时间；邮件推断与系统记录冲突时并列显示，不擅自覆盖。
- 同一事项跨平台关联不完全依赖标题相似度；不确定关联由用户修正。
- 首版按项目、来源和文件名定位资料，辅以文本检索。SQLite 全文搜索作为后续按需能力，中文检索质量实测后决定；不预先部署向量数据库。
- 模型、网络或某个来源不可用时，仍可浏览本地已有项目和成果，并显示新鲜度。

## 9. 工程与交付约束

- 只引入当前功能实际需要的依赖，新增抽象必须由真实重复或多个调用方支撑。
- 重要业务变化同步更新 README 和本规划，保留事实、推断与待验证项的区别。
- 密钥文件、个人邮件、课程原始数据、日志、缓存不进入 Git 或安装包。打包采用明确的产物白名单，避免整个仓库被打入包中。
- 日志保留执行 ID、步骤、耗时和脱敏错误，不记录 Token、密码或完整私密正文。
- Markdown 默认不执行嵌入 HTML/脚本；打开外部链接和文件检查协议与目标。
- UI 提供加载、空、错误、离线、未保存状态；不能将“工具调用结束”直接显示为“事务完成”。
- 优先测试用户可感知的正确性：同步去重、任务恢复、取消、文件冲突、数据库迁移、真实打包后的资源加载。避免为简单组件堆砌镜像实现的测试。

## 10. 开发里程碑与验收

| 阶段               | 交付                                                             | 验收重点                                                                                           |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| M0 工程与能力验证  | 固定依赖、窗口、SQLite、基础编辑器、Windows 安装包；最小接口探针 | TS 检查通过；安装包内原生模块可加载；Canvas 可读；邮箱可连接；模型完成真实工具调用；登录流程有结果 |
| M1 本地工作台      | Project、目录关联、Markdown、来源引用、外部打开                  | 关闭重开后状态仍在；VS Code 修改后可刷新；保存冲突不覆盖；删除关联不删原文件                       |
| M2 校园资料接入    | Canvas 课程/作业/文件，邮箱列表/详情与同步状态                   | 分页完整；失败有提示；数据有来源；资料可加入项目；DDL 与原系统抽样核对                             |
| M3 项目 Agent 闭环 | 上下文选择、流式对话、工具步骤、成果保存                         | 完成“读 Lab 要求与本地报告 -> 找差距 -> 保存清单 -> 下次继续”；可取消；中断状态准确                |
| M4 完善日常体验    | 首页、变化展示、重连、缓存、备份与性能修整                       | 连续真实使用；发现的问题修复；打包启动与数据升级可重复验证                                         |

M0 的接口探针仅用于验证可行性，不构成完整业务集成。某条接口失败不伪造数据宣称完成；记录阻塞，并推进不依赖它的本地功能。

首版成功标准：用户能围绕一个真实课程 Lab，从收集要求、关联资料、交给 Agent 检查，到打开专业软件处理，再回到 Dela 继续工作，过程中来源、进度与成果不会丢失。

## 11. 仍需实测的事项

1. pnpm 12、TS 7、Vite 8 与 Electron 原生依赖的实际安装和打包组合。
2. 致远模型的工具调用、流式事件、错误格式、网络条件和当前限额。
3. 本人 Canvas 数据覆盖、邮箱凭据使用方式、jAccount 登录会话的恢复流程。
4. 真实 PDF/PPTX 的文字、公式、图片和表格提取质量；不要预先承诺完整理解。
5. macOS/Linux 安装、凭据保护、外部打开及签名等平台行为，在对应平台验收前不宣称支持完成。

## 12. 参考与约束优先级

用户后续明确决定优先于本规划；本规划优先于参考索引中的路线建议。background.md 中无法取得 client_id 的约束优先于索引中“以后申请接入”的旧建议。

- [背景](../background.md)
- [校园服务资料索引](../knowledge/SJTU_API_References.md)
- [Electron 发布记录](https://releases.electronjs.org/release?channel=stable)
- [Electron 安全与进程边界](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Vite 8 发布说明](https://vite.dev/blog/announcing-vite8)
- [Vite JavaScript API](https://vite.dev/guide/api-javascript)
- [TypeScript 7 发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [pnpm 12.3.4 元数据](https://registry.npmjs.org/pnpm/12.3.4)
- [electron-vite 5 兼容范围](https://registry.npmjs.org/electron-vite/5.0.0)

## 13. 工程初始化记录

- 本次邮箱改动交付检查：TypeScript、生产构建、3 个 MIME 单元测试、脱敏 Electron 邮箱检查、修改文件格式检查均通过；`pnpm smoke` 与 `dist/win-unpacked/Dela.exe --smoke-test` 均通过。已生成 Windows 可执行目录，未验证 NSIS 安装流程。构建仍提示 renderer bundle 超过 500 kB。

- 2026-09-10 邮箱维护性与阅读改进：renderer 按 `MailConfigureForm`、`MailFolders`、`MailMessageList`、`MailReader`、`MailHtmlBody` 拆分页面，`mail-format.ts` / `mail-html.ts` 分别承载格式化和 HTML 文档处理。主进程正文选择优先 HTML，排除附件邮件中的正文；两个正文读取路径均解析 CID 位图（PNG/JPEG/GIF/WebP/BMP，总下载预算 2 MB），失败保留文本阅读。继续使用 ImapFlow 已有的字符集/传输编码解码，不重复转换。SQLite v2 只新增正文版本字段；升级前使用 VACUUM INTO 保留备份，旧缓存按需更新，联网失败保留缓存。HTML 用 DOMParser 保留原始 head/body 与 CSS，移除主动内容后写入无脚本、不同源 iframe；内部 CSP 限定图片与内联样式，远程图片默认显示且可关闭。适应宽度/原始布局、纯文本切换、抄送展示、正文 HTTP(S) 链接列表已实现；链接经校验主 frame 和协议的有限 preload API 在系统浏览器打开。侧栏保留账户区高度、固定按钮和图标位置、记忆折叠状态，窄屏保留名称；列表分隔条支持方向键。界面使用原有 48/220px 侧栏宽度，新增 240px 正文最低高度和 160ms 折叠过渡（尊重减少动态效果）。已通过 MIME 3 个单元测试与独立 Electron 脱敏样例检查（HTML 样式保留/脚本隔离、CID 替换逻辑、折叠图标稳定、快速切信与窄屏）。真实邮箱模板、Outlook VML、外部字体/样式表和超预算内嵌图片未保证兼容；附件下载未实现。

- 开发工具安装在本机 `.tools/`，由 `scripts/use-local-tools.ps1` 为当前 PowerShell 会话启用，不更改系统全局版本。
- 已添加 `.gitignore`、`.prettierrc.json`、`.prettierignore`、`.editorconfig`、`.gitattributes`、Node 版本文件、三个 tsconfig、三个 Vite 配置和 electron-builder 配置。
- 辅助开发依赖固定为 Prettier 3.9.6、@types/node 24.9.0、@types/react 19.2.18、@types/react-dom 19.2.7、@types/better-sqlite3 9.6.0。
- pnpm 12 自动生成的项目设置移入 `pnpm-workspace.yaml`，对约定的 Electron 44.3.0 设置精确的发布时间排除项；没有关闭全部安装检查。
- better-sqlite3 13.0.3 附带平台预编译模块。pnpm 尝试默认 node-gyp 构建时暴露了不必要的源码编译，因此明确禁用该步骤，并关闭 electron-builder 的自动重建。最终可用性以 Electron 内及打包后的 SQLite 冒烟检查为准。
- Electron 44 提供显式安装命令，本项目 `postinstall` 调用 `install-electron`。
- 2026-09-10 完成 [前端重构](frontend-refactor-plan.md)：`main.tsx` 只负责挂载 React；`App.tsx` 承担应用外壳与页面入口；设计 token 与 reset 在 `styles/`；`AppShell`、`Button`、`PageHeader`、`StatusDot` 提取为共享组件；首页、项目、资料、设置拆分到各自 feature，样式迁移为同目录 CSS Modules。界面效果保持不变，仍为示例数据。同时安装并使用 clsx 2.1.1、framer-motion 13.2.0、highlight.js 11.12.0（视图切换过渡与 Agent 面板示例代码高亮）。因类名哈希化，冒烟检查的渲染断言从 `.app-shell` 类名改为结构稳定的 `main` 元素。已验证：Prettier、三组类型检查、生产构建、Electron 内 SQLite/React/preload 隔离冒烟，并在浏览器中对四个视图与窄屏布局做了视觉核对。
- 2026-09-10 自定义标题栏：窗口改为 `titleBarStyle: 'hidden'`（Windows 保留系统拖拽、贴边与双击最大化），标题栏由 `AppShell` 渲染——左侧 Dela 标识 + 拖拽区（`-webkit-app-region`），右侧自绘最小化/最大化/关闭按钮；窗口操作通过 preload 暴露的 `window` API 走受控 IPC（`window:minimize` / `window:toggle-maximize` / `window:close` / `window:get-state`），最大化状态由主进程经 `window:state` 推送同步，按钮在最大化/还原图标间切换。滚动从窗口级改为工作区内滚动，内容不会滑入标题栏下方；窄屏下标题栏仍置顶，底部导航保持。已验证：类型检查、生产构建、Electron 冒烟与窗口截图核对（Windows）；macOS/Linux 的标题栏形态（如交通灯按钮位置）未适配、未验证。
- 已完成首页、项目空间、资料入口和连接设置的前端骨架，包含明暗主题与窄/中/宽屏响应式布局；当前使用明确标注的示例数据。尚不包含完整编辑器、项目 CRUD、模型调用、邮箱/Canvas 或后台任务。
- 2026-09-09 验证通过：固定锁文件安装、Prettier、三组 TS 7 类型检查、Vite 8 生产构建、开发服务器启动与退出、生产构建及 Windows 可执行目录内的 SQLite/React/preload 隔离冒烟检查。Vitest 尚无业务测试；未生成或验证 NSIS 安装流程，未验证其他平台。
- 2026-09-10 邮箱（首个真实业务功能）与导航改造。左侧主导航改为首页、项目、资料、邮箱、课表；资料页移除内嵌的"课程/邮箱"类别列（Canvas 为列表+详情两栏），设置页"学校邮箱"行读取真实连接状态并可跳转邮箱页。主进程新增 `database.ts`（userData 下 SQLite，`user_version` 迁移 v1：mail_accounts / mail_folders / mail_messages）、`credentials.ts`（`safeStorage` 加密存 `userData/mail-credentials.bin`）、`mail.ts`（imapflow 同步与 IPC）；`shared/api.ts` 定义 MailApi 契约，preload 暴露 `dela.mail`；imapflow 2.0.0 保持 external 随生产依赖打包。同步策略：单账号（限 @sjtu.edu.cn），登录校验后保存凭据；每次同步按文件夹拉取最近 300 封信头（ENVELOPE/FLAGS/BODYSTRUCTURE），最新 30 封预取正文，UIDVALIDITY 变化时清空该文件夹本地数据，窗口外旧信头删除；正文未缓存时打开邮件按需抓取并缓存；打开未读邮件经 IMAP 置 `\Seen` 后更新本地；HTML 正文以 `sandbox` iframe 渲染，纯文本按预格式化文本渲染；附件仅列出名称与大小。页面为 Outlook 式三栏（文件夹/列表/阅读），含配置表单、同步状态（进度/错误）、文件夹未读数、本地搜索与窄屏响应式（文件夹横向标签、列表/阅读切换）。课表页为周课表示例骨架，明确标注数据未接入。已用真实账号验证：7 个文件夹同步（INBOX 服务器总数 1250，本地窗口 187 封、92 封摘要、93 封正文）、列表与 HTML 阅读渲染、已读标记、明暗与窄屏截图。未实现：发送（SMTP/nodemailer）、附件下载、定时轮询、多账号；打包安装（NSIS）与 darwin/linux 未重验。
- 2026-09-10 Shell 视觉统一：设计 token 改为中性灰阶、深青绿强调色，并同步提供暗色 token；自定义标题栏、侧栏、邮箱栏和状态栏复用这些 token。工作区改为固定的标题栏 / 内容 / 精简状态栏三行布局，侧栏跨内容与状态栏行；状态只在底部呈现一次。工作区不再作为全局滚动容器，各视图和邮箱三栏各自负责其内容滚动；滚动条使用统一的低对比度轨道和圆角滑块。已验证 TypeScript、生产构建、Electron 冒烟和格式检查；浏览器预览不具备 Electron preload，不能用于该应用的窗口级视觉验证。
- 2026-09-10 Shell 细节调整：移除侧栏品牌区以及全局、项目页的底部状态栏；主侧栏与项目 Agent 右栏均可在宽屏上拖拽调整宽度，窄于三栏最低可用宽度时自动收起 Agent。邮件 HTML iframe 仍保持无脚本 sandbox，应用 CSP 允许邮件中的 HTTP(S) 图片，且 iframe 图片请求不携带 Referer；这会恢复远程图片显示，但远程服务仍可获知一次图片请求的网络地址。
- 2026-09-10 图标与可收起导航：新增并固定 `lucide-react` 1.44.0，主导航、设置、项目与邮件文件夹使用其统一的描边图标。桌面端应用侧栏可通过标题栏 Dela 标识收起或展开；邮箱文件夹栏默认收起，列表/正文分栏可拖拽调整，默认优先留出正文阅读空间。
- 2026-09-10 开发预览修复：Vite 的普通浏览器页面不具备 Electron preload 注入的 `window.dela`，renderer 现将该 API 声明为可选；窗口控制在浏览器中不渲染，设置页使用预览版本标识，邮箱明确显示仅桌面端可用，不读取或模拟凭据和邮件数据。Electron 中仍以 preload 注入的受控 API 运作。已核对 `scripts/dev.mjs` 的 Vite / main / preload watch 与 `vite.renderer.config.ts`；空白页原因为 renderer 直接访问不存在的 preload API，而非开发服务器配置错误。
- 本机 Node 下载器获取 Electron 失败后，使用系统下载方式获取官方同版本 ZIP，并以 npm 包内 checksums.json 校验 SHA-256 后安装；没有更换版本或关闭校验。
- 2026-09-11 个人课表接入：采用教学信息服务网登录后的只读接口 `POST /kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`，不依赖无法取得的开放平台 `client_id`。校园登录使用独立持久 Electron Session 和不含 preload 的模态窗口；renderer 只能通过受控 IPC 取得规范化数据。主进程按学期读取并校验课程名、课程号、教学班、教师、学分、校区、教室、星期、节次、周次和备注，成功后事务替换该学期缓存；失败或登录失效时保留旧缓存。课表页支持学期/教学周筛选、桌面周网格和窄屏日列表，设置页显示连接入口。已验证格式、三组类型检查、生产构建、周次解析测试、Electron 冒烟、登录窗口和 `win-unpacked` 启动；真实 jAccount 登录后的本人课表响应尚待实测，因此接口仍属于待验证能力。
- 2026-09-11 jAccount 扫码回跳修正：移除登录窗口对导航协议、域名、新窗口和网页权限的自定义拦截，不再取消 HTTP 回跳后从事件中重发 HTTPS 导航；校园 SSO 重定向交给 Chromium 正常跟随，成功回跳直接识别 i.sjtu 的 HTTP/HTTPS 地址。独立 Session、无 preload 和受控 IPC 边界保持不变。
- 2026-09-11 登录后同步修正：删除通过再次请求 `/jaccountlogin` 并解析最终响应 URL 来确认会话的步骤。扫码成功后直接使用同一 Session 请求课表；课表请求发生重定向或返回非 JSON 时再提示登录失效，避免 Electron 对 SSO 响应地址抛出 `Invalid URL`。
- 2026-09-11 联调限制清理：课表同步不再要求服务器声明特定 JSON `Content-Type`，直接解析响应内容后校验必要字段，兼容教学信息服务网可能不规范的响应头。
- 2026-09-11 课表日历化：参考开源项目 charlietlamb/calendar 的周/月视图、事件创建和窄屏纵向布局，以及 CalendarCN 的时间轴、当前时间线和月视图事件摘要，将原节次网格改为 8:00–20:20 周时间轴与月历；未增加 daily 模式。课表同步尝试从 `rqazcList` 提取最早有效日期作为第一教学周，元素形态未知时不会阻断课程同步；旧缓存没有日期时，月视图明确只显示本地事件。新增本地事件表和受控 IPC，可保存名称、起止时间和地点。已用脱敏课程及事件完成 1280px 周/月/弹窗和 620px 窄窗口渲染检查，无页面横向溢出；真实账号返回的 `rqazcList` 格式仍待验证。
- 2026-09-11 邮件发送与未读状态修正：文件夹栏账户区上方新增“发送邮件”入口和分隔线，写信时以编辑器替换邮件列表与阅读区域，右上角发送；不保存草稿，关闭编辑器、切换文件夹、离开邮箱或退出窗口前提示抛弃。编辑器仅保留加粗、斜体、HTTP(S) 超链接、正文图片和普通附件；主进程用临时文件令牌隔离真实路径并通过 Nodemailer 连接 `mail.sjtu.edu.cn:465`，正文图片以 CID 发送。打开未读邮件后，renderer 立即更新邮件和文件夹未读数，主进程在 IMAP 标记成功后同步更新 SQLite 中的邮件及文件夹计数。生产构建和脱敏 Electron 邮箱检查通过；自动化没有再次发送真实邮件，用户已在正常应用会话中完成手动发送。
- 2026-09-11 邮件归档与附件下载：SMTP 投递使用一份 Nodemailer 生成的 RFC 822 MIME 内容；投递被服务器接受后，同一内容通过 IMAP `APPEND` 写入识别到的 `\\Sent` 文件夹。归档失败不把已投递的邮件显示为失败，而是明确提示。阅读面板中的附件改为可点击按钮，点击后每次弹出系统保存位置对话框；主进程按已缓存且经校验的 MIME part 从对应 IMAP 邮件流式写入临时文件，完成后移动到用户选择的位置，失败不留下半成品。旧缓存缺少 MIME part 时需重新同步。已通过类型检查、生产构建和脱敏 Electron 交互检查；真实账号的已发送归档和附件保存仍待应用内实测。
- 2026-09-11 界面语言统一到邮箱标杆：邮箱页的折叠栏、拉伸线与工具栏约定提取为共享组件并应用到其余页面。新增 `components/ui/resizer.tsx`（role=separator、aria 值、方向键 20px 步进、pointer capture、视觉线 1px 且两侧各外扩 10px 命中区、拖拽时经回调暂停列宽过渡），替换应用侧栏、邮箱列表、项目 Agent 面板、资料列表四处重复实现；`panel-toggle.tsx`（展开/收起按钮，支持左右侧面板）与 `desktop-only-notice.tsx`（浏览器预览提示）同为共享。应用侧栏宽屏折叠保持完全隐藏并持久化（应用户要求不做 48px 图标栏，避免与页内面板图标栏叠加），窄屏改为左上角菜单按钮控制的覆盖式抽屉（280px、带遮罩、点击导航或遮罩关闭），参照 ChatGPT 移动端；项目页拆分为 ProjectSidebar / ProjectDocument / AgentPanel，左侧列表改为带 lucide 图标的可折叠图标栏，Agent 面板可折叠并从文档标签行重新展开；资料页拆分为 SourceList / SourceDetail，列表改 px 宽度加拉伸线并可折叠；课表按邮箱模式拆分为 TimetableView / WeekCalendar / MonthCalendar / NewEventDialog / timetable-format，页头对齐工具栏风格；设置页连接行加图标，未实现连接的“配置”按钮禁用；首页“新建项目”改用 Plus 图标。折叠与展开状态保存在 localStorage（`dela.shell.*`、`dela.project.*`、`dela.sources.*`，与既有 `dela.mail.*` 一致）。已验证：格式检查、三组类型检查、生产构建、7 个单元测试、Electron 冒烟，以及浏览器预览 1280px/620px 下首页、项目、资料、设置、侧栏完全折叠与窄屏抽屉开合的截图核对；Electron 窗口内邮箱三栏与课表的实机视觉核对未重做，待下次应用会话确认。
- 2026-09-11 课表视觉修润与两处全局修正：课程块与月历日程条从“左侧彩条 + 半透明底”改为与首页项目卡片一致的实色粉彩（amber/emerald/sky/violet/rose 按课程号或课程名哈希，暗色反转 -950/-200），手动事件用中性灰与课程区分；月历改为仅横向分隔线的网格，日程条带节次/时间前缀；页头第二行改为无边框胶囊下拉（自带箭头），同步状态与刷新合并为一个按钮；新建事件弹窗拆分为日期 + 时间原生输入（开始/结束各一行），支持 Esc 关闭与淡入动画，周视图首刻度 8:00 不再被表头裁剪。修正 `globals.css` 中损坏的 `@custom-variant dark`（编译为空 `:where()` 选择器，导致全应用所有 `dark:` 工具类在暗色下失效），删除后恢复 Tailwind v4 默认 `prefers-color-scheme` 变体；主进程增加 `--lang=zh-CN`（Electron 界面语言默认 en-US，原生日期/时间控件因此渲染 MM/DD/YYYY AM/PM）。已验证：格式检查、三组类型检查、生产构建、7 个单元测试、Electron 冒烟，并经 CDP 对真实缓存课表截图核对周视图（明/暗）、月视图与弹窗（日期显示 2026/09/12、24 小时制），视觉验收通过；月历日程条因旧缓存无学期日期且无本地事件，样式中“还有 N 项”溢出形态未在实机复核；周视图表头日期数字依赖学期日期，旧缓存下仍只显示星期名，待下次成功同步补齐。
- 2026-09-11 设置页重构为分区导航：改为 macOS 系统设置式的「左侧分区导航 + 右侧详情」，窄屏导航折为顶部横向分区行。三个分区——数据与服务沿用原 5 项连接并继续读取真实的邮箱/课表状态（未实现连接的配置按钮禁用，已连接的跳转对应视图）；外观为主题三选（跟随系统/浅色/深色，带预览色块），当前仅维护组件内选择态，不持久化也不实际切换主题，接口草案记录在同目录 `INTERFACES.md`；关于为居中品牌卡（logo、名称、定位、版本，版本读 preload 构建时内联的 `package.json`）。拆分为 `SettingsView` / `SettingsNav` / `ConnectionsSection` / `AppearanceSection` / `AboutSection` / `SectionHeader`，导出签名未变。已验证：格式检查、三组类型检查、生产构建，浏览器 1280px 明暗主题截图核对。
- 2026-09-12 窄屏邮箱两级抽屉：修复窄屏邮箱列表上方的空壳行（MailFolders 此前在窄屏 grid 第一行仍渲染，但折叠开关、文件夹、账号区全部被 `max-md:hidden` 隐藏，只剩内边距加边框约 17px，且文件夹切换与账号操作不可达），窄屏不再渲染 grid 内文件夹列。左上角菜单按钮改为受控两级抽屉（`MobileDrawer`，状态在 App）：邮箱视图首击直达邮箱级——文件夹+未读数、发送邮件、账号、退出登录，顶部「‹ 主菜单」返回一级主导航，导航级点邮箱钻回；其他视图首击仍开主导航级。抽屉内容由 MailView 经 AppShell 常驻的 `mail-drawer-slot` portal 注入，邮件状态保持单一来源；拉宽窗口或经后退/前进离开邮箱视图时抽屉自动收起。`MailFolders` 移除窄屏横条样式，新增 `hideHeader`/`className`，删除窄屏专属顶部「写邮件」按钮（与底部发送邮件重复）；顺带修正折叠态 `px-1.5` 使图标相对展开态左移 2px 的旧问题（改为仅 `pr-1.5`）。mail-smoke 窄屏断言改为：列表不横向溢出且不保留文件夹列、邮箱级抽屉含命名文件夹与退出登录、返回主菜单并可从导航钻回、抽屉内发送邮件进入编辑器且不溢出。已验证：格式检查、三组类型检查、生产构建、7 个单元测试、mail-smoke，并在运行中的 Electron 开发实例经 CDP 以 600×960 截图核对列表无空壳行、邮箱级抽屉、返回/钻回与 1440px 宽屏三栏回归，视觉验收通过。
- 2026-09-12 标题栏后退/前进与帮助入口：参照 Codex App 在标题栏左侧依次排布侧栏开关、后退、前进和帮助。视图导航历史（backStack/forwardStack）由 App 持有并与普通导航共用同一守卫——写信未发送时经后退/前进离开邮箱同样弹确认，用户取消则导航中止、历史栈不动；后退/前进随历史置灰。帮助为占位文字按钮，链接目标后续接入；未加键盘快捷键。已验证：Prettier、三组类型检查，浏览器预览 1280px/620px 下初始禁用态、首页→项目→后退→前进完整周期（含邮箱离开守卫路径的栈不污染）、窄屏抽屉内导航与后退离开邮箱自动收起抽屉，及宽窄屏标题栏渲染截图核对；受后台标签动画冻结所限，内容切换经按钮禁用态与 aria-current 确认而非逐帧目视，真实指针输入与 Electron 实机渲染未重验。
- 2026-09-12 侧栏折叠过渡统一：文字淡入淡出 + 裁剪，图标全程钉位。此前主侧栏展开动画中间帧里「项目」标题会被窄容器挤成竖排两行。确立全局约定——宽度过渡期间侧栏内容按目标宽度排版、由容器 overflow 裁剪显示，文字随折叠状态淡入/淡出（参照 Chrome 垂直标签页），图标不参与淡入淡出。主侧栏（AppShell）内容层为固定宽度（等于当前栏宽）内层，文字标签统一 `transition-opacity`；`invisible` 改为延迟 200ms 生效（与宽度动画同步结束），否则收起时内容立即消失、看不到淡出；去掉原先立即 `w-0` 的写法。邮箱与项目侧栏行标签改为常驻 + `transition-opacity`（去掉折叠时 `w-8 justify-center px-0` 的居中交换，图标与展开态横向对齐且全程不动），未读徽标与收起态未读圆点逻辑不变，展开淡入、收起随宽度侵蚀淡出；项目侧栏顺带修正折叠图标比展开态左移 2px 的旧错位（nav `px-1.5` 改为与邮箱一致的 `p-2`）。资料列表、「项目内容」标题与「添加资料」为卡片/居中结构，保留双态切换、文字挂载时用 `animate-in fade-in` 淡入。宽屏折叠保持完全隐藏不变。已验证：格式检查、三组类型检查、生产构建、7 个单元测试、mail-smoke（含折叠图标稳定与窄屏布局断言）；另用隔离 userData 的 Electron 实例（CDP 注入慢放过渡 + 强制泵帧截图）核对主侧栏收起 ~60% 帧（标签 opacity≈0.6、被收缩边缘裁剪、图标实心）与项目侧栏收起/展开 ~40% 帧（文字半透明、在最终位置淡入淡出，无换行无回流）；邮箱侧栏折叠动画与项目侧栏同构，未逐帧重验。
- 2026-09-12 目录交互对齐 VSCode 资源管理器：共享 `Explorer` 新增可选 HTML5 拖拽移动（`onMove`/`canDrop`，拖拽载荷用自定义 MIME `application/x-dela-entry`，放置目标行以 `bg-accent/60` 高亮），仅"我的内容"树启用，Canvas 资料树只读不参与；拖入文件夹或项目成功后自动展开目标，拖到目录滚动区空白处移到顶层，自身子树不可作为放置目标（前端 `canDrop` 预判 + 主进程 `checkParent` 循环校验双保险）。项目页目录头部为四个带 Radix 悬浮提示的纯图标按钮（新建笔记/新建文件夹/关联本地文件/全部收起，`icon-sm` 沿用既有尺寸，折叠态保持隐藏），双击目录空白处直接新建笔记（目标取当前容器）；"全部收起"清空当前工作区视图的 `expanded`。窄屏/触屏仍经条目"…"菜单完成移动等操作，功能可达。已验证：格式、三组类型检查、生产构建、7 个单元测试、Electron 冒烟；另以隔离 userData 启动真实应用，经 CDP 合成拖拽事件验证移动落库与高亮、双击空白弹窗、Tooltip 渲染与全部收起（测试数据仅存临时目录，未触碰真实数据与笔记目录）；OS 级指针手势拖拽与 NSIS 打包未重验。已知取舍：目录头部并排四个图标，侧栏拖到最小宽度 240px 时标题文字会被压缩至近乎不可见（默认 300px 正常）；VSCode 的行内重命名/内联新建输入框未引入，沿用现有对话框模式。
- 2026-09-12 课表月历交互补强：参照 DayPilot 的 `onTimeRangeSelected` 模式，月视图支持按住拖过若干天创建跨天任务——按下即高亮选区（仅当月日期参与高亮），松开弹出预填起止日期的新建事件弹窗，取消则不创建；键盘 Enter/Space（click `detail===0`）与触屏点击仍按单日创建。开学日期改为应用内可维护：主进程新增 `timetable:set-semester-start`（zod 校验学期与 `YYYY-MM-DD`，upsert `timetable_sync.semester_start`；无同步记录时以空串 `last_synced_at` 满足 NOT NULL，`getState` 将空串映射回 null），新增 `SemesterStartDialog` 提供日期输入与「第 1 教学周：M月D日 – M月D日」预览（周一记为周首，与 `weekForDate` 一致），入口为页头第二行胶囊（有值显示「开学 M月D日」）与月历缺日期提示条；下次成功同步取得权威日期仍会覆盖手动值。`localEventsByDay` 展开为跨天事件在覆盖的每一天出现（结束时刻为午夜时归属前一天），月历续日条目不重复时间前缀，周视图同步受益。页头整理：「今天」按视图改为「本周/本月」；同步/重新登录按钮移入第一行右侧动作组（已连接为图标 + 悬浮提示同步时间，未连接显示文字「重新登录」）；「+ 新建事件」默认今天而非学期周一，拖拽与单日创建统一落在 9:00–10:00。已验证：格式检查、三组类型检查、生产构建、7 个单元测试；另以隔离 userData 的真实应用实例经 CDP 与人工操作核对——拖拽 9/14–9/19 弹窗预填与创建、跨天条目逐日显示且仅起始日带时间、缺日期提示条与页头入口均可打开弹窗、保存 2026-09-14 后提示条消失且课程按第 1 教学周自 9/14 渲染（9/7 等开学前日期无课程）、弹窗重开预填已存值、9/16（周三）预览解析到 9/14–9/20；OS 级触摸手势、真实 jAccount 同步覆盖手动日期的行为与打包未重验。
- 2026-09-12 关于页重排与赞赏入口：去掉品牌卡的边框与卡片底，改为居中留白排版——透明 logo（96px，深浅主题共用，深色背景下的观感经离屏合成核对）、名称、定位语、版本号；发丝线之下为作者行（头像 + author: ChangYo），右侧是 GitHub 仓库图标链接（内联 simple-icons 的 GitHub 标记，lucide 已移除品牌图标）与「赞赏」按钮。赞赏弹窗用 radix-ui Dialog（进出场沿用 dropdown 的 tw-animate 类），文案收敛为标题「赞赏」加描述「请作者喝一杯」；微信/支付宝收款码并排，二维码固定白底圆角容器保证深色主题下可扫，色点区分渠道。GitHub 链接走既有 window-open 外链通道由主进程在系统浏览器打开。素材取自仓库根 `assets/`，未新增依赖。已验证：格式检查、三组类型检查、生产构建、7 个单元测试；在运行中的 Electron 开发实例（HMR）核对关于页排版与赞赏弹窗开合；系统深色主题实机截图与打包未重验。
- 2026-09-12 课表配色体系化与三处视觉修正：参照 Google Calendar 的成套事件色与 muted pastel 方案，把原先 5 色高饱和粉彩（Tailwind 100/900，暗色 950/200）换成 8 色低饱和灰调候选色（玫红/杏橙/沙黄/草绿/湖青/雾蓝/藕紫/石墨），以 `--cal-{key}-bg/-text` 设计 token 定义于 `globals.css`，明暗各一套。课程仍按课程号/课程名哈希自动分配（`colorFor`）；手动事件可显式选色：`calendar_events` 新增 `color` 列（数据库 v6 迁移 `ALTER TABLE`），API 增加可选 `color`（zod 枚举校验，读回异常值为 null），新建事件弹窗在分组行内新增 8 个圆形色板，默认石墨中性色与课程区分，选中态用 ring。周视图课程/事件块与窄屏卡片的标题改为 `break-words` 换行展示、不再省略（教室/节次等次要信息仍单行截断，月历摘要条保持单行属概览形态）；月历日格按钮改为 flex 顶对齐，修复 button 默认垂直居中导致日期数字随条目数量上下漂移的问题，数字统一固定左上角。已验证：格式检查、三组类型检查、生产构建、7 个单元测试、Electron 冒烟（真实 userData 完成 v5→v6 迁移）；另以隔离 userData 的真实应用实例经 CDP 用脱敏课程与事件截图核对周/月视图与新建事件弹窗的明暗主题、标题换行与日号对齐，并完成「选色→创建→落库→月历按所选色渲染」端到端检查（测试数据仅存临时目录，已清理）；NSIS 打包未重验。
- 2026-09-12 应用品牌图标统一：renderer 标题栏与设置页改用 `assets/Dela_white_bg.svg`；BrowserWindow 设置同设计的 `Dela_white_bg.png` 作为原生窗口图标，electron-builder 顶层 `icon` 与打包文件列表同步配置该 PNG，使开发窗口与安装包不再回退到 Electron 默认图标。原生图标使用 PNG 伴生文件，因为 Electron/electron-builder 的平台图标链路不直接以 SVG 作为通用输入；已通过类型检查、生产构建和 Electron 冒烟，安装包目录图标待重新打包后确认。
- 2026-09-12 Markdown 编辑器语法高亮：笔记编辑从原生 textarea 换为 CodeMirror 6（`ProjectDocument` 内 `MarkdownEditor` 组件），`@codemirror/lang-markdown` 的 GFM 解析覆盖标题/加粗/列表等标记与内联代码，`@codemirror/language-data` 按需懒加载围栏代码块语言（Vite 分包，用到才拉取），代码块内按语言高亮；新增固定依赖 @codemirror/state 6.7.4、@codemirror/language 6.12.4、@codemirror/commands 6.11.0、@codemirror/language-data 6.5.2、@lezer/highlight 1.2.3。配色调研了 GitHub Light/Dark（Primer prettylights）、Ayu、One Light/Dark、Flexoki、Nord、Solarized 后选用 GitHub：低饱和适合长文写作，且明暗两版都以纯白/近黑为设计底色，与应用的中性灰阶主题同底；逐色值溯源 `primer/primitives`，以 8 个 `--syntax-*` 设计 token 定义于 `globals.css` 明暗各一套，CodeMirror `HighlightStyle` 与预览侧 highlight.js 的 GitHub 主题类名共用同一组变量（`var()` 注入经 style-mod 验证），编辑与预览观感一致并跟随系统主题。编辑器行为保持原有数据流：`updateListener` 仍写回 `workspace.edit` 的 600ms 空闲自动保存、Ctrl/Cmd+S 与失焦保存、滚动位置经 `scrollDOM` 持久化；外部文本变更（重新载入等）仅在传入文本与编辑器文档不同才整体替换，不打断输入光标。新增体验：Enter 续写列表/引用（markdownKeymap）、撤销/重做历史（Mod-Z/Y）、Tab 缩进、行环绕。预览侧 react-markdown 代码块接入 `highlight.js/lib/common`（识别语言才高亮，不做自动猜测），复用既有 `[&_pre]` 容器样式；助手面板的对话渲染未改动。已验证：格式检查、三组类型检查、生产构建、7 个单元测试、Electron 冒烟与 workspace 冒烟；在运行中的应用实例以临时笔记（API 创建、截图后即删除）经 CDP 核对编辑态明/暗主题与预览态代码块高亮；打包产物与真实长文输入手感未重验。
- 2026-09-12 文档区交互对齐 VSCode 编辑器：先研读 vscode 仓库 `multiEditorTabsControl`（脏标记与关闭按钮是同一按钮的字形切换、悬停互换、激活标签常显 X）、`editorInput.isSaving`（短自动保存下抑制脏点——VS Code 在 afterDelay≤1000ms 时不显示圆点）、`editorGroupView` 关闭确认流（仅在脏且不会自动保存时弹 Save/Don't Save/Cancel）、`breadcrumbsControl`（22px 面包屑行、chevron 分隔、溢出滚动、点击弹出同级选择器）与 `editor/title` 情境菜单（`when` 上下文按文档类型显隐、图标+tooltip 无文字），再结合本项目"600ms 自动保存 + 关闭标签不丢草稿"的实际裁剪：标签未保存显示圆点、悬停或保存后变关闭 X（保留圆点作为用户明确要求的未保存反馈，未采用 VS Code 的抑制策略；关闭不弹确认框——自动保存兜底且草稿留在应用状态），新增中键点击关闭与双击标签栏空白处新建笔记（与目录空白双击新建同构）。`ProjectDocument` 第二行文件名重复问题改为面包屑：所属项目/文件夹链可点击（`onReveal` 在目录中展开并定位），Canvas 资料追加「课程 · Canvas › 目录链」只读上下文与截止时间（Clock 图标）；工具栏情境化——移除「已保存/未保存/保存中」文字与「记笔记」按钮（与目录头新建笔记重复，且非文档级操作），预览/编辑改为对称图标切换（Eye/PenLine），保存按钮干净或保存中置灰，各按钮按 `editable`/来源类型/`url`/`kind` 严格显隐。已验证：格式检查、三组类型检查、生产构建、7 个单元测试、Electron 冒烟与 workspace 冒烟；在运行中的应用实例以临时嵌套结构（创建→验证→删除并复位视图状态）经 CDP 截图核对脏点、保存后圆点变 X、面包屑渲染与点击定位、保存按钮置灰；真实 Canvas 资料面包屑链与悬停换 X 的指针级核对未做（CSS group-hover 标准机制）。
- 2026-09-13 工作区文档语义修正：目录头移除重复的底部“关联本地文件”入口及“新建项目”图标，保留针对文件夹的“作为项目开展”。右侧不再把文件夹/项目渲染为详情页；仅当文档处于打开状态时展示其标签栏，标签保留脏标记、中键或按钮关闭及双击空白新建笔记，目录选中时不展示此前文件标签。Markdown 编辑器启用 CodeMirror 官方 `lineNumbers()` gutter，使用既有 muted token 保持明暗主题一致。侧栏折叠方案暂不改：展开入口仍留在左侧边界，避免跳到右侧工具栏造成大幅视觉跳转。
- 2026-09-13 设置页接口闭环：`dela.settings.getTheme/setTheme` 只接受 `system`、`light`、`dark`，调用方经主 frame 校验；主题值保存到既有 `workspace_settings`，主进程启动和变更时同步 `nativeTheme.themeSource`，renderer 以 `html.light` / `html.dark` 覆盖系统媒体查询并保留 localStorage 缓存以避免启动闪烁。设置页不再把 Canvas、致远一号的“配置”跳转到资料页：Canvas 对话框复用已有 `configure/syncCourses/disconnect` IPC，令牌验证后才由主进程加密保存；模型对话框复用 `getChat/configureModel`，密钥不回传 renderer。工作目录复用系统选择器并立即刷新设置状态；邮箱和课表保持前往已有完整配置页。`INTERFACES.md` 更新为实际 API 约定。已验证：类型检查与生产构建；真实凭据连接不作为本次验证内容。
- 2026-09-13 标题栏快捷键补全与快捷键弹窗重排：沿用既有全局 keydown 通道，资料/视图菜单的导航项补上真实响应的快捷键——`Ctrl/⌘1–5` 依侧栏排布直达首页/项目/Canvas 资料/邮箱/课表，`Ctrl/⌘,` 打开设置，触发时顺带收起打开中的标题栏菜单；帮助菜单「快捷键」「设置与关于」保持无快捷键（低频操作，且 `Ctrl/⌘/` 已被 CodeMirror defaultKeymap 的切换注释占用，不另占用）。快捷键弹窗从单栏文字说明（max-w-sm）重排为 Linear 风格双栏黑白排版（max-w-2xl、p-8、max-h 85vh 滚动）：导航/通用/鼠标三组，行内右对齐 keycap 式 `<kbd>` 芯片（按 `navigator.platform` 显示 Ctrl 或 ⌘），右上角 X 关闭替代底部按钮，开启时加 fade/zoom 进场。已验证：Prettier、oxlint、三组类型检查、生产构建、7 个单元测试、Electron 冒烟；另经 Vite 浏览器预览 1440×900 截图核对弹窗双栏排版与资料/视图菜单快捷键提示（judge 视觉验收通过），并实测 Ctrl+4 跳转邮箱、Ctrl+, 跳转设置；明暗主题下的弹窗截图与 Electron 实机按键未重验。

### 2026-09-12 资料与项目从示例转为真实工作区

用户确认的产品边界：资料负责课程与来源的原始组织，文件夹是用户自由整理内容的容器；项目是用户主动围绕主题持续工作的文件夹形态，不要求目标、DDL 或任务清单。文件夹可原地转为项目，同一来源可引用到多个位置。资料和项目共用工作区，不再固定展示示例概览、虚构进度或助手执行结果。

本次实现：

- `main/canvas.ts` 对接个人 Canvas token（safeStorage），按学期/课程保存列表；资料侧栏依次独立展示“Canvas 资料”“我的内容”“归档”，归档默认收起，默认显示最新学期与“未标注学期”，其余学期置于归档。用户内容可移入受保护的归档根目录，保留子项与磁盘路径。课程内容按需同步文件夹/文件、作业/本人提交附件、讨论和模块；同步保存清单元数据，文件本体仅在首次打开或下载时获取并缓存。全量列表跟随 Link 分页，模块 item 使用独立分页端点。栏目失败保留旧快照并显示错误，刷新课程不会破坏项目内稳定的来源引用。远端不再可见的历史条目暂保留缓存，不自动删除用户引用。
- 数据库 v5 新增 Canvas 课程快照、来源、工作区条目、笔记路径和工作区设置。`main/projects.ts` 提供文件夹/项目/笔记/来源引用/本地文件的受控操作。文件夹转换保留身份；移动校验父级和循环；删除递归移除应用记录而保留原件。迁移前沿用备份机制。
- （此条存储约定已由文末“磁盘目录隔离修正”取代。）Markdown 笔记使用独立 UUID 的磁盘 `.md` 文件，默认系统文档目录下 `Dela`，用户可调整新笔记位置；不自动迁移已有文件。编辑器使用原生 textarea 与 react-markdown/remark-gfm 预览，600ms 空闲自动保存、Ctrl/Cmd+S 手动保存。保存前比较内容哈希，外部变化不覆盖；未保存草稿留在应用状态中，退出时提示。文件夹和条目名称独立于文件系统路径。
- renderer 的 `workspace.ts` 供 App、首页、导航、资料和项目共享真实状态，避免原始资料与引用分成两套数据。`Explorer` 是资料树与用户内容树的共同组件；支持树形键盘导航、操作菜单、名称筛选。ProjectView 在现有文件中组合目录、标签、阅读/编辑、分屏与助手；资料页使用同一工作区。文本、HTML 滚动位置与标签、展开状态持久化；PDF 内嵌阅读器的页码/缩放状态暂不保存。
- 侧栏继续使用 Mail 的 h-11 工具栏、48px 折叠入口和 Resizer；沿用资料栏默认 300px、240–420px 拉伸范围及窄屏 280px 抽屉。树缩进按设计系统 spacing 分级。正文切换不增加新的空间位移动画，侧栏使用 150ms 裁剪过渡并遵循减少动态效果设置。
- 新增 `workspace.getChat/configureModel/ask`：致远一号固定服务地址、明确的模型枚举，凭据只在主进程保存。用户手动选择已打开的文本/HTML/Markdown 正文；请求包含所选正文、当前问题与最近 12 条对话，超出上下文预算报错，不默默截断资料。每个工作区保存一段对话，回答可新建为笔记；不具备工具调用、自动文件修改或提交能力。Qwen 已用合成笔记完成真实请求；其他模型尚未验证本次问答路径。流式、取消、多会话切换和 PDF 文本提取仍待实现。
- Canvas HTML 清除脚本、事件属性和嵌入活动内容，使用禁止脚本的 sandbox iframe；允许同源仅用于捕获选区和接管链接，业务 IPC 校验主 frame，子 frame 不可调用。图片从主进程缓存读取后创建临时 Blob URL；PDF 已改由受控 `dela-resource` 协议按 Range 流式读取，不向 renderer 提供磁盘路径或文件字节。下载跳转到允许的对象存储主机时去掉 Authorization，不把签名链接提供给页面。

真实联调：48 门课程、6 个学期分组；抽查 4 门课程包含真实文件树、模块与作业，PDF 下载及 Electron 阅读器显示通过。正式应用确认 Canvas 与模型凭据均可解密读取。不同 userData/sessionData 配置的密文不能直接互拷，联调在各自正确的配置目录内加密，不将导入辅助脚本加入产品。

自动回归：新增 `pnpm smoke:workspace`，在 Electron 的临时用户目录中验证真实 SQLite、磁盘笔记与受控 IPC，网络使用脱敏桩。覆盖分页与非法分页地址、栏目失败缓存、模块引用共享身份、下载不转发认证头、文件夹转换/移动循环、笔记外部修改冲突、删除引用保留文件与另一项目引用、重新打开后标签/滚动/笔记/会话恢复、模型只收到所选正文。保持单包、无新增依赖。

本次没有实现：非 Canvas 课程源的自动合并、本地目录递归挂载、拖放与多选、PDF 页码恢复和全文解析、Office 编辑、完整 Agent 执行循环。此前章节中的这些能力继续视为规划；本文记录的已实现工作区约定优先于旧界面草图。

交付检查：格式检查、构建、单元测试、工作区与 Mail 脱敏回归通过；Windows 目录打包完成，打包程序 `--smoke-test` 退出码为 0。正式环境观察到邮箱凭据解密错误，原因尚未定位，真实邮箱同步未算作验证通过。

### 2026-09-12 磁盘目录隔离修正

用户确认：Canvas 原始文件按课程隔离保存一份，项目保留引用；笔记按工作区的项目/文件夹层级保存。此约定取代此前 UUID 平铺笔记、哈希平铺下载缓存和名称独立于磁盘路径的约定。

- 默认路径为 `文档/Dela/workspace/项目/子文件夹/笔记名.md` 与 `文档/Dela/courses/term-2026-fall/课程名 [课程 ID]/files/folder-目录ID/文件名`。所有程序生成的路径段使用英文；课程名、用户命名和 Canvas 原始文件名保留原文。学期能识别年份和季节时使用 `term-YYYY-spring|summer|fall|winter`，其余学期使用稳定哈希的 `term-` 标识。课程 ID 区分同名课程；文件使用可读名称，冲突加序号，Windows 保留名、路径分隔符及非法字符做文件名归一化。Canvas 模块及项目引用仍共享同一来源版本，来源更新保留旧版本，避免覆盖用户修改过的文件。
- 复用 `workspace_entries.local_path` 记录应用管理的目录、笔记和导入副本路径，`workspace_notes.path` 保持实际读写位置；不新增数据库层级。导入本地文件会复制到当前工作区目录，旧版本的外部路径引用保持不移动。文件夹、笔记和导入副本重命名、移动同步磁盘和数据库，移动父目录时更新后代路径。移动前在 SQLite 写恢复记录，物理移动后以事务更新路径；下次工作区操作可完成被中断的数据库更新。跨磁盘移动暂不支持，文件系统报错时不更改应用关系。
- 旧笔记首次加载工作区时复制到对应目录，迁移前保留 `dela-before-storage-tree.db`；不存在的旧文件保留原路径供恢复，读取时报告缺失。旧 Canvas 缓存按当前已知来源版本在加载资料列表/读取文件时复制迁移，不发起额外下载。旧文件留在原位置作为恢复副本，迁移后不继续写旧文件，也不自动删除未被当前来源引用的历史缓存。迁移重试不覆盖已有文件。
- 更改保存位置只影响之后新建的顶层内容及新下载资料；已存在项目的目录不搬迁，其新笔记仍放在项目目录。关联外部本地文件仍保留原位置；删除项目或引用保留磁盘内容。“复制来源到项目”作为独立编辑副本的产品操作尚未增加，本次不改变现有下载/关联入口。
- `storage.ts` 仅共享工作目录读取、文件名归一化和同名路径分配三个实际被笔记和 Canvas 使用的函数。renderer 无文件系统与数据库访问，无新依赖。
- 验证：扩展 `pnpm smoke:workspace`，在临时用户目录检查磁盘树、同名笔记、旧笔记和旧缓存迁移、目录移动、数据库提交前中断恢复、外部编辑冲突以及删除引用后的文件保留。真实个人数据迁移尚未执行。

本次交付验证：相关文件格式检查、`pnpm build`、7 个单元测试、扩展后的 `pnpm smoke:workspace`、`pnpm smoke`、Windows 目录打包及打包程序 `--smoke-test` 均通过（退出码 0）。构建仍提示较大 renderer chunk，Electron 退出时有 GPU 日志，未影响上述检查结果。个人数据目录未用于此次测试，实际迁移在启动新版后加载工作区与资料时执行。

### 2026-09-13 磁盘结构英文路径段

用户要求所有由程序生成的路径段统一为英文，课程名、用户命名和 Canvas 原始文件名保留原文。工作区根目录由 `工作区` 改为 `workspace`；Canvas 根由 `课程资料` 改为 `courses`，学期使用 `term-YYYY-spring|summer|fall|winter`，Canvas 文件树使用 `files`、`assignments`、`folder-目录ID`、`assignment-ID` 与 `submission`。无法识别的学期使用稳定哈希的英文 `term-` 标识，避免把外部学期文案写入结构目录。已保存的工作区根目录和课程缓存会在下一次访问时迁移并更新数据库路径，不重新下载；新建路径回归和旧中文路径迁移均由 `pnpm smoke:workspace` 验证。

### 2026-09-13 PDF 预览性能修正

- 原实现把完整 PDF 读入主进程，经 IPC 复制到 renderer，并在 Zustand、`Uint8Array`、Blob 与 Chromium PDF Viewer 中同时持有；本地 PDF 还使用同步读取。关闭标签不移除 draft，窗口聚焦会强制重读，并排固定当前文档时可能创建两个相同 Viewer。这些行为会使大 PDF 的内存峰值显著超过文件大小，并造成主进程或 renderer 卡顿。
- PDF `DocumentContent` 现在只返回受控预览 URL。应用启动前注册标准、安全且支持流的 `dela-resource` scheme，主进程仅按已有 Canvas 来源 ID 或 Workspace UUID 解析数据库中的 PDF 路径；不接受 URL 中的磁盘路径。协议支持单字节范围请求、`HEAD`、`Content-Range`、`Accept-Ranges` 与 `416`，正文由文件流直接响应。Canvas 读取 PDF 时只检查 5 字节文件头，本地 PDF 只读取文件元数据；图片维持原 Blob 路径。
- Canvas 首次下载从 `response.arrayBuffer()` 改为响应流写入随机 `.part` 文件，校验元数据大小后以硬链接提交到最终可读路径；文件系统不支持硬链接时退回排他复制，成功后才登记缓存，失败则清理临时文件。Canvas 来源不再因窗口聚焦重读，关闭已保存的非 Markdown 文档标签会移除 draft；并排固定项等于当前项时只显示选择提示，不创建第二个 Viewer。未新增依赖或数据库层级。
- 已验证：格式化、三组类型检查、生产构建、7 个单元测试、`pnpm smoke:workspace`、`pnpm smoke`、Windows x64 目录打包及 `dist/win-unpacked/Dela.exe --smoke-test`。脱敏 Electron 回归确认 PDF IPC 结果无 `bytes`，协议完整读取返回 `200`，普通文件与 256 MiB 稀疏文件的 `bytes=0-4` 请求均返回 `206` 与 `%PDF-`，Canvas 并发首次读取只下载一次。真实大型课件的峰值内存、翻页流畅度和关闭后的 Chromium 缓存回落尚未实测，不能据此宣称所有 PDF 卡顿均已消除。

### 2026-09-13 标题栏应用菜单

参照 Codex 的紧凑菜单形态，Dela 在标题栏窗口导航之后增加“文件”“资料”“视图”“帮助”。文件提供新建项目、导入本地文件（项目页导入到当前项目，其他页面导入到顶层）和保存所有已打开笔记；资料作为 Canvas、邮箱和课表入口；视图切换首页、项目与设置；帮助提供已实现快捷键说明和设置入口。新建项目、导入本地文件和保存已打开笔记分别响应并显示 `Ctrl/⌘⇧N`、`Ctrl/⌘O`、`Ctrl/⌘S`；保存项只在有可保存笔记时可用。菜单触发区最小宽度 48px、弹层最小宽度 208px。所有菜单使用同一受控打开状态与非模态 Radix 行为：打开 A 后移入 B 会直接展开 B，页面其他区域继续可点击。所有写入继续经既有受控 IPC 与工作区状态执行，不新增 renderer 文件系统访问。宽度小于 768px 时隐藏前三个文字菜单，仍保留“帮助”文字。已在本地 renderer 预览核对菜单显示及切换；类型检查和生产构建通过。

### 2026-09-13 Project Explorer 外部文件拖放

参照 VS Code Explorer 的外部拖入复制语义，桌面端可将操作系统文件拖入项目 Explorer。拖到项目或文件夹时复制到该容器并自动展开；拖到普通文件行或 Explorer 空白处时复制到当前项目根目录，原文件保持不变。拖入 Explorer 后全工作区显示不可拦截指针的暗化提示层，目标容器继续使用现有高亮，离开或完成投放后立即撤销提示。路径不传给 renderer：preload 对原生 `File` 调用 Electron `webUtils.getPathForFile()`，仅将非空路径数组经新增的受控 IPC 交给主进程；主进程校验父项、最多 100 个路径后复用既有复制导入函数。外部目录不在本次文件拖入范围。已验证格式检查、三组类型检查、7 个单元测试及工作区冒烟；原生文件管理器的实际指针拖放尚未自动化验证。

### 2026-09-13 应用品牌形象

应用内品牌图改为随明暗主题切换的两张 SVG——浅色显示 `Dela_white_bg.svg`、深色显示 `Dela_black_bg.svg`，主题默认仍为 system。切换规则定义在 `globals.css`，与明暗 token 完全一致（`html.dark` 类优先，否则跟随系统媒体查询且可被 `html.light` 屏蔽）；两张图同尺寸叠放在同一网格单元，主题切换无布局位移。新增共享 `DelaBrand` 组件（`components/ui/dela-brand.tsx`），用于主侧栏顶部与设置关于页；关于页原先使用的透明 `Dela_Logo.png` 不再被 renderer 引用，素材文件保留在仓库。

设置 › 外观新增「应用图标」选择（白底/黑底，与主题选择共用同文件内提取的 `OptionCard` 单选卡片）：`dela.settings.getIcon/setIcon` 只接受 `white`（默认）/`black`，经 zod 校验与主 frame 检查后持久化到 `workspace_settings` 的 `icon` 键。主进程创建窗口时按偏好加载 `assets/Dela_<色>_bg.png` 作为 BrowserWindow 图标；按用户要求重启应用后生效，运行中不热切换。electron-builder `files` 同时打包两份 PNG。平台限制：Windows 桌面快捷方式与 exe 资源图标在构建时由 electron-builder 顶层 `icon`（白底）固定，运行期设置只能改变窗口/任务栏图标，安装包内 exe 图标不随设置变化。

冒烟断言补充 `settings.getIcon` 存在性检查。已验证：格式检查、oxlint、三组类型检查、生产构建、7 个单元测试与 Electron 冒烟；明暗切换下的关于页/侧栏品牌图与黑底窗口图标重启生效待实机视觉核对，NSIS 重打包未执行。

## Agent 业务接口当前实现（2026-09-13）

本节取代此前 Agent 分阶段进展中的未完成状态。前文带日期的验证记录和界面草图保留历史含义；以下区分已实现与已验证，不将框架或接口能力当作真实端点验证。

### 调用结构与文件职责

仍为单应用、单 package，无新增 HTTP 服务、MCP 服务或 Agent 框架依赖。

```text
页面 → preload / IPC → 共用业务函数 → SQLite / 文件 / 校园接口
助手 → agent-loop → agent-tools ────────┘
```

| 文件                                             | 当前职责                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| `src/main/workspace/api.ts` / `workspace/ipc.ts` | 工作区业务入口与页面通信；不再包含聊天调度             |
| `src/main/agent/api.ts` / `agent/ipc.ts`         | 聊天保存、运行取消、状态推送与兼容的聊天 IPC           |
| `src/main/mail/api.ts` / `timetable.ts`          | 页面和工具共用的邮件查询/读取/附件保存、日程创建与查询 |
| `src/shared/resources.ts`                        | 严格校验 workspace、canvas、mail、attachment 引用      |
| `src/shared/schedule.ts`                         | 与课表界面共用节次表，按上海时区展开课程日期           |
| `src/main/resources.ts`                          | 解析项目/Canvas/附件文件，复制导入及临时下载清理       |
| `src/main/mail/drafts.ts`                        | 保存原始草稿、按资源引用加载发送附件                   |
| `src/main/agent/tools.ts`                        | 15 个工具的描述、Zod 输入校验、模型 schema 和执行结果  |
| `src/main/agent/loop.ts`                         | 模型请求、SSE 解析、工具循环及执行边界                 |
| `src/renderer/features/projects/AgentPanel.tsx`  | 首页与项目助手共用的对话、进度、结果和邮件编辑入口     |

资源引用使用对象，例如 `{ type: 'workspace', id: '<UUID>' }`、`{ type: 'canvas', id: 'file:123' }`、`{ type: 'mail', id: 123 }`、`{ type: 'attachment', messageId: 123, part: '2' }`。引用不是磁盘路径或下载 URL；解析时验证资源仍存在，邮件缓存 ID 不承诺永久有效。

### 工具输入与输出

统一执行结果为 `{ ok: true, result }` 或 `{ ok: false, error: { code, message } }`。错误码包括 UNKNOWN_TOOL、INVALID_INPUT、OPERATION_FAILED；循环另处理 INVALID_JSON。输入 schema 已生成给模型，尚未为每个输出建立独立运行时 schema。分页查询使用 offset/limit 与 nextOffset，具体以源码为准。

| 工具                   | 主要输入                              | 主要结果与范围                                   |
| ---------------------- | ------------------------------------- | ------------------------------------------------ |
| `find_courses`         | query、offset、limit                  | 缓存课程 ID、名称、同步时间/错误                 |
| `sync_sources`         | 可选 courseId                         | 同步课程列表或指定课程资料，检查部分失败信息     |
| `search_sources`       | query、courseId、kind、分页           | 缓存标题搜索，去重后的 Canvas 引用与课程同步情况 |
| `search_workspace`     | query、parentId、分页                 | 名称搜索；parentId 仅限定直接子条目              |
| `search_mail`          | query、from、folderId、起止时间、分页 | 主题/摘要缓存搜索；返回 UID 窗口与同步信息       |
| `read_resource`        | ref、offset、limit                    | 正文字符分页、格式、笔记 revision 或邮件附件引用 |
| `query_assignments`    | courseId、截止时间范围、分页          | 缓存作业与截止时间，submissionStatus 为 unknown  |
| `query_schedule`       | semester、startAt、endAt              | 课程和个人事件，上海时区及缺失数据警告；最多一年 |
| `create_event`         | title、startAt、endAt、location       | 实际保存的个人事件；不修改课程                   |
| `create_entry`         | parentId、kind、name、text            | 新项目/文件夹/笔记及引用                         |
| `update_entry`         | id、name、parentId                    | 重命名/移动后的实际条目                          |
| `write_note`           | id、text、revision                    | 保存后的笔记版本；冲突返回错误                   |
| `link_source`          | parentId、sourceId、name              | 保留来源的项目资料关联                           |
| `copy_file_to_project` | source、parentId                      | 项目文件、Canvas 文件或附件的独立导入副本与引用  |
| `prepare_email`        | to、subject、text、attachments        | 原始草稿 ID、内容和引用；sent 为 false           |

邮箱缓存只保留每个文件夹近期 300 个 UID 窗口，并非完整邮箱或固定 300 封邮件。Canvas 尚无可靠提交状态；缺少截止时间的作业不进入带日期过滤的结果。未知周次、无效节次或缺少学期日期不会猜测实际课程日期。正文读取不自动标记邮件已读；PDF/图片不做全文提取，HTML 以文本标记返回。

### 执行与 UI

首页为两状态布局：闲置态居中 composer、建议胶囊与项目卡片，会话态消息流占满、composer 钉底；项目页右栏为面板形态。两者共用 `renderer/features/chat` 的对话核心（ChatThread/ChatComposer/useChat），会话按 scope 多会话管理。用户请求、@ 引用的正文、最近 12 条角色/正文消息及本轮工具结果进入模型上下文。工具内容可能包含个人邮件或资料，界面已说明它们会提供给致远一号。

最多执行 12 轮模型请求（最后一轮请求前注入“总结收尾”提示），工具顺序执行。每个模型请求独立 120s AbortSignal 超时；429/5xx/网络中断按 1s/3s 退避重试，4xx 与流式已产出内容后的失败不重试。已运行的业务函数未普遍接入 AbortSignal，工具执行不可中断读取。取消中断模型请求并阻止下一项工具，不回滚已完成写入。

SSE 文字经聊天更新推送，分片工具参数收到完整结束标记后才执行；提前断流或长度截断报告错误。同时支持返回普通 JSON 的端点。文字增量不逐 token 写库，按 ~100ms 节流广播；单条工具结果回灌模型前截断至 20000 字符并附引导说明；工具完成及最终回复时持久化。工具结果逐项保存，后续模型失败不会自动重试已完成操作。没有独立任务恢复、完整状态机或自动记忆。

聊天更新只发给经过 workspace IPC 来源校验的应用窗口。界面在消息内展示当前工具与折叠的结构化结果、错误与停止按钮；结束后刷新工作区、Canvas 缓存和已保存的打开文档，日程页刷新个人事件。未保存文档不被刷新覆盖。

### 文件和邮件草稿

文件解析统一通过 withResourceFile；邮件附件临时下载后交给复制或草稿加载函数，结束后清理临时目录。导入复用现有工作区物理路径与重名处理，不另建文件存储体系。

原始邮件草稿保存在 workspace_settings 的 email-draft 键下，包含正文和资源引用，不是 IMAP 草稿。用户从工具结果点击“检查并发送”，经 preload 加载附件并打开现有 MailComposer；正文使用 textContent 初始化，附件总大小限制为 70 MiB。附件打开时解析，引用失效会报错；原始草稿不保证附件内容快照。打开后的附件存于本次写信的内存记录，关闭/发送时沿用附件释放逻辑。

Agent 原始草稿保留；编辑器可以另存为本地草稿，本地草稿再次保存时覆盖同一份，成功发送后删除对应本地草稿。Agent 原始草稿仍不自动更新发送状态，再次打开原始草稿可能再次发送。工具没有自动发送或提交作业能力。笔记写入直接执行并校验版本，修改差异预览尚未实现。

### 验证状态与下一阶段

流式改动前已通过类型检查、lint、24 项单元测试、构建和工作区冒烟。覆盖工具输入拒绝、正文分页、PDF 能力边界、课程时间转换、结果衔接与失败不重试；草稿冒烟验证通过 preload 加载笔记附件及不暴露路径。首页曾检查真实 Electron 截图。模拟网络与模型响应不证明真实端点工具调用兼容。

按用户要求，最新流式改动后只做格式化，未追加测试、构建或打包。此前其他阶段的 Windows 打包记录不覆盖本次 Agent 改动。真实 Qwen 普通正文问答的历史验证也不覆盖新工具循环、流式或其他模型。

下一阶段先确认真实致远一号的工具调用与流式响应，再走完整业务流程、修正工具与交互问题；用户恢复验收安排后再做最终构建、回归及打包启动检查。记忆、自动任务恢复、复杂并发编辑协调、多 Agent 和 shell 继续暂缓。

## 业务领域目录与本地邮件草稿（2026-09-13）

按用户确认的范围，目录重构保持既有业务行为；新增功能仅限本地草稿及关闭保存流程。mail、canvas、timetable、workspace、agent 均预先划分 api.ts 与 ipc.ts；邮件发送/草稿、工作区预览继续作为对应领域中的具体职责文件，测试随领域移动。共用数据库、凭据、存储和跨领域文件流转留在 main 根目录。

api.ts 承载业务调用，ipc.ts 负责通道注册、页面参数接入与交互入口；不新增 Manager/Service/Factory。项目业务已移除聊天执行状态与模型调度；Agent 工具调用领域函数，领域业务不导入 Agent。保留现有 workspace:* 聊天通道和 workspace:open-email-draft 兼容入口，避免目录调整改变 renderer 协议。部分已有登录窗口、同步状态广播仍在领域实现中，未借此次目录调整重写这些流程。

### 本地草稿功能

- 邮箱侧栏“发送邮件”上方新增 FilePenLine 图标的“本地草稿”入口，展开/折叠与窄屏抽屉均可访问；列表按当前账号过滤，支持打开和删除。
- 写信工具栏新增保存草稿按钮。收件人允许为空或尚未填写完整，真正发送时仍走原收件人校验。
- 关闭写信、切换业务页面、前进/后退、切换邮箱文件夹、退出账号或关闭应用时，未保存编辑提供“保存草稿 / 不保存 / 继续编辑”。保存失败保留当前编辑；没有修改的已保存草稿无需重复确认。Agent 邮件编辑弹窗复用同一机制。
- 草稿文件位于 Electron userData/mail-drafts/<UUID>.json，包含收件人输入、主题、纯文本、受限富文本及附件/正文图片的 base64 快照；写入临时文件后重命名替换。SQLite workspace_settings 的 mail-draft:* 键保存列表摘要。路径由主进程生成，renderer 不提供磁盘位置。
- 图片恢复时重新登记发送文件 ID 并重映射 CID，富文本经元素白名单重建，不直接插入存储的 HTML；沿用已有 70 MiB 附件总大小上限。重启后不依赖原文件路径或之前的内存附件 ID。
- 已保存草稿再次保存覆盖同一 ID；发送成功删除对应本地草稿，删除失败明确提示邮件已经发送。选择“不保存”只放弃本次编辑，不删除之前已保存的版本。
- Agent prepare_email 的原始草稿仍保留原语义：保存资源引用，不自动发送、不自动写 IMAP 草稿箱；用户在编辑器保存后得到独立的本地附件快照草稿。

本次通过 TypeScript 三个入口类型检查和 oxlint。按用户此前不追加测试的要求，未运行单元测试、UI 回归、生产构建或打包；实际退出弹窗、重启恢复和富文本附件发送仍待运行验收。原有历史通过记录不代表本次功能已完成运行验证。

## 邮件回复、显示设置与编辑器改进（2026-09-13）

四个并行改动，按页面互不重叠地分配文件后合并验证。

### 邮件回复

MailReader 主题行右侧新增回复按钮（Reply 图标，桌面/窄屏可见）；MailView 以 `replyDraft` 构造 `PreparedEmail` 复用现有 draft 加载路径：收件人取原发件人地址、主题加 `Re: ` 前缀（检测既有前缀避免重复）、正文为署名行（`在 {时间}，{发件人} 写道：`）加逐行 `> ` 引用。回复对象不携带 `savedLocally`/持久 ID，`id` 仅作 React key，因此不会覆盖或删除既有本地草稿；关闭时沿用 leaveComposer 未保存确认。纯 HTML 邮件 `bodyText` 为空时只保留署名行，不在 renderer 做 HTML 转文本。

### 显示设置：页面缩放与字号

沿用 theme/icon 的 settings IPC 模式新增 `getZoom/setZoom/getFontScale/setFontScale`（zod 档位校验，SQLite workspace_settings 持久化）。缩放为主进程 `webContents.setZoomFactor`，`createWindow` 在页面加载完成后恢复；档位 0.9/1/1.1/1.25/1.5，快捷键 Ctrl/⌘ `=`/`-`/`0` 经 AppShell 既有全局 keydown 通道步进并与设置页共用状态。字号经根节点 `--font-scale` 缩放 Tailwind `--text-*` token（档位 0.9/1/1.1/1.25），只作用于 rem 字号；px 任意值字号、CodeMirror、邮件 iframe 与 PDF 阅读器不跟随，属已知边界。浏览器预览降级：缩放用 CSS `zoom`，两者均会话内本地状态。设置页接口见 `src/renderer/features/settings/INTERFACES.md`。

### CodeMirror：IME 与按扩展名语言

IME 问题定位为外部值同步 effect 在组文期间 dispatch 全量替换（触发路径：window focus 的 `read(force)`、重载按钮、Agent 工具完成后的已保存文档刷新在组文起笔、首个变更尚未派发时整体替换 `draft.text`，Chromium 随即取消 IME 会话）。修复：同步收敛为 `syncValue()`，用 `view.compositionStarted` 守卫整个组文会话，真分叉时置 `pendingValueSync`，`compositionend` 后微任务补同步；keymap 与 blur→onSave 经源码核实不构成问题，未改。`@codemirror/view` 6.43.11 已是最新，无上游修复可升级。

新增可选 `filename` prop 作为编辑器与文档层的接口契约：`.md`/`.markdown` 维持 `markdown({ codeLanguages })` 现状；其他扩展名经 `@codemirror/language-data` 按 extension 解析（异步 load 经模块级 Compartment reconfigure，加载前纯文本，不包 markdown()），未识别按纯文本；ProjectDocument 传入 `entry.name`。零新增依赖。代码文件下 `markdownKeymap` 的 Enter 列表续写仍生效，属可感知怪癖，待上层决定是否按格式裁剪 keymap。

### 工作区文件类型与工具栏

移除三处强制 `.md`（旧版迁移、新建、重命名/移动）：`availablePath`/`diskName` 只做 Windows 非法字符归一化与同名去重，用户输入即磁盘名。note 的 format 按实际扩展名返回（`.md`/`.markdown` → markdown，其余一律 text——笔记由应用以 UTF-8 写入）；本地/导入文件映射扩展到常见文本与代码格式（json/xml/yaml/toml/ini/html/css/js/ts/py/c/cpp/java/cs/go/rs/rb/php/swift/kt/sh/sql/tex 等），未列出扩展仍 unsupported。存量语义变化：此前自动追加过 `.md` 的旧笔记在下次重命名/移动时按输入精确改名，不输入 `.md` 即去掉旧后缀；旧版迁移产物由 markdown 变为 text（无预览），该路径仅对 2026-09-12 存储树改造前数据触发。

工具栏按 VSCode 上下文相关操作原则修正四处：预览仅对 `editable && format==='markdown'` 显示且用派生值防止重命名后卡在预览态；保存按钮补三态 tooltip（保存中…/已保存/保存 (Ctrl+S)）；Link2 移除 `!readOnly` 限制使参考窗与主窗一致；FolderOpen 纳入 imported（导入副本有 local_path 且 open-local 可用）。下载、打开原文、重新载入经审计确认逻辑正确，未改。

### 验证状态

三个入口 TypeScript、`pnpm build`、`pnpm smoke`、`pnpm smoke:workspace`（断言已同步无后缀命名）通过；workspace-smoke 中 renderer 读取新设置项的未注册 IPC 报错与既有 get-theme 噪音同源，应用内已 catch。待实机验收：真实 IME 输入手感、缩放重启恢复、字号视觉、打包后启动、真实账号下的回复发送全流程。imported/local 文本文件的“在系统默认应用打开”与 Canvas 端文本扩展清单复用为后续建议，未实现。

## 邮箱本地化：草稿箱与已删除（2026-09-13）

经用户确认的文件夹语义：`\Inbox`/`\Sent`/`\Junk`/服务器自建文件夹同步；`\Drafts`/`\Trash` 本地化，侧栏两格为常驻伪条目（草稿箱=本地草稿，已删除=本地回收站），renderer 按 rank（草稿箱 1、已删除 4，与 SPECIAL_USE_ORDER 对齐）与服务器文件夹稳定合并排序。

主进程：runSync 跳过 `\Drafts`/`\Trash`（keptPaths 为空时守卫 NOT IN ()），getMailState 读取路径幂等清理本地残留文件夹行（FK CASCADE 已实证生效）；未读数改由本地统计（`deleted_at IS NULL AND seen=0`），upsert 不触碰 deleted_at。服务器草稿箱一次性清理（用户明确授权的破坏性操作）：仅精确匹配 `specialUse === '\Drafts'`，status 确认数量后 messageDelete（ImapFlow 单调用即 \Deleted+EXPUNGE），成功写 `mail-drafts-purged`=账号地址，失败不写键下次重试且不中断同步。删除/恢复/彻底删除/清空/保留期七条 IPC 经既有 handle 助手注册；保留期存 `mail-trash-retention`（'7'/'30'/'90'/'0'，zod 校验，默认 30），runSync 成功后与 getMailState 各清理一次过期条目。Agent 全局搜索 searchMail 补 `deleted_at IS NULL` 过滤。

renderer：MailFolders props 重构为统一 selection（folder id/drafts/trash），删除底部本地草稿入口；回收站列表复用邮件列表样式（恢复/彻底删除行内图标、清空需确认），阅读页删除按钮在回复旁，删除后未读数联动、瞬时提示；回收站阅读只读（隐藏回复与删除、不标已读以保留未读状态）；设置›学校邮箱提供保留期选择，无 preload 时隐藏。

mail-smoke 脱敏回归修复了一个既有断档：本地草稿功能把关闭确认从 window.confirm 改为 mail:confirm-draft-close IPC 时未同步更新桩，现桩回调页面 window.confirm（true→save/false→cancel）保持原断言语义，并补齐草稿通道桩。

验证：类型检查×3、vitest 32/32（新增 purge 一次/失败重试/级联、deleted_at 跨同步保留、本地未读统计、delete/restore/purge 生命周期、保留期默认/校验/过期）、build、smoke、smoke:workspace、mail-smoke 全通过。待实机：真实账号服务器草稿箱清理、删除恢复全流程、保留期清理实际生效。边界：同步窗口裁剪会移除旧于 300 封的回收站条目；purge 失败静默重试无 UI 提示。

## 邮箱分级降档与设置页控件修正（2026-09-13）

邮箱内容区改为容器实测宽度驱动的分级降档（ResizeObserver + useLayoutEffect 首帧同步测量，逻辑内联在 MailView，未做通用抽象）：容器 <1000px 时文件夹栏在用户偏好之外强制折叠为 48px 图标栏并隐藏折叠开关（hideHeader，避免"点开又被自动折叠"打架），localStorage 持久化偏好不动、拉宽还原；<760px（或窗口 <768px）进入单栏态，列表与详情二选一，MailReader 新增可选 showBackButton 控制返回按钮，占位类由窗口 `max-md:*` 改为 stacked 驱动（narrow 仍走 AppShell 两级抽屉）。阈值推导：760 = 48+320+1+391（折叠态四列的可读下限），1000 = 220+320+1+459（展开态四列的可读下限）。MailComposer 新增可选 className，占位类移至 MailView 调用方（AgentPanel 的 Dialog 用法下 col-span 本就不生效，不受影响）。边界：跨 760 阈值时 grid 轨道数变化无法插值，布局为切换式（与原 max-md 边界一致）；48↔220 折叠仍有 150ms 过渡；单栏阅读中拉宽再收窄会回到阅读态（状态连续性设计）。

设置页：外观节「页面缩放/字号」的 Aa 卡片组改为右对齐下拉 select（`h-9 w-24`，固定宽度防选项切换跳动），档位集合、保存流程与 Ctrl/⌘ 快捷键步进均不变——未采用 ±10% 步进器，因其与 1.1/1.25 非整十档位冲突，需连带修改 shared 档位集、主进程 zod 校验与快捷键步进（select 与步进器为用户给出的二选一，此处取低风险项；如需步进器另立任务）；SizePreview 随替换删除，OptionCard 保留给主题/应用图标。「数据与服务」五项移除整体卡片边框（五项语义不同质，外框产生错误分组暗示），行间保留细分隔线并与节标题左对齐，行内内容与交互不变。

验证：typecheck×3、oxlint 0 警告、vitest 32/32、prettier 通过；三个子任务并行修改互不重叠的文件后统一集成检查。待实机：真实窗口下三档布局的阈值手感、缩放/字号下拉、数据与服务对齐效果。

## 首页两状态改版、多会话与 Agent 循环强化（2026-09-13）

参照主流 AI 产品的首页组织（闲置态/会话态为同一页面两状态，composer 为贯穿两个状态的连续元素），重做首页并抽取共享对话核心。调研基础：Anthropic「Building Effective Agents / Writing Tools / Context Engineering」、Manus context engineering、OpenAI Agents SDK 文档、vercel/ai-chatbot 与 streamdown/use-stick-to-bottom 的实现模式。

### 数据库与会话模型（v9）

新增 `chat_sessions` 表（id、scope、title、messages JSON、created_at、updated_at，`(scope, updated_at DESC)` 索引）；迁移把旧 `workspace_settings` 的 `chat:<scope>` JSON 转为各 scope 的首个会话后删除原键，迁移前自动 `VACUUM INTO` 备份。主进程为每个 scope 维护“当前会话”指针：缺省解析为最近更新的会话（与旧单会话行为一致），「新对话」把指针置空并把从未发送过消息的空会话删除（空会话不进历史）；首条消息发送时才建会话行，标题取首条消息前 60 字符。新增受控 IPC：`new-chat`、`list-chats`（LIKE 搜索标题与消息原文，转义 %/_，上限 100 条）、`open-chat`、`delete-chat`；`configure-model` 的 key 允许空串（仅切换模型，沿用已存密钥）。`WorkspaceChat` 增加 `sessionId`。

### renderer 共享对话核心

新增 `features/chat`：`useChat`（会话加载、推送订阅、发送、引用 chips、模型切换、多会话操作；`listSessions` 经 useCallback 保持稳定引用）；`ChatThread`（消息流唯一滚动容器：距底 48px 内自动跟随、`overflow-anchor:none`、滚轮上滚立即脱离、非跟随态显示“回到底部”；工具步骤行 = 状态图标 + 工具名 + 输入摘要 + 可展开详情，邮件草稿保留“检查并发送”；流式光标、“正在思考…”占位、流式期间未闭合 ``` 围栏临时补全）；`ChatComposer`（Enter 发送/Shift+Enter 换行，IME 以本地 composition 状态 + `nativeEvent.isComposing` + keyCode 229 三重判断；textarea 用 `field-sizing-content` 自适应（Chromium 123+ 支持）；`/` 指令菜单与 `@` 引用菜单共用一套触发词检测/键盘导航/`onMouseDown preventDefault` 模式，引用 chip 可移除；底部模型下拉与发送/停止圆形按钮）；`ChatSessions`（历史弹窗：200ms 防抖搜索、打开、删除、当前会话高亮）；`ModelKeyForm`。AgentPanel 改为该核心的面板形态（保留头部分隔、折叠按钮、密钥表单与 `@` 候选把当前打开文档排前的策略），移除已无用的 `title`/`home` props 与旧的复选框引用抽屉。

首页 `HomeView` 为两状态：闲置态居中问候语（未配置时为密钥表单）、hero composer、数据驱动建议胶囊（最近项目/近期作业/今日日程）与项目卡片，删除与侧栏重复的“课程资料”长条；会话态为右上方「历史/新对话」图标行 + 消息流 + 钉底 composer。composer 单节点常驻，用 `motion.div layout="position"` 弹簧位移衔接两状态（MotionConfig 全局尊重减少动态效果）；消息流淡入。会话态不再渲染闲置内容（第一轮验证曾出现 AnimatePresence 退出动画卡在半透明的残留，改为直接条件渲染后消除）。发送失败时用户消息已上屏，故输入同样清空，错误提示保留在 composer 下方。

### Agent 循环（loop.ts）强化

按调研共识落地五项低成本改进：(1) 模型请求改为每轮独立 `AbortSignal.timeout(120s)`，多轮长任务不再被整跑共享计时误杀，用户取消仍即时生效；(2) 传输层瞬时错误（429/5xx/网络 TypeError）按 1s/3s 退避重试（最多 2 次），4xx 不重试，流式已产出内容后的失败不重试；(3) 单条工具结果回灌模型前超过 20000 字符截断并附“请用更具体的过滤或分页参数”引导，UI 侧仍保存完整结果；(4) 第 12 轮请求前注入“请总结收尾，不再发起新工具调用”的用户提示；(5) `max_tokens` 4096→8192（降低深度思考模型截断概率）。错误回灌（INVALID_JSON/UNKNOWN_TOOL/失败结果作为 tool 消息继续循环）与 12 轮上限维持原状；系统提示词未动。

### 验证状态

通过：三入口 typecheck、oxlint 0 警告、prettier、34 项单元测试（loop 新增瞬态重试成功、4xx 不重试用例）、`pnpm build`、`pnpm smoke`、扩展后的 `pnpm smoke:workspace`（新增 newChat/listChats 搜索/openChat/deleteChat 断言，modelCalls 断言保持单次）。另以隔离 userData 的真实构建实例经 CDP 核对 7 个界面状态（闲置未配置/闲置/会话/历史弹窗/新对话回闲置/项目面板/面板历史），DOM 断言含会话态无闲置残留、发送后输入清空、历史时间合法；视觉验收两轮通过（第一轮发现：会话态闲置内容残留、历史 Invalid Date（SQL 列名 `updated_at` 未别名所致）、ChatSessions effect 因回调引用不稳定导致无限重渲染——均已修复）。

边界与待验证：真实致远一号的流式与工具调用兼容性仍未实测，本次界面与循环改动均在脱敏桩与假密钥（真实端点 401）路径上验证；删除历史会话不可恢复；@ 引用候选仅限工作区条目与打开文档（Canvas 原始资料经资料条目引用）；窄窗口（高度 <600px）闲置态为滚动降级，未逐档视觉核对；`field-sizing-content` 在浏览器预览的旧内核下退化为固定高度。

## 校园登录会话跨重启保存（2026-09-14）

已确认实现缺口：原有 `persist:dela-campus` 仅持久化网站指定有效期的 Cookie；没有会话 Cookie 的恢复机制，也未在登录完成后立即 flush。原连接检测仅检查 JAAuthCookie 或校园域 Cookie，不能证明登录有效。Electron Cookie API 明确说明无 expirationDate 的 Cookie 不跨会话保留：https://www.electronjs.org/docs/latest/api/cookies 。未读取真实账号 Cookie，因此实际 Cookie 名称、学校端期限不作推断。

主进程 `timetable/session.ts` 为登录、状态检测、同步、断开共用同一初始化 Promise。仅对专用分区的 sjtu.edu.cn 及子域 session Cookie 保存 safeStorage 加密快照（userData/campus-session.bin）；监听添加、覆盖和删除，临时文件写完后替换快照；恢复时保留 hostOnly/domain/path/secure/httpOnly/sameSite 属性且不覆盖当前已有 Cookie，不人工增加有效期。网站持久 Cookie 与浏览器信任数据继续由原分区管理，登录和同步后 flush；断开清除整个专用分区存储和快照。renderer 不接触 Cookie 或文件。

课表请求复用原 POST 接口并设置 15 秒超时；登录导航到校园网站后还需通过数据结构验证才报告成功。设置页状态不再凭 Cookie 存在判定成功，空课表仍视为有效登录；重定向、HTML、无效响应或网络错误显示未连接，保留本地会话和课表缓存。未新增自动 SSO 续期；学校端会话过期时经原登录窗口重登，可复用学校允许的浏览器信任状态。

已验证：39 项单元测试（包含实际响应判定）、生产构建、Electron smoke；独立三进程模拟 Cookie 测试验证会话恢复、hostOnly/HttpOnly/Secure/SameSite、持久 Cookie 留存和断开后无残留。真实扫码、信任期限、学校服务端失效策略与跨平台凭据加密仍待实机验证。

补充验证：Windows 目录打包与 `dist/win-unpacked/Dela.exe --smoke-test` 通过；三进程测试还覆盖 Cookie 删除不复活、覆盖后恢复最新值。相关文件 Prettier、Oxlint 与 `git diff --check` 通过。本次未修改依赖、数据库或 renderer。

## LLM 提供商自定义配置（2026-09-14）

本节取代此前"仅致远一号"的模型接入约定。调研了 cc-switch（preset 与配置实例分离、`current` id 切换、模型列表端点探测）、Cherry Studio（真实对话请求级"检查"）与 ChatBox（ProviderDefinition 预设目录）后，按本应用业务裁剪：预设只预填默认值不持密钥，密钥只在主进程的配置实例中，一个 activeId 决定当前使用中的提供商。

### 数据与存储

- `src/shared/llm-presets.ts`（main/renderer 共享）：致远一号、DeepSeek、MiniMax、智谱 Coding Plan、自定义五个预设，各含 baseUrl、初始模型列表与获取密钥的控制台链接；第三方模型名是规划时按官方文档整理的初始建议，权威来源是检测按钮返回的模型列表。
- 主进程 `credentials.ts` 新增 `llm-providers.bin`（safeStorage 加密，userData）：`{ providers: [{ id, name, baseUrl, apiKey, models, model, presetId }], activeId }`。旧 `model-credential.bin`（key+model 单凭据）在首次访问时懒迁移为一条致远一号提供商配置（沿用密钥与模型，模型不在预设列表时回退默认），写入成功后删除旧文件；迁移失败保留旧文件。
- `agent/providers.ts`：列表/保存/删除/启用/选模型操作（zod 校验：名称 ≤50、baseUrl 须 http(s)、密钥 ≤4096、模型列表 1–64 项且默认模型必须在列表内）；`list()` 返回不含密钥的视图，新建提供商自动启用，编辑时空密钥表示沿用已存密钥，删除使用中的提供商回到未配置态。
- 检测功能（`verifyLlm`）：GET 模型列表端点——baseUrl 以 `/v数字` 结尾时取 `{base}/models`，否则依次尝试 `{base}/v1/models`、`{base}/models`；`Authorization: Bearer` + 15s 超时；401/403 报密钥无效，2xx 解析 OpenAI `{data:[{id}]}`、智谱 `{models:[{slug}]}` 与裸数组三种形态并返回模型列表供导入。已保存提供商可免重填密钥直接检测（主进程取存储密钥），编辑对话框草稿也可检测。个别网关 `/models` 不校验密钥，检测结果以该端点行为为准，界面文案已注明。
- `agent/loop.ts` 端点改为 `baseUrl 去尾部斜杠 + /chat/completions`；`agent/api.ts` 的 configured/model 与请求参数均取自 activeId 对应提供商，未配置报"请先在设置中配置模型服务"。

### 通道与界面

- 新增 `llm:list/save/remove/set-active/set-model/verify` IPC（沿用 `checkWorkspaceSender` + zod），preload 暴露 `dela.llm`；`workspace:configure-model` 及其 preload 方法移除。`WorkspaceChat` 增加 `providerName` 与 `models`（composer 模型下拉的数据源），模型枚举不再硬编码。
- 设置页新增「模型服务」分区（导航置于数据与服务之后）：提供商列表行（使用中 Badge、使用/编辑/两步确认删除）、添加/编辑对话框（预设预填、密钥留空保持、模型 chips 增删、默认模型选择、检测密钥与导入模型列表、获取密钥外链）；「数据与服务」移除致远一号行。浏览器预览（无 preload）显示仅桌面端可用提示。
- 聊天空状态快捷表单改为"预设厂商 + API Key + 模型"三字段，保存后直接启用；composer 底部模型下拉改为数据驱动（原三处重复的模型标签表删除，统一显示模型 id）；AgentPanel 的「模型设置」按钮移除（职责并入 composer 下拉与设置页）；"会提供给致远一号"文案改为动态 providerName。

### 验证状态与边界

已通过：Prettier、Oxlint 0 警告、三组类型检查、`pnpm build`、53 项单元测试（新增 providers 14 项：保存/脱敏视图/空密钥沿用/模型校验/启用与删除/端点候选规则/三种列表解析/检测的 401、回退、存储密钥、无密钥、不可达分支）、`pnpm smoke`、`pnpm smoke:workspace`（新增断言：旧单凭据迁移为致远一号提供商并删除旧文件、list 不含密钥、verify 经 /models 成功且返回模型、setModel 切换后 ask 的 model/providerName 正确）。设置页模型服务界面为代码实现，未做实机视觉核对；第三方提供商（DeepSeek、MiniMax、智谱 Coding Plan）的真实端点流式与工具调用兼容性未实测，属待验证能力；检测功能未对真实第三方密钥验证。

## 水源 User API Key 授权验证（2026-09-14）

已验证但尚未接入应用：水源可向展示名为 Dela 的请求签发只读 Discourse User API Key。测试由用户在水源授权页手动确认；本机以一次性 RSA 私钥解密回传 payload，使用 `User-Api-Key` 与 `User-Api-Client-Id` 成功请求 `GET /session/current.json`，再成功 `POST /user-api-key/revoke` 撤销测试 key。测试 key 未写入 Dela，临时私钥已删除。

## 课表控件与层叠改进、首页视觉层次、重启默认新对话（2026-09-14）

四项并行改动，文件互不重叠，由四个子任务实现后统一集成验证。

### 课表：自定义 Select 与数字日期输入

- 新增 `components/ui/select.tsx`：radix-ui Select 原语的组合式薄封装（写法对齐既有 dropdown-menu）。触发器保持原页头胶囊样式（h-8、bg-secondary/70、text-xs、ChevronDown），下拉内容 Portal + rounded-lg/bg-popover/shadow-md，选项 hover 用 accent、当前项右侧 Check 标识，开合动画沿用 tw-animate 类，明暗主题走既有 token。页头「学期」「教学周」两处原生 select 已替换，HeaderSelect 随之删除。
- 新增 `features/timetable/DateInput.tsx`：年/月/日三段数字输入（inputMode=numeric，`/` 分隔），仅在 onChange 过滤非数字并裁剪长度（不用 keydown 操纵值，IME 安全；焦点类按键带 isComposing 守卫）；段内填满自动跳段、Backspace 空段回退、方向键移段；三段构成真实日期才输出 `YYYY-MM-DD`，否则空串由调用方提交时报错。新建事件弹窗的开始/结束日期与开学日期弹窗均已替换；时间输入保留原生 `type="time"`。
- 新增 `layoutDayColumns`（timetable-format.ts，纯函数 + 7 项单元测试）：把时间严格相交（start < other.end 且 other.start < end；首尾相接不算）的项聚簇，簇内按开始时间 first-fit 分列，每项宽度 = 100/最大列数。周视图同一天的课程与本地事件参与同一次布局（此前渲染顺序靠后者直接覆盖先前者）；事件以裁剪到时间轴后的可见区间参与相交判定。
- 课程块第二行改为「教师 · 教室」（教师为 null 时与原显示一致）——教师排在教室之前，保证并排窄列截断时教师名可见；事件块按高度分级渲染：≥44px（约 55 分钟）显示时间行、≥60px（约 75 分钟）再显示地点行，次要行改 leading-none，避免中文行高下文字贴底被裁。44/60 为按内容区行高实测推导的阈值（padding 12 + 标题 15 + 间距 2 + 行 11），非随意魔法数。
- 月历日格溢出项从静态「还有 N 项」改为「+N 更多」按钮，点击经 radix Popover 展示当天完整条目（时间前缀 + 标题，沿用各项配色）。日格由 `<button>` 改为 `div role="button"` 以合法嵌套交互元素；键盘 Enter/Space 仍创建事件、读屏合成 click（detail===0）语义保留，两者都以 `event.target === event.currentTarget` 屏蔽「更多」冒泡；「更多」的 pointerdown 不作为拖拽选区起点，跨天拖拽建事件不回归。

### 首页：ChatGPT 式视觉层次

闲置态自上而下重排：弹性留白把问候语压至视口上部约 1/4–1/3（text-3xl；`globals.css` 补 `--text-3xl` 字号缩放映射，随「设置›外观›字号」缩放）→ 快捷入口行（新建项目直达；近期作业仅 Canvas 已连接时出现；今天的日程——后两者沿用原建议胶囊填入 prompt 并聚焦 composer 的行为）→ hero composer（主视觉，节点与 `layout="position"` 两状态衔接动画不变）→ 提供商声明 → 「最近项目」卡片（原「继续工作」改名，卡片区容器放宽至与 composer 同宽 max-w-3xl；该区右上角的原「新建项目」按钮上移为快捷入口，空态文案保留）。会话态布局、历史/新对话按钮、吸底 composer 未动；顶部与底部弹性留白按 3:2 分摊，内容溢出时收缩为 0 正常滚动。

### 重启后默认新对话

`agent/api.ts` 的 `resolveSession`：进程内指针缺失（每次重启后的首次访问）不再回退「最近更新的会话」，直接视为新对话（指针置 null）；历史会话仍可经「历史对话」弹窗（listChats/openChat）找回。`ask` 在指针为 null 时本就新建会话，行为不变；`scripts/workspace-smoke.ts` 的断言全部发生在同进程内显式设置指针之后，不受影响。唯一残余边界：进程在 ask 落库前崩溃可能遗留 0 消息空会话出现在历史中，可手动删除。该行为作用于所有 scope（首页与项目助手一致）。

### 验证状态

已通过：Prettier、Oxlint 0 警告、三组类型检查、`pnpm build`、60 项单元测试（含 layoutDayColumns 7 项）、`pnpm smoke`、`pnpm smoke:workspace`。另以隔离 userData 的真实构建实例经 CDP 完成 12 项程序化断言（重启后 getChat 为新对话且旧会话保留在历史、周视图 28 个块无互相覆盖、月历 +2/+3 更多与弹层 6 项、数字日期输入逐段跳段、自定义下拉可打开）与截图视觉验收：judge 首轮 9 张中 8 张通过，唯一 fail（周视图并排窄列教师被截断、矮事件时间贴底裁切）已按上述方案修复并通过类型与构建；修复后的实机视觉、浅色主题截图与真实 IME 手感未做第二轮验收，待真实环境手动确认。探针环境限制：瞬态 userData 中 Chromium os_crypt 密钥往返不稳定，导致探针内「已配置模型」状态不可靠；该路径不在本次改动范围内，真实环境不受影响。

## 课表交互补强与首页信息密度调整（2026-09-14 第二轮）

两项并行（课表组、首页组，文件互不重叠），由两个 subagent 先行网络调研（FullCalendar 事件渲染源码、Radix Tooltip/Popover 官方文档、Google Calendar 事件卡排版、LibreChat/Open WebUI 模型选择器、WCAG 2.2.2 与 AnimatePresence 文档）后实现，总调度统一集成验收；用户随后实测反馈四项精修（模型面板向下展开、移除「最近项目」标题、详情弹窗去掉与右上角 X 重复的「关闭」文字、快捷入口与 composer 间距按亲密性收紧为 mt-4）已并入。

### 课表

- **悬浮提示**：周视图课程/事件块的原生 `title` 换成共享 Radix Tooltip（`TooltipTrigger asChild` 包住 article）。课程显示课程名/教师/教室/周次；事件显示名称/`formatEventRange`（跨天两端各带日期与星期）/地点。月历摘要条维持概览形态不加 tooltip（日格已有拖拽建事件与「+N 更多」Popover，再叠点击目标易冲突）。
- **删除自建事件**：`deleteEvent(id: number)` 贯通 `shared/api.ts` → `preload/index.ts` → `timetable/ipc.ts`（`checkWorkspaceSender` + zod，删除不可逆故比照 create-event 多一层来源校验，既有其他 timetable handler 无来源校验属既有不对称，未在本次扩散修改）→ `timetable/api.ts`（`z.number().int().positive()` 后仅 `DELETE FROM calendar_events WHERE id = ?`，课程表物理上不可达；id 不存在幂等无操作）。新增单元测试断言 SQL 仅命中 calendar_events、非法 id 抛错且 prepare 仅一次。
- **跨天连续条**：`eventDayEdges`（纯函数 + 测试）按事件真实起止日给出 isStart/isEnd（被周切割的延续日不算；结束恰为午夜归属前一天，与 `localEventsByDay` 一致）。参照 FullCalendar v6 `h-event.css` 的边缘模型：非首段去左圆角/非末段去右圆角；仅当该段独占整列（`layout.width === 100`，无并排冲突）时向相邻列出血压过分隔线（`-1px` / `calc(100% + 1px)`，由既有 1px 分隔线推导）无缝相接；跨周首/周末按周边缘收口；与课程并排时退回独立胶囊（几何上无法出血）。时间前缀仅首段显示，跨天首段写全「9月12日 22:00 – 9月16日 10:00」避免「22:00–10:00」式误导。
- **详情弹窗**：新增 `EventDetailDialog`（radix Dialog，Overlay/Content 沿用赞赏弹窗 tw-animate 类），排版仿 Google Calendar：`--cal-*` 色点 + 标题头部、Clock/MapPin/User/CalendarRange/GraduationCap 信息行，课程另显班级·课程号与学分。自建事件两步确认删除（删除期间 Esc/遮罩由 `!deleting` 守卫），成功后关闭并刷新事件列表；课程只读。周视图桌面块（Tooltip + 点击 + Enter/Space 键盘可达）与窄屏卡片均可打开（窄屏否则无法删除）。不做编辑功能。

### 首页

- 闲置态重排：顶部弹性留白 `grow-3`→`grow-5`（与底部 5:2，composer 视觉重心下移至约视口 2/3；受最近项目卡片占位影响实际约 60%+，弹性收缩属既有约定）；快捷入口行去掉 `justify-center`，与 composer 同宽同 padding 左对齐；入口→composer 间距 mt-4（用户精修：亲密性语义）、问候语→入口 mt-8。会话态与 `layout="position"` 衔接动画未动。
- 项目卡片副行去掉「继续 」前缀（用户确认的「继续工作」文字提示落地）；「最近项目」h2 标题移除，卡片自解释，`aria-label` 保留读屏上下文；提供商免责声明整段删除。
- **两列模型面板**：ChatComposer 的 DropdownMenu 换成 radix Popover（`side="bottom"` 向下展开，用户精修），打开时 `window.dela.llm.list()` 现读设置配置；左列 Provider（active 者绿点 title=使用中，当前查看 bg-accent），右列该 Provider 的 models（active 且匹配当前 model 时 bg-accent + Check）。提交经 use-chat 新增的 `selectModel(provider, model)`：非 active 先 `llm.setActive(id)` 再 `llm.setModel(model)`，本地乐观更新后 `refresh()`；原 `setModel` 因唯一调用方迁移而删除。AgentPanel 同步接线，工作区助手复用不受影响。加载失败降级为空配置文案（实际仅在无 preload 时可达）。
- **快捷入口直发**：`send(directText?: string)` 以参数绕过 prompt state 异步时序；「近期作业」「今天的日程」单击即发并进入会话态；「新建项目」保持直接导航。composerRef/inputRef 随之删除。
- **英文轮播问候**：7 条英文预设（Good morning/afternoon/evening、Welcome back、Working late、Ready to continue?、What are we working on?），按时间段定初始值，`GREETING_INTERVAL_MS = 8000` 轮换，`AnimatePresence mode="wait"` 纯 opacity 0.3s（sync 叠放会双行重叠故弃用），`useReducedMotion()` 时定时器不启动。WCAG 2.2.2 严格暂停控件未做，属装饰性内容取舍，已记录。

### 验证状态

已通过：Prettier、Oxlint 0 警告、三组类型检查、`pnpm build`、65 项单元测试（新增 eventDayEdges 2、formatEventRange 2、deleteCalendarEvent 校验 1）、`pnpm smoke`。隔离探针（临时隔离 userData + CDP）确认闲置态布局、按钮左对齐与无免责声明；问候语轮播、两列模型面板（真实配置下向下展开）与课程详情弹窗（真实同步课程数据）已由用户真实环境实测确认；跨天连续条与删除流程由单元测试、代码评审与构建覆盖，实机观感待日常使用确认。探针中隔离实例因已知 os_crypt 限制无法进入「已配置」态、断连课表显示连接引导卡，均为环境边界而非应用缺陷；相关已知限制与探针前置检查已沉淀为用户级 skill（`~/.agents/skills/probe-preflight`），后续探针须先过其六项门禁。

这表明 Dela 可采用官方 Discourse User API Key 协议让用户授权水源读取权限，不依赖 OpenClaw 安装、配置或应用展示名白名单。已验证的是一个账号的 `read` scope 完整流程；全量账户覆盖、长期站点策略、其他 scopes 与 Dela 内的凭据保存/UI 尚未实现或验证。完整证据与请求差异见 `docs/shuiyuan-api-findings.md`。

## 资料导航、多标签与 PDF.js 资源控制（2026-09-14）

本节取代此前“未标注学期保留在主目录”、资料页隐藏标签栏及 PDF 页码恢复待实现的约定。采用现有 ProjectView 标签、持久视图与 Explorer 行内菜单，不新增阅读器管理层。课程资料、我的资料、归档统一为可折叠分区；Canvas 菜单明确区分课程列表同步、课程行菜单中的资料同步和令牌更换，文件菜单承载打开、加入项目与下载，文档低频操作合并到右上角菜单。交互参考 Notion 官方侧栏说明：https://www.notion.com/help/navigate-with-the-sidebar 。

PDF 使用精确版本 pdfjs-dist 6.3.289（构建依赖；renderer 动态加载，Worker、CMaps、标准字体、WASM 随明确产物发布）。SourceDetail 的 PDF iframe 替换为 PdfReader，HTML iframe 不变。CSP 允许 dela-resource fetch 与 WASM 编译，不开放普通 unsafe-eval；协议 CORS 仅返回开发源或 file 页的 null 源。

### 官方阅读组件取代自制渲染器

此前自制等高槽位、按挂载页数均分预算和 effect 中清除画布造成滚动/缩放闪烁。最终直接采用安装包中的 PDFViewer，删除自制 PdfPage、窗口范围计算、画布双缓冲、DPR 分配与缩放锚点算法。依据 Mozilla 官方 examples/components/simpleviewer.mjs 集成，由 PDFRenderingQueue 优先处理可见页、再处理滚动方向邻页；PDFPageViewBuffer 基线 10 页，容量按 max(10, 2×可见页数+1) 调整并保护可见页。保留轻量页面容器，LRU 淘汰画布与页资源，不渲染全书。

缩放采用官方 updateScale，drawingDelay 使用官方 app_options 默认 400ms：先保留并 CSS 缩放已有画面，再重绘。触摸板 ctrl+wheel 的像素模式转换依据官方 app.js 的指数公式；嵌入 Dela 时把 client 坐标转为 PDFViewer 使用的 offset-parent 坐标。缩放比例与上下限由官方组件负责，工具栏显示实际比例；适合宽度在窗口改变时重算。保存实际页面的页码与页内相对偏移到现有 scroll 字段，不在 React 卸载后读取已脱离 DOM 的尺寸。使用 abortSignal 解除官方滚动监听及 ResizeObserver，setDocument(null) 释放阅读器资源，destroy 加载任务终止 Worker。

单页 maxCanvasPixels=4×1024²（16 MiB RGBA），关闭额外 detail canvas，输出 DPR 由官方上限计算，不再固定为 2。保留官方基于视口面积的画布限制。10 页全部触及上限时基础画布约 160 MiB，缓存扩容及缩放替换还可增加；没有固定 48/96 MiB 全窗预算，也不宣称进程内存上限。后台标签无驻留 PDF 实例，并排各自占用资源。文字层支持选择引用，注释层、自动链接、脚本及批注编辑不启用。

源码依据：https://github.com/mozilla/pdf.js/blob/master/web/pdf_viewer.js 、https://github.com/mozilla/pdf.js/blob/master/web/pdf_rendering_queue.js 、https://github.com/mozilla/pdf.js/blob/master/web/pdf_page_view.js 、https://github.com/mozilla/pdf.js/blob/master/web/app_options.js 。同时核对安装包 6.3.289 的实际导出与行为。

### 分段读取与缓存路径

PDF.js 网络流只对 http(s) 自动使用 Range，自定义协议通过 PDFDataRangeTransport + fetch 显式请求 64 KiB 首段及所需区间，主进程沿用限定 source/entry ID 的磁盘流。disableAutoFetch、disableStream 均开启，切换/关闭文档取消请求并销毁任务；不把整份 PDF 字节放入 Zustand。远端课件首开仍先下载到磁盘。未见页尺寸由官方延迟初始化，混合横竖页加载后使用真实比例。

修复缓存路径问题：每次 Range 请求曾调用 availablePath，把已存在缓存误判为同名冲突并重命名，造成并发请求 stat 旧路径时 ENOENT。目标目录内的缓存直接复用原路径，仅真正迁移目录时选择新路径；保留已有带序号文件。协议 await 文件响应使异步异常进入受控响应。只显示首次读取失败，取消其他分段不会将原错误覆盖为 AbortError。

### 验证范围

scripts/pdf-smoke.cjs 使用隔离 Electron、生产 renderer、300 页含 2048×2048 图像及 JPEG2000 的合成 PDF。覆盖归档折叠、多标签/快速切换、位置恢复、分段失败重试、画布保留及替换过程中可见性、触摸板合成事件、DPR 上限和不同窗口尺寸。通过 MutationObserver 与定时采样检查可见画布，避免隐藏窗口 requestAnimationFrame 不运行造成零次采样的假通过。workspace smoke 覆盖 24 次并发分段请求保持缓存路径。真实课件长期内存、触摸板硬件手感和其他平台尚未验收。

### 2026-09-15 Agent 对话时间线与流式渲染

首页和项目助手共用的 ChatThread 改为按公开说明、相邻动作组、后续说明、最终回答的实际顺序展示；动作摘要可展开时间线和输入/输出，失败单独标识，邮件检查入口不随动作组折叠隐藏。移除尾部光标，采用精确依赖 Streamdown 2.6.0 处理未完成 Markdown、分块缓存与新增字符淡入，减少动态效果偏好下禁用动画。未接入新的 Agent runtime；模型与工具执行仍在 main，经现有 preload API 推送。

修复主进程每轮文字覆盖前一轮说明及工具开始时读取旧快照造成的回退；parts 与执行起止时间保存在现有会话 JSON，content 汇总公开文本供复制、笔记和后续上下文使用。中断保留已输出内容和已完成操作。旧会话缺少事件顺序，继续显示原有工具组和正文，不重构不存在的历史。

滚动参考 assistant-ui 的顶部回合锚定：回答向下生长，预留空间随正文增长消耗，结束不突然删除；主动点击回到底部后跟随新内容，手动滚动退出跟随。高度来自实际布局，一行字号作为底部容差，未新增固定像素阈值。动作组使用现有 Tailwind 间距/高度档位与默认过渡；文字动画使用 Streamdown 默认 150ms 淡入与 320ms 积压上限，不新增自定义计时常数。

参考：[assistant-ui Thread](https://www.assistant-ui.com/docs/primitives/thread)、[相邻 Parts 分组](https://www.assistant-ui.com/docs/guides/part-grouping)、[Streamdown 集成](https://www.assistant-ui.com/docs/guides/streamdown)、[AI SDK UI](https://ai-sdk.dev/docs/ai-sdk-ui/overview)。取舍：Dela 已有本地会话与工具循环，本次复用流式展示库及消息分段思想，没有引入整套 Web transport 或替换 Electron 进程边界。

验证入口：构建后执行 `pnpm exec electron scripts/chat-smoke.cjs`，使用隔离 userData 和脱敏推送检查消息顺序、未闭合加粗、工具失败与详情、滚动稳定性、跟随/退出跟随、旧会话切换，覆盖 600/900/1200 宽度及明暗主题。主进程 api.test.ts 验证分段持久化与中断保留。真实提供商流速、硬件触摸板与其他平台尚未验收。

本次验证结果：相关类型与格式检查、Oxlint、Agent loop/API 共 8 项单元测试、生产构建、隔离聊天 UI 回归、Windows 目录打包与打包后启动（退出码 0）通过。普通及打包启动冒烟均报告本机已保存凭据的 safeStorage 解密错误；基础 SQLite/renderer/preload 冒烟通过不代表真实模型连接可用。未修改凭据或将该错误计为已修复。
