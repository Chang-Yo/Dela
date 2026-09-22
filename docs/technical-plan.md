# Dela 桌面应用技术规划书

日期：2026-09-09 制定；2026-09-18 修订（开发记录移至 [devlog.md](devlog.md)）。
状态：本文描述产品定位、技术基线、进程边界与架构契约，是开发的首要依据。功能演进、设计裁决与验证边界的时间线见[开发记录](devlog.md)；用户最新明确决定优先于本文。

2026-09-20 编辑器方向调整：目标改为以 Markdown 为持久化正文的所见即所得笔记编辑器，代码文件以只读预览和外部 VS Code 打开为主。具体目标、边界、依赖清理与实施阶段见根目录 [plan.md](../plan.md)。该计划已于 2026-09-20 实施完成（内核选型、笔记闭环、代码文件入口与集成检查，过程与验证边界见[开发记录](devlog.md)）；此前 `.dela` / Notion 式编辑器的探索不再作为后续产品目标。经核查本机无受应用管理的 `.dela` 数据，未开发迁移。

## 1. 产品定位与范围

Dela 是一个以 Project 为中心，连接交大校园信息和本地文件，提供轻量编辑与 Agent 协作的桌面工作台。

用户在这里整理资料、建立计划、保存成果，并在多次对话之间持续推进同一件事。课程、邮箱等聚合功能提供事实和操作入口；Agent 根据当前项目的上下文帮助用户工作。

已确定的方向：

- 本地单用户应用，不建设账号服务器和多租户系统。
- 使用 Electron，保持跨平台实现，首先在 Windows 完成验收。跨平台能力不等于已经验证各平台安装包。
- 优先完成主动打开使用的桌面工作台。移动端不纳入当前规划，也不为其提前抽象。
- 支持 Markdown 所见即所得笔记编辑（阅读态/源码模式可切），持久化正文始终是纯 Markdown；代码文件提供只读预览与外部 VS Code 打开，代码开发、运行调试与复杂文档编辑交给专业软件。
- 校园资料按需关联进项目；不把每封邮件、每门课程自动创建成项目。
- 使用个人可取得的接口、标准协议和本人登录会话。以无法取得 jAccount client_id 为固定前提，不将申请官方应用凭据写入路线图。

首版不包含：云同步、通用插件市场、多 Agent 协作、手机端、无人值守后台自治、通用终端执行、完整 IDE 和 Office 编辑器。

以上首版排除项属于本规划的范围约束；后续如需调整，应先更新本文件。

## 2. 技术栈与版本

### 2.1 固定基线

下表版本来自本次讨论期间对官方文档和 npm 元数据的核对。版本存在和声明范围兼容，不代表整个组合已通过运行验证。初始化时使用精确版本，不使用 `latest`、`^`、`~` 作为直接依赖约束；提交锁文件。

| 层面          | 选型                          | 固定版本              | 职责                                                               |
| ------------- | ----------------------------- | --------------------- | ------------------------------------------------------------------ |
| 桌面运行时    | Electron                      | 44.3.0                | 窗口、Session、系统能力                                            |
| 开发运行时    | Node.js                       | 24.21.0               | 安装、开发与构建                                                   |
| 包管理        | pnpm                          | 12.3.4                | 单包依赖管理                                                       |
| 语言          | TypeScript                    | 7.0.2                 | 类型检查、共享契约                                                 |
| 构建          | Vite                          | 8.2.2                 | main/preload/renderer 构建                                         |
| React 插件    | @vitejs/plugin-react          | 6.1.1                 | JSX 转换与开发刷新                                                 |
| 界面          | react / react-dom             | 19.2.8                | 工作台 UI                                                          |
| 基础交互      | radix-ui                      | 1.6.7                 | 菜单、对话框、提示等                                               |
| 样式          | CSS Modules + CSS Variables   | 无独立包              | 组件样式、主题变量                                                 |
| 类名组合      | clsx                          | 2.1.1                 | 组合 CSS Modules 状态与变体                                        |
| 界面过渡      | framer-motion                 | 13.2.0                | 面板、抽屉与页面切换动画                                           |
| 界面状态      | zustand                       | 5.0.15                | 面板、标签页、当前选择                                             |
| 参数校验      | zod                           | 4.5.4                 | IPC、工具参数与必要的外部数据校验                                  |
| 数据库驱动    | better-sqlite3                | 13.0.3                | 本地 SQLite 访问                                                   |
| Markdown 编辑 | @codemirror/view              | 6.43.11               | 编辑器视图                                                         |
| Markdown 语言 | @codemirror/lang-markdown     | 6.5.2                 | Markdown 编辑支持                                                  |
| 编辑器内核    | @codemirror/state             | 6.7.4                 | 编辑器状态与事务                                                   |
| 编辑器语言    | @codemirror/language          | 6.12.4                | 高亮系统（HighlightStyle）                                         |
| 编辑器命令    | @codemirror/commands          | 6.11.0                | 撤销/重做与默认键位                                                |
| 编辑器搜索    | @codemirror/search            | 6.7.2                 | 源码模式与代码文件预览的查找面板                                   |
| 代码块语言    | @codemirror/language-data     | 6.5.2                 | 围栏代码块语言按需加载                                             |
| 高亮标签      | @lezer/highlight              | 1.2.3                 | 语法标签定义                                                       |
| 所见即所得    | @milkdown/crepe               | 7.22.1                | 笔记富文本内核（ProseMirror+remark，经 @milkdown/kit 7.22.1 组装） |
| Markdown 展示 | react-markdown                | 10.1.0                | 来源详情与回复预览渲染                                             |
| 对话 Markdown | streamdown                    | 2.6.0                 | 聊天流式渲染与代码块控件                                           |
| 对话渲染插件  | @streamdown/code/math/mermaid | 1.1.1 / 1.0.2 / 1.0.2 | shiki 双主题高亮、KaTeX 公式、mermaid 图表（懒加载）               |
| 数学公式      | katex                         | 0.16.47               | LaTeX 排版内核与字体                                               |
| GFM           | remark-gfm                    | 4.0.1                 | 表格、任务清单等                                                   |
| emoji 映射    | gemoji                        | 8.1.0                 | 水源标题 Discourse 短代码 → Unicode emoji（纯数据表）              |
| 代码高亮      | highlight.js                  | 11.12.0               | Markdown 代码块展示                                                |
| 邮箱读取      | imapflow                      | 2.0.0                 | IMAP 同步与查询                                                    |
| 邮件发送      | nodemailer                    | 10.0.1                | SMTP 发送与 MIME 构建                                              |
| 安装包        | electron-builder              | 26.15.3               | 打包和分发产物                                                     |
| 逻辑测试      | vitest                        | 5.0.0                 | 状态、同步和工具执行测试                                           |
| 编辑器单测    | jsdom                         | 30.1.0                | Crepe 往返保真测试的 DOM 环境（devDependency）                     |

HTTP 和模型请求使用运行时 `fetch`；凭据保护使用 Electron `safeStorage`；文件操作使用 Node.js API。不额外引入 HTTP 服务端、ORM、Agent 框架或客户端请求框架。

CodeMirror 的其他必需模块已于 2026-09-12 随 Markdown 编辑器落地核对并固定到 `package.json` 和锁文件（见上表）。PDF、Office 解析库需要用真实课件验证后再选；其选型不得阻塞基础项目、文本编辑和 Canvas 元数据功能。

编辑器同步约束：本地 onChange 回传不作为外部正文替换；IME 组词期间保护内核持有的输入，选词结束后保留本地最新结果，不能重放旧拼音快照。2026-09-21 已加入富文本与源码模式回归测试，用户已确认修复有效（覆盖边界见开发记录）。

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

`package.json` 是已安装版本的执行依据，`pnpm-lock.yaml` 锁定传递依赖；本文件记录选择理由和固定基线。初始化设置 `packageManager`，记录开发 Node.js 版本。

CI 检查矩阵、升版命令、tag 发布与公开镜像的操作流程见[发布指南](release.md)，本文不重复维护操作细节。

应用升版通过 `version:patch`、`version:minor`、`version:major` 或 `version:bump <版本/递增类型>` 调用 npm 内置 SemVer 命令，仅修改包版本，不自动提交、打 tag 或发布。preload 构建时内联 `package.json` 的 version，冒烟检查与 `app.getVersion()` 比较。单包 pnpm 锁文件不保存根应用版本，升版不需要更新依赖锁文件。

初始化验收未通过时记录具体冲突，再局部修改选型与本表，不静默降级。升级必须独立检查类型、构建、核心测试和安装包启动。原生依赖安装脚本仅允许明确需要的包，不全局放开。

## 3. 仓库组织

采用单仓库、单 `package.json`。不引入 Turborepo/Nx，不拆分内部 package。pnpm 12 使用 `pnpm-workspace.yaml` 保存项目设置，仅包含根包，不配置子包；这不改变单应用组织方式。三个进程分别构建，不意味着三个独立产品。

```text
Dela/
|-- README.md                         # 项目展示入口
|-- AGENTS.md                         # 编码约束（CLAUDE.md 指向它）
|-- knowledge/
|   `-- SJTU_API_References.md        # 公开参考索引
|-- assets/                           # 品牌图；credits/<id>/ 保存关于页人物素材（头像/收款码），字体等随应用分发
|-- docs/                             # 背景约束、技术规划、开发/发布指南、开发记录与专题审查
|-- src/
|   |-- main/
|   |   |-- index.ts                  # 生命周期、主窗口、协议注册
|   |   |-- ipc.ts                    # 共用 IPC 来源校验
|   |   |-- database.ts               # 数据库初始化与迁移
|   |   |-- credentials.ts            # 凭据保护（邮箱/Canvas/LLM/水源/校园会话）
|   |   |-- storage.ts                # 共用存储路径规则
|   |   |-- resources.ts              # 跨业务文件流转
|   |   |-- resource-parse.ts         # PDF/DOCX/PPTX 文本提取
|   |   |-- search.ts                 # 全局搜索
|   |   |-- notifications.ts          # 通知中心
|   |   |-- mail/                     # 邮箱业务（api.ts / ipc.ts / send.ts / drafts.ts 等）
|   |   |-- canvas/                   # Canvas 课程资料（api.ts / ipc.ts）
|   |   |-- timetable/                # 课表与日程（api.ts / ipc.ts / session.ts）
|   |   |-- workspace/                # 工作区条目、笔记与预览协议
|   |   |-- shuiyuan/                 # 水源社区（api.ts / ipc.ts / 媒体代理）
|   |   `-- agent/                    # 聊天会话、模型循环与工具（api / ipc / loop / tools / providers）
|   |-- preload/
|   |   `-- index.ts                  # contextBridge
|   |-- renderer/
|   |   |-- index.html
|   |   |-- main.tsx                  # 仅挂载 React
|   |   |-- App.tsx                   # 应用外壳与页面入口
|   |   |-- styles/                   # 设计 token、主题与窗口级全局规则
|   |   |-- components/               # 跨功能共享 UI；样式就近放置
|   |   `-- features/                 # home / projects / sources / mail / timetable /
|   |                                 # shuiyuan / chat / search / notifications /
|   |                                 # onboarding / settings
|   `-- shared/
|       |-- api.ts                    # IPC 类型和参数约定
|       |-- llm-presets.ts            # 模型提供商预设
|       `-- schedule.ts 等            # 进程间共享的纯函数
|-- scripts/                          # 开发服务器与冒烟脚本
|-- vite.main.config.ts 等三个构建配置
|-- electron-builder.yml
|-- tsconfig*.json / package.json / pnpm-lock.yaml
`-- pnpm-workspace.yaml               # pnpm 12 设置，无子包
```

这是目标组织约定，不要求预先建立空目录。React 组件使用同目录的 `*.module.css`，页面样式留在对应 feature；全局样式只保存设计 token、reset 和窗口级规则。模块可用 `index.ts` 暴露少量公共入口，但不建立导出整个 renderer 的总入口。`src/main/` 各级业务目录在对应的 `test/` 子目录集中放置单元测试，例如 `agent/test/run.test.ts`；测试样例必须脱敏。

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
- 主窗口点击关闭时仅隐藏到系统托盘；退出仅由托盘右键菜单中的显式“退出”操作触发。托盘菜单可打开主窗口、新建首页对话或新建项目。
- 应用通过 Electron 单实例锁运行；重复启动快捷方式唤起已有主窗口（隐藏时显示、最小化时恢复并聚焦），不创建第二个托盘。托盘左键单击打开主窗口，右键单击显示上下文菜单。
- 校园登录放在独立窗口与专用 Session 中，不挂载 Dela 的本地能力桥梁。失效后要求重新登录，不能把失效表现为无数据。
- 首版异步网络与小规模任务可由 main 调度。文档解析、索引等重计算在实际引入时放入 Worker/独立进程，避免阻塞窗口与应用生命周期。

## 5. 项目、文件与持久化

工作区页头采用标签行与面包屑操作行；文件默认打开为保留标签，路径单行截断显示。编辑组维持单栏、左右双栏、上下双栏三种布局，合并不关闭文档；桌面助手展开与收起共用标签栏同一按钮，右栏复用左栏宽度过渡；窄屏覆盖模式在面板左上角提供关闭入口。

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

首启引导仅在首次创建用户数据时显示：main 在初始化前检查 `userData/dela.db` 是否存在，通过 preload 传递首次启动标记。开发与正式构建规则一致；已有数据库的升级、重启（含未完成向导）直接进入主界面。renderer 在播放前记录 started，避免首次运行期间刷新重播，并兼容旧版完成、开屏与步骤标记。保留用户数据的重装不重播，清空用户数据后视为首次启动。

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

### TODO 与作业状态

- 侧栏入口位于「水源(beta)」下方，标签 TODO，图标 CircleCheckBig。统一列表展示 Canvas 作业和本地个人待办，支持来源筛选、显示已完成、详情与个人待办增删改/完成/重开。
- 新建待办是 workspace 底部滑出的面板：标题、备注、五列步进式截止时间（^/v 调整，默认创建时刻）、日历候选色与「写入日历」开关；编辑沿用同一组控件。开启写入日历的待办在课表周/月视图按截止时刻渲染为 30 分钟色块（止于截止时刻，颜色随待办），点击可跳转 TODO，日历侧不可删除。派生只发生在渲染层（事件 id 为 `todo:` 前缀），不写 calendar_events，LLM 的日程查询因此不重复计入待办。
- Canvas 作业只读；按 submission 返回区分未完成、已提交、已批改、豁免、需重交、线下和未知。成绩本身不作为已提交证据；本地已读不等于完成，完成也不自动标记已读。
- 启动和连接后同步在读且未归档课程的作业，运行期间每 15 分钟轮询；只拉取作业与 submission，不下载课程文件。失败保留缓存及每条成功同步时间，展示同步错误。
- 首次成功同步每门课程建立基线，不生成历史通知；后续新增作业生成一条通知，轮询和未完成状态不重复提醒。暂不提供截止倒计时推送或个人 TODO 定时提醒。完全退出后不轮询。
- SQLite todo_items 保存个人待办与作业缓存，read_at 和状态分开；Canvas 缓存按令牌摘要隔离，更换令牌重新建立基线，断开连接隐藏该连接的作业。
- 全局搜索纳入 TODO，搜索和通知跳转同一详情。LLM 使用 query_todos、save_todo、refresh_todos 与扩展后的 query_assignments；不提供作业提交入口或工具。

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

- 模型请求经 `src/main/agent/loop.ts` 发往设置 › 模型服务中配置的 OpenAI 兼容提供商；API Key 不进入 renderer 或模型消息。
- 可用模型以提供商「检测连接」返回的模型列表为准；工具调用、流式、中断与上下文限制需逐个实测，不把模型名当作能力保证。
- 上下文包括项目背景、当前请求、用户选中的资料和必要检索片段，不默认发送全部历史和全部文件。
- 邮件、课件、网页是资料，其中的指令不能扩大工具权限。
- 保存执行步骤和结果，支持取消、超时、步数限制以及错误显示。
- 会话 JSON 保存消息 parts（正文、思考与工具步骤的交错顺序）和逐项工具结果；完整任务状态机暂缓。
- 重启后不自动恢复执行；用户提供后续背景。已有工具结果保留，但当前后续模型请求只取最近 12 条对话的角色与正文，不自动重放历史工具结果。
- 当前写入工具直接执行用户请求，笔记沿用 revision 校验，尚无修改差异预览；邮件工具只准备草稿，由用户在编辑器点击发送。不提供提交作业工具。
- 首版不开放任意 shell。未来增加命令执行时单独设计目录范围、进程管理和结果记录。
- 本地存储不等于本地推理：发送给模型服务商的上下文会离开本机。界面应能让用户了解所选资料范围。

## 8. 接口、同步与检索原则

优先次序：Canvas 和邮箱等个人可用协议，其次是已验证的个人网页会话接口。网页自动化仅在具体需求无法由接口满足时使用，不作为全站通用默认方案。

- 数据保留来源 ID、原文链接、来源更新时间（如有）和抓取时间。
- 同步处理分页、增量、重复数据、限流和登录失效；重试有上限。
- DDL 优先使用系统明确返回且适用于当前用户的时间；邮件推断与系统记录冲突时并列显示，不擅自覆盖。
- 同一事项跨平台关联不完全依赖标题相似度；不确定关联由用户修正。
- 通知中心聚合邮件、水源与 TODO。邮件通知的已读派生自邮件本身的 seen 状态：通知面板标记已读即在邮件服务器标记 `\Seen`（他端读信经同步后通知红点随之清除），读信、删除与同步完成都会即时重播通知状态。系统桌面通知仅提示标题、点击直达对应内容；启动首轮刷新为基线不弹，主窗口聚焦或暂停通知期间不弹。
- 首版按项目、来源和文件名定位资料，辅以文本检索。SQLite 全文搜索作为后续按需能力，中文检索质量实测后决定；不预先部署向量数据库。
- 模型、网络或某个来源不可用时，仍可浏览本地已有项目和成果，并显示新鲜度。

## 9. 工程与交付约束

- 只引入当前功能实际需要的依赖，新增抽象必须由真实重复或多个调用方支撑。
- 重要业务变化同步更新 [开发记录](devlog.md)与本规划；面向使用者的变化更新 README。保留事实、推断与待验证项的区别。
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
2. 各提供商模型的工具调用、流式事件、思考字段、错误格式、网络条件和当前限额。
3. 本人 Canvas 数据覆盖、邮箱凭据使用方式、jAccount 登录会话的恢复流程。
4. 真实 PDF/PPTX 的文字、公式、图片和表格提取质量；不要预先承诺完整理解。
5. macOS/Linux 安装、凭据保护、外部打开及签名等平台行为，在对应平台验收前不宣称支持完成。

## 12. 参考与约束优先级

用户后续明确决定优先于本规划；本规划优先于参考索引中的路线建议。[背景](background.md)中无法取得 client_id 的约束优先于索引中“以后申请接入”的旧建议。

- [背景与已知条件](background.md)
- [开发指南](development.md) / [发布指南](release.md) / [开发记录](devlog.md)
- [校园服务资料索引](../knowledge/SJTU_API_References.md)
- [Electron 发布记录](https://releases.electronjs.org/release?channel=stable)
- [Electron 安全与进程边界](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Vite 8 发布说明](https://vite.dev/blog/announcing-vite8)
- [Vite JavaScript API](https://vite.dev/guide/api-javascript)
- [TypeScript 7 发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [pnpm 12.3.4 元数据](https://registry.npmjs.org/pnpm/12.3.4)
- [electron-vite 5 兼容范围](https://registry.npmjs.org/electron-vite/5.0.0)

## 附录：Agent 架构与工具契约

单应用、单 package，不引入 HTTP 服务、MCP 服务或 Agent 框架依赖。调用结构：

```text
页面 → preload / IPC → agent/api.ts（会话保存、取消、状态推送）
    → agent/loop.ts（模型请求、SSE 解析、工具循环）
    → agent/tools.ts（工具描述、zod 校验、领域调用）→ 各业务域 api.ts
```

| 文件                               | 职责                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| `src/main/agent/api.ts` / `ipc.ts` | 聊天保存、运行取消、状态推送（兼容 workspace 通道名）    |
| `src/main/agent/loop.ts`           | 模型请求、SSE/JSON 解析、工具循环及执行边界              |
| `src/main/agent/tools.ts`          | 工具描述、输入校验与执行结果                             |
| `src/main/agent/providers.ts`      | 提供商列表/保存/删除/启用/检测（密钥只在主进程）         |
| `src/main/agent/web-search.ts`     | `web_search` 与 `fetch_page` 联网工具                    |
| `src/main/resource-parse.ts`       | PDF 文本提取与整页渲染（JPEG）、DOCX/PPTX 文本提取       |
| `src/shared/resources.ts`          | 严格校验 workspace/canvas/mail/attachment/shuiyuan 引用  |
| `src/renderer/features/chat/`      | 首页与项目助手共用的对话核心（线程、composer、会话管理） |

资源引用使用对象，如 `{ type: 'workspace', id }`、`{ type: 'canvas', id: 'file:123' }`、`{ type: 'mail', id }`、`{ type: 'attachment', messageId, part }`、`{ type: 'shuiyuan-topic', id }`。引用不是磁盘路径或下载 URL，解析时验证资源仍存在；邮件缓存 ID 不承诺永久有效。

### 工具契约

统一执行结果为 `{ ok: true, result }` 或 `{ ok: false, error: { code, message } }`；错误码 UNKNOWN_TOOL、INVALID_INPUT、OPERATION_FAILED、INVALID_JSON。

| 工具                            | 主要输入                          | 主要结果与范围                                                                                                           |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `find_courses`                  | query、分页                       | 缓存课程 ID、名称、同步时间/错误                                                                                         |
| `sync_sources`                  | 可选 courseId                     | 同步课程列表或指定课程资料                                                                                               |
| `search_sources`                | query、courseId、kind、分页       | 缓存标题搜索                                                                                                             |
| `search_workspace`              | query、parentId、分页             | 工作区条目名称搜索                                                                                                       |
| `web_search`                    | query、region、count              | DuckDuckGo lite 结果；限流明确报错                                                                                       |
| `fetch_page`                    | url                               | 网页转文本；PDF 直链提取文字；仅公网 http(s)                                                                             |
| `search_mail`                   | query、from、folderId、时间、分页 | 主题/摘要缓存搜索；UID 窗口与同步信息                                                                                    |
| `read_resource`                 | ref、offset、limit、pages         | 正文分页；PDF/DOCX/PPTX 提取文字层；PDF `pages`（每次 ≤6 页）整页渲染为图像以合成 user 消息附给视觉模型，单次运行 ≤12 张 |
| `query_assignments`             | courseId、截止时间范围、分页      | TODO 缓存作业、截止时间、提交状态及同步新鲜度                                                                            |
| `query_schedule`                | semester、startAt、endAt          | 课程和个人事件（上海时区），缺失数据有警告                                                                               |
| `create_event`                  | title、startAt、endAt、location   | 个人事件；不修改课程                                                                                                     |
| `create_entry` / `update_entry` | parentId、kind、name 等           | 新建/重命名/移动条目                                                                                                     |
| `write_note`                    | id、text、revision                | 保存笔记版本；冲突返回错误                                                                                               |
| `link_source`                   | parentId、sourceId、name          | 保留来源的项目资料关联                                                                                                   |
| `copy_file_to_project`          | source、parentId                  | 项目/Canvas/附件文件的独立导入副本                                                                                       |
| `prepare_email`                 | to、subject、text、attachments    | 邮件草稿；只备稿不发送                                                                                                   |

### 执行与上下文

- 上下文 = 用户请求（支持图文混排 parts，图片为 base64 data URL，仅当轮生效）+ @ 引用正文 + 最近 12 条对话角色/正文 + 本轮工具结果（PDF 页图像经 `role:'tool'` 无法承载，剥离 base64 后以合成 user 图片消息附后，持久化只留页码元数据）；不默认发送全部历史和全部文件。
- 每轮模型请求独立 120s 超时；429/5xx/网络错误按 1s/3s 退避重试（4xx 与已产出内容后不重试）；最多 12 轮，末轮注入“总结收尾”提示；单条工具结果回灌前截断至 20000 字符；单次回复输出上限 32768 tokens，提供商以 400 拒绝该上限时自动退回 8192 重试。
- 思考内容（`reasoning_content`/`reasoning`）仅展示、不回灌模型；用户停止标记 `stopped` 并正常返回，保留已生成内容；已执行的业务操作不回滚。
- 边界：邮箱缓存仅每文件夹近期 300 UID 窗口；作业提交状态以 TODO 同步缓存为准，缺失时明确未知；缺失周次或学期日期时不猜测日期；邮件、课件、网页是指令不可执行的资料；不提供提交作业工具，不开放任意 shell。
- 本地存储不等于本地推理：发送给模型服务商的上下文会离开本机，界面让用户了解所选资料范围。

实现细节的历史沿革与验证边界见[开发记录](devlog.md)。
