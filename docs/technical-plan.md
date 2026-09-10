# Dela 桌面应用技术规划书

日期：2026-09-09
状态：开发基线；工程已初始化，前端骨架完成。邮箱已实现真实 IMAP 同步与阅读（2026-09-10，见文末记录）；Canvas、模型调用与 Agent 闭环尚未实现。工程验证记录见文末。

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
| Markdown 展示 | react-markdown              | 10.1.0   | 文档和对话渲染                    |
| GFM           | remark-gfm                  | 4.0.1    | 表格、任务清单等                  |
| 代码高亮      | highlight.js                | 11.12.0  | Markdown 代码块展示               |
| 邮箱读取      | imapflow                    | 2.0.0    | IMAP 同步与查询                   |
| 邮件发送      | nodemailer                  | 10.0.1   | 实现发送功能时再安装              |
| 安装包        | electron-builder            | 26.15.3  | 打包和分发产物                    |
| 逻辑测试      | vitest                      | 5.0.0    | 状态、同步和工具执行测试          |

HTTP 和模型请求使用运行时 `fetch`；凭据保护使用 Electron `safeStorage`；文件操作使用 Node.js API。不额外引入 HTTP 服务端、ORM、Agent 框架或客户端请求框架。

类型声明、CodeMirror 的其他必需模块、格式化工具等辅助依赖，在首次安装时核对版本并固定到 `package.json` 和锁文件，不在这里凭空指定。PDF、Office 解析库需要用真实课件验证后再选；其选型不得阻塞基础项目、文本编辑和 Canvas 元数据功能。

`clsx`、`framer-motion` 和 `highlight.js` 已随 2026-09-10 的前端重构安装并使用：clsx 组合 CSS Modules 的状态与变体；framer-motion 仅用于视图切换的少量过渡（`MotionConfig` 跟随系统减少动态效果设置）；highlight.js 只负责示例代码展示，不执行代码。继续使用 Prettier 作为格式化工具，不引入 Biome。自动更新等到存在正式发布渠道、签名和更新服务后再选择并引入 `electron-updater`。

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

`package.json` 是已安装版本的执行依据，`pnpm-lock.yaml` 锁定传递依赖；本文件记录选择理由和固定基线。初始化设置 `packageManager`，记录开发 Node.js 版本。

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
|   |   |-- ipc.ts                    # 注册明确的应用操作
|   |   |-- database.ts               # 数据库初始化与迁移
|   |   |-- projects.ts               # 项目、来源和资料关联
|   |   |-- files.ts                  # 文件读取、保存、外部打开
|   |   |-- credentials.ts            # 凭据保护
|   |   |-- agent/
|   |   |   |-- run.ts                # 执行循环与状态
|   |   |   |-- model.ts              # 模型请求与流式响应
|   |   |   |-- context.ts            # 项目上下文选择
|   |   |   `-- tools.ts              # 首批工具定义与执行
|   |   `-- integrations/
|   |       |-- canvas.ts
|   |       `-- mail.ts
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

Project 是用户主动建立的事务空间，可以对应课程、Lab、科研或申请。它包含目标与背景、来源关联、对话、任务和成果。Project 不等于 Git 仓库，不要求每个项目拥有本地代码目录。

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

默认采用单视图切换，空间足够时可分屏。Agent 修改已有内容时提供修改预览和应用入口；打开专业软件不代表能读取其中未保存的内容或终端状态。

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

- 模型通过 `model.ts` 访问致远一号；API Key 不进入 renderer 或模型消息。
- 候选调用名沿用 background.md：`deepseek-chat`、`deepseek-reasoner`、`qwen`、`minimax`。实际工具调用、流式、中断与上下文限制需要逐个实测；不把名称当作能力保证。
- 上下文包括项目背景、当前请求、用户选中的资料和必要检索片段，不默认发送全部历史和全部文件。
- 邮件、课件、网页是资料，其中的指令不能扩大工具权限。
- 保存执行步骤和结果，支持取消、超时、步数限制以及错误显示。
- 首版状态：`queued`、`running`、`waiting_input`、`completed`、`failed`、`cancelled`、`interrupted`。
- 重启后把遗留的运行任务标为中断；用户继续时读取已有步骤，不能盲目重放已经产生外部副作用的工具。
- 已授权的读取与项目内新建成果可以直接执行；覆盖已有文件提供修改预览。发邮件、提交作业等外部写入展示具体目标和内容，由用户执行前确认。
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
