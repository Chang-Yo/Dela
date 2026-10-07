# Dela 桌面应用技术规划书

日期：2026-09-09 制定；2026-09-18 修订（开发记录移至 [devlog.md](devlog.md)）。
状态：本文描述产品定位、技术基线、进程边界与架构契约，是开发的首要依据。功能演进、设计裁决与验证边界的时间线见[开发记录](devlog.md)；用户最新明确决定优先于本文。

2026-10-06 终端启动与鼠标交互修正：Windows PowerShell 子进程不继承中间宿主的 PSModulePath（按大小写不敏感名称过滤，仅修改子进程环境副本），由 Shell 重建默认模块目录；不更改系统环境、用户 profile 或执行策略。xterm 显式启用 Alt＋单击定位、使用竖线输入光标，拖动选取和右键复制/粘贴；工具栏及 Ctrl＋Shift＋C/V 使用浏览器剪贴板与 terminal.paste。普通单击保留选取语义。终端 smoke 不再提前删除宿主 PSModulePath，必须在原始继承环境中确认 Get-Module PSReadLine 有已加载模块、方向键/退格编辑和 Alt＋单击定位有效；剪贴板测试使用隔离夹具，不改写真实系统剪贴板。

2026-10-06 模型供应商逐模型管理（取代同日早期“不新增上下文窗口”的边界）：模型列表改为逐行编辑/删除/检测；添加入口先检测列表，支持在结果中搜索逐项加入，也保留手动输入 ID。批量导入合并已有模型，最多 64 个，超出截断并提示未导入数量，不覆盖已有模型配置。`modelConfigs` 按 ID 存上下文窗口、最大输出、思考档位与默认档位，未覆盖时兼容旧提供商级思考配置；字段仍与密钥一起加密持久化，不迁移数据库。聊天切换模型后采用该模型的档位；上下文预算、压缩触发、历史装配、运行内工具结果修剪及请求输出上限消费配置。`llm:verify-model` 复用 Pi 无工具流式请求（短提示、最多 256 输出 tokens、30 秒超时），不创建会话；与列表检测共用存储密钥的地址绑定。保留 OpenAI Chat Completions 协议，不提供未接入的能力开关、自动能力识别或任意 JSON 参数映射。

2026-10-06 项目快捷入口与编辑器裁决（修正早期未生效实现）：Crepe 创建前移除公开的 blockPlugin，不注册块手柄 DOM、悬浮添加或拖拽事件；保留独立斜杠菜单与中文配置。标题栏保留 VS Code / 资源管理器分体按钮，终端按钮通过导航脉冲打开 `terminal:{projectId}` 工作台标签。Terminal 内含多个可切换/关闭的 PTY 会话，renderer 使用 xterm + FitAddon，main 使用 node-pty（Windows 使用随包 ConPTY 与 PowerShell，其他平台使用登录 Shell，尚未实机验证）。项目当前目录由 main 按 ID 解析，不接受 renderer 路径或启动命令；会话绑定创建窗口，输入/尺寸/关闭均验证所属窗口。标签重挂载回放最多约 100 万字符输出，按事件序号去重，回放时不重发旧终端设备查询响应；尺寸、主题与字号同步。关闭最后一处同身份 Terminal 标签结束项目终端，销毁窗口或退出应用释放所有所属进程；不持久化进程、输出或会话身份。移除外部终端启动分支，workspace:open-project-directory 只保留 vscode / explorer；不扩展 Agent 执行能力。

2026-10-06 设置审阅修复：模型供应商的存储密钥仅可在其已保存 API 地址检测；更改地址后，检测与保存均要求显式填写密钥（仅末尾斜杠差异视为同一地址）。模型详情的异步保存结果不得覆盖用户后续选择及草稿。快捷键录制与单条恢复默认按完整候选键位表检查冲突，数字组展开 1…9 后参与比较。

2026-10-01 会话导航扩展（取代下方早期“本轮不实现”边界）：SQLite v14 增加 sessions.archived / pinned，升级前沿用数据库备份、事务迁移，旧消息与摘要不变。日常列表过滤归档、置顶优先排序；空会话复用不包含归档行。单条与项目批量归档均为原位红色按钮二次确认，不删除数据、不停止运行；关闭对应标签。设置工作区中统一查看、恢复和永久删除已归档对话，session:remove 拒绝删除未归档会话。会话 IPC 兼容旧 32 位十六进制 ID，附件及项目 ID 仍要求 UUID。项目置顶/分组/隐藏入口是 localStorage 导航偏好，不变更文件归属或删除磁盘目录；隐藏入口可恢复。置顶项目及会话放在“项目”节上方，日常分组不重复展示。会话行悬停提供置顶/归档及所属项目卡片；项目编辑当前支持名称，分组支持新建与切换。

2026-10-01 会话入口收敛：每个项目和通用池复用最新的空会话，首条消息发送后才创建下一个；session:create 在 main 同步查找并复用，避免快速连点产生多个身份。项目新建入口同时关闭此前重复打开的其他空会话标签（不删除数据库会话或输入草稿），已有消息及运行中的会话保留。历史列表保留最近更新排序、隐藏日期；侧栏会话操作采用“…”菜单，项目采用文件夹图标与悬停菜单/新建按钮。置顶、分组和批量归档不在本轮实现范围。

2026-10-01 凭据恢复边界：加密凭据与 SQLite schema 独立，解密失败不得通过删除数据库处理。读取失败给出重新配置提示；替换不可读旧配置前备份密文，完成加密后原子写入。模型允许新增提供商重建失效配置，不能伪造原有提供商；邮箱缺少凭据时提供重新登录入口，保留缓存账号与邮件。用户主动重置仅清除授权的凭据与登录状态，保留项目、聊天和文件。

2026-10-01 入口与布局调整：启动固定进入居中聊天首页，无项目聊天集中于“随聊”；输入框底部选择项目或从侧栏进入项目会话。保留可折叠导航层级和聊天/文档平等的标签工作台。组工具栏只常驻向右分屏，上下分屏通过拖拽；空组不显示功能键且不能继续分屏，移走/关闭最后一个标签自动收敛，恢复旧布局时合并空组。窄窗口保留用户分屏方向与可拖动分隔线。启动设置同步改为首页说明，旧恢复偏好留存但不再消费。

分屏拖拽预览参考 [VS Code editorDropTarget](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorDropTarget.ts)：正文外沿 10% 触发分屏，预览覆盖最终二等分范围；跨组中央显示整组移入预览，同组中央和单标签向自身分屏不显示无效提示。遮罩使用现有主题蓝色的 15% 不透明度，位置与尺寸过渡沿用 150ms，退出时保持落点位置淡出；不改变正文背景、不覆盖标签栏。动效与实际视觉观感由用户审阅。

本轮 Agent Core 与工作区重构须主动按职责拆分文件和目录，精简、解耦并便于独立调试；不以少建文件或将逻辑集中在现有大文件为目标。具体要求见[重构计划文首](agent-workspace-plan.md)，单应用、单 package 与避免无用途抽象的约束继续有效。

2026-10-01 工作台视觉细节：目录选中背景从当前层级图标前的内边距开始，祖先缩进不着色；选中灰色与聚焦层级线减淡，保留整行点击和键盘焦点提示。活动标签顶部增加细横条，聚焦组与非聚焦组用深浅区分。笔记及源码文档第二行左侧显示工作区面包屑，路径由装配层复用 ancestorChainOf 解析，并订阅目录变化；右侧保留内容功能键。参考 [VS Code Breadcrumbs](https://code.visualstudio.com/docs/editing/editingevolved#_breadcrumbs) 的路径位置，本轮只展示路径，不新增目录下拉菜单。

2026-10-01 编辑器细节：标签标题最小宽度 8rem，分屏面板宽度下限由 120px 提高到与目录默认宽度一致的 240px，渲染与拖动使用同一下限，空间不足时允许收缩。源码 / 代码 / 纯文本共用本窗口自动换行开关，默认关闭，Alt+Z 与视图菜单切换；CodeMirror Compartment 动态替换扩展，不重建编辑器、不改变文件换行符。非 Markdown 编辑内容靠左且取消正文最大行宽，行号区复用 muted 与 border token；图片、PDF、Word 预览靠左摆放，PDF/Word 页内原始排版保持不变。Markdown 富文本布局不受自动换行开关影响。

2026-09-29 Agent 与工作区重构（阶段一至四）已全部实施并提交：Pi Agent Core 运行时接入、Session/Run 身份模型（数据库 v13）与全领域工具重设计（阶段二）、按预算的上下文压缩、统一标签工作台与设置八分类（阶段三）、MCP 与 Skills 能力层（阶段四）。新架构与目录约定见 [Agent 与工作区重构计划](agent-workspace-plan.md) 与 [refactor/structure.md](refactor/structure.md)，各批次实施与验证边界见[开发记录](devlog.md) 2026-09-29 各轮条目。本文中仍描述重构前实现的段落（§6.1–6.3 旧三视图草图等）已就地标注为历史存档；§5 首段、§7 与附录描述当前实现。

2026-09-20 编辑器方向调整：目标改为以 Markdown 为持久化正文的所见即所得笔记编辑器，代码文件以只读预览和外部 VS Code 打开为主。具体目标、边界、依赖清理与实施阶段见根目录 [plan.md](../plan.md)。该计划已于 2026-09-20 实施完成（内核选型、笔记闭环、代码文件入口与集成检查，过程与验证边界见[开发记录](devlog.md)）；此前 `.dela` / Notion 式编辑器的探索不再作为后续产品目标。经核查本机无受应用管理的 `.dela` 数据，未开发迁移。

2026-10-06 设置结构重构（用户裁决）：分区由八类改为十三类，按基本（通用含系统通知子节、外观、快捷键）、数据（工作区、已归档、连接）、模型（模型供应商、内置能力、自定义指令、Skills、MCP Server）、关于（关于、隐私条款占位页）四组归拢（同日第二次裁决取消了「插件」分组标题，其四个分区并入「模型」；已归档对话拆为独立分区并仿参照实现按项目归类 + 搜索/筛选 + 全部删除）；「通知」分区取消并入「通用」，「模型服务」更名「模型供应商」并改为主从两栏布局（沿用现有字段，不新增 API 格式/每模型开关/上下文窗口）；设置内容宽度由 760px 增大 20% 至 912px。新增三项能力：快捷键可查看与修改（`shared/keybindings.ts` 为动作目录单一事实来源，覆盖项存 `keybindings` 键）、内置 Agent 能力可逐项与按域开关（停用项存 `tools-disabled` 键，常驻工具只读展示）、全局附加 Instruction（`agent-instruction` 键，注入位置仅次于系统设定）。详见 §6.5、[设置页接口](../src/renderer/features/settings/INTERFACES.md)与[开发记录](devlog.md)。

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
| Agent 执行    | @earendil-works/pi-agent-core | 0.87.1                | Agent 执行循环（2026-09 阶段二接入，替换自研循环）                 |
| 模型接口      | @earendil-works/pi-ai         | 0.87.1                | OpenAI 兼容流式模型接口（自定义 provider 经其装配）                |
| MCP 客户端    | @earendil-works/pi-mcp        | 0.99.0                | MCP stdio 客户端传输（2026-09 阶段四接入）                         |
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

HTTP 请求使用运行时 `fetch`（模型请求经 `@earendil-works/pi-ai` 的 OpenAI 兼容接口发出；上下文压缩的摘要请求为独立非流式 fetch）；凭据保护使用 Electron `safeStorage`；文件操作使用 Node.js API。上表 pi 三依赖是 2026-09 重构引入的 Agent 运行时，在 `vite.main.config.ts` 中以 `/^@earendil-works\//` 正则保持 external、随 node_modules 打包进 asar（rolldown 的字符串 external 不匹配 `pi-ai/api/...` 等子路径导入，必须用正则；安装脚本处理见 [开发记录](devlog.md) 第十轮）。不额外引入 HTTP 服务端、ORM 或客户端请求框架。

CodeMirror 的其他必需模块已于 2026-09-12 随 Markdown 编辑器落地核对并固定到 `package.json` 和锁文件（见上表）。文档预览选型已随 2026-09-28 的 Office 预览落地：PDF 用 pdfjs-dist（定制 viewer），DOCX 用 docx-preview、XLSX 用 SheetJS（官方 CDN tgz 精确锁版），PPTX 不直接渲染——Windows 经 PowerShell 5.1 调 PowerPoint 导出 PDF 后复用 PDF 预览，macOS 用系统 Quick Look；真实课件的渲染质量属持续验证项。

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
|   |   |-- database.ts               # 数据库初始化与迁移（至 v15：projects/sessions/runs/note_versions/vsjtu_*）
|   |   |-- credentials.ts            # 凭据保护（邮箱/Canvas/LLM/水源/校园会话）
|   |   |-- storage.ts                # 共用存储路径规则
|   |   |-- resources.ts              # 跨业务文件流转
|   |   |-- resource-parse.ts         # PDF/DOCX/PPTX 文本提取与 OOXML 类型识别
|   |   |-- office-export.ts          # pptx 经 PowerPoint 导出 PDF 与关联（Win/mac Quick Look）
|   |   |-- search.ts                 # 全局搜索
|   |   |-- notifications.ts          # 通知中心
|   |   |-- system-notify.ts          # 系统桌面通知
|   |   |-- todo.ts                   # Canvas 作业同步
|   |   |-- terminal.ts               # 项目 PTY 终端（node-pty 会话与事件）
|   |   |-- settings/                 # 设置域（ipc / prefs / task-notify / index）
|   |   |-- agent/                    # Agent 核心：core / session / context / tools / capabilities
|   |   |                             # 五个子目录 + index.ts 组装入口（结构见附录）
|   |   |-- mail/                     # 邮箱业务（api.ts / ipc.ts / send.ts / drafts.ts 等）
|   |   |-- canvas/                   # Canvas 课程资料（api.ts / ipc.ts）
|   |   |-- timetable/                # 课表与日程（api.ts / ipc.ts / session.ts：校园分区与登录窗）
|   |   |-- workspace/                # 工作区条目、笔记、预览协议与按项目布局（layout.ts）
|   |   |-- shuiyuan/                 # 水源社区（api.ts / ipc.ts / 媒体代理）
|   |   `-- vsjtu/                    # 课堂视频录播（api.ts / ipc.ts，复用校园会话）
|   |-- preload/
|   |   |-- index.ts                  # contextBridge 聚合入口
|   |   `-- lib.ts + 17 个命名空间文件 # canvas / capabilities / chat / layout / llm / mail /
|   |                                 # notifications / search / session / settings / shuiyuan /
|   |                                 # terminal / timetable / todo / vsjtu / window / workspace，
|   |                                 # 通道名与 shared 契约对应
|   |-- renderer/
|   |   |-- index.html
|   |   |-- main.tsx                  # 仅挂载 React
|   |   |-- app/                      # 应用装配：App.tsx、navigation / theme / notifications、
|   |   |                             # workbench-shell / workbench-explorer / mail-draft-dialog
|   |   |-- workbench/                # 统一标签工作台：LayoutNode 分割树（layout-schema / layout-store）、
|   |   |                             # SplitNode / TabBar / TabGroup / tab-dnd / GroupToolbar、
|   |   |                             # registry 内容类型注册表
|   |   |-- content/                  # 标签内容组件（按内容类型分域，互不 import）：
|   |   |                             # chat / note / preview / review / terminal
|   |   |-- navigation/               # 项目会话导航（ProjectSessionNav / SessionRow 状态徽标）、
|   |   |                             # 项目文件树与 Canvas 资料树
|   |   |-- sessions/                 # 会话快照与 Run 事件镜像（多入口共享，打开视图不产生执行）
|   |   |-- workspace/                # 工作区数据与草稿生命周期（store / drafts / 弹窗 / 动作）
|   |   |-- features/                 # 整页业务视图：mail / timetable / videos / shuiyuan / todo /
|   |   |                             # notifications / onboarding / search / settings
|   |   |-- components/               # 跨功能共享 UI；样式就近放置
|   |   `-- styles/ lib/              # 设计 token、主题与窗口级全局规则；前端纯函数
|   `-- shared/
|       |-- api.ts                    # 领域契约聚合 re-export，保持 import 面稳定
|       |-- （领域契约文件）          # canvas / chat / documents / layout / llm / mail / notifications /
|       |                             # session / settings / shuiyuan / timetable / todo / vsjtu / capabilities 等
|       `-- resources.ts 等           # 进程间共享的纯函数
|-- scripts/                          # 开发服务器与冒烟脚本
|-- vite.main.config.ts 等三个构建配置
|-- electron-builder.yml
|-- tsconfig*.json / package.json / pnpm-lock.yaml
`-- pnpm-workspace.yaml               # pnpm 12 设置，无子包
```

这是目标组织约定，不要求预先建立空目录。React 组件使用同目录的 `*.module.css`，页面样式留在对应 feature；全局样式只保存设计 token、reset 和窗口级规则。模块可用 `index.ts` 暴露少量公共入口，但不建立导出整个 renderer 的总入口。`src/main/` 各级业务目录在对应的 `test/` 子目录集中放置单元测试，例如 `src/main/agent/session/test/`、`src/main/agent/tools/todo/test/`；测试样例必须脱敏。

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
- 主窗口点击关闭时仅隐藏到系统托盘；退出仅由托盘右键菜单中的显式“退出”操作触发。托盘菜单可打开主窗口、新建对话（通用会话）或新建项目。
- 应用通过 Electron 单实例锁运行；重复启动快捷方式唤起已有主窗口（隐藏时显示、最小化时恢复并聚焦），不创建第二个托盘。托盘左键单击打开主窗口，右键单击显示上下文菜单。
- 校园登录放在独立窗口与专用 Session 中，不挂载 Dela 的本地能力桥梁。失效后要求重新登录，不能把失效表现为无数据。
- 应用菜单已整体移除（仅标题栏内自绘控件），剪切/复制/粘贴/全选等基本编辑操作由主窗口与两个校园登录窗的右键菜单提供（按 editFlags 动态出项，链接处可复制链接地址）。
- 首版异步网络与小规模任务可由 main 调度。文档解析、索引等重计算在实际引入时放入 Worker/独立进程，避免阻塞窗口与应用生命周期。

## 5. 项目、文件与持久化

应用窗口为「画布 + 浮岛」骨架：标题栏与主导航侧栏同为画布色，内容区整体是浮于画布上的圆角卡片，仅保留外圈一圈细边框；内部灰白相邻边界靠色差分隔、不画线，白色相邻表面（分屏组之间、邮件列表与阅读区）保留一条淡线，宽度分隔条默认透明、悬停高亮。主侧栏与内容区不额外预留间隙，分隔线仅占 1px，透明命中范围保留便于拖动；项目与会话标题限制在行内并在尾部渐隐。项目行悬停/键盘聚焦显示更多菜单与新对话按钮，菜单复用既有重命名弹窗；空项目展开后提供创建首个对话入口。

项目工作区与通用工作台已统一为标签工作台（2026-09-29 阶段三重构）：聊天、笔记与文件预览同为标签内容，每个工作组拥有自己的扁平标签栏与活动标签。标签可在组内排序、跨组拖拽分组；拖到组边缘或经组工具栏按钮创建横向、纵向分屏，横纵分割可嵌套组合出双屏、三屏布局，组间尺寸拖拽调整；任一组可最大化后恢复原布局。布局为按项目持久化的分割树（`layout:{projectId}` 键，通用会话池单独存储），切换项目时恢复各自的工作现场，旧编辑器布局数据自动迁移作种子。目录栏（项目文件、课程资料与归档区）开关在面板头部，折叠态的展开入口挂标题栏右侧，经 portal 挂载；窄屏目录退化为覆盖抽屉。

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

> **历史存档（2026-09-29）**：§6.1–6.3 描绘的「首页 / 项目空间 / 资料入口」三个独立视图已随统一工作台重构删除（阶段三批次 3C，旧 `features/home|projects|sources` 全部退役），聊天、笔记与资料浏览现统一进入标签工作台。现行信息结构与交互方向见 [Agent 与工作区重构计划](agent-workspace-plan.md) §4（统一标签与分屏、项目与会话导航）与 [refactor/structure.md](refactor/structure.md) §3.1；以下草图仅作沿革对照保留。§6.4、§6.5 与 TODO 小节描述的能力仍然有效，交互外壳以工作台为准。

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

设置页分区为十三个，按四个分组归拢（2026-10-06 设置结构重构，取代此前八分类；同日用户裁决取消「插件」分组标题、其四个分区并入「模型」，并把已归档对话从「工作区」拆为独立分区；设置通道统一由 `src/main/settings/ipc.ts` 注册）：**基本**——通用（开机自启动：主进程经 `app.setLoginItemSettings`/`app.getLoginItemSettings` 读写系统启动项，仅打包版操作（开发运行不注册 electron.exe）；偏好存 `workspace_settings` 的 `open-at-login`（缺省视为开启），打包版首次启动登记默认开启，此后不在启动时改写——用户经系统或设置页的改动以系统启动项为准；系统通知作为通用子节，含校园消息提醒 `campus-notifications` 键（关闭只停桌面弹窗、应用内列表不受影响）、Agent 任务通知 `task-notifications` 键（failed 默认开、completed 默认关，Run 终态经 `src/main/settings/task-notify.ts` 按偏好弹出）与暂停通知（与通知中心共用 `notifications-snoozed-until` 键，同一开关）；原「通知」分区随之取消）、外观（主题/缩放/字号/图标）、快捷键；**数据**——工作区（启动恢复与默认笔记编辑方式 `workspace-prefs` 键、当前项目布局重置经 `layout:save` 写回默认单组、已隐藏项目的入口恢复）、已归档（按项目归类查看、搜索与项目筛选、恢复或两步确认后永久删除，含全部删除）、连接（Canvas/邮箱/教务/水源与邮箱保留期）；**模型**——模型供应商（原「模型服务」，左列表右详情布局）、内置能力、自定义指令（含全局 Instruction）、Skills、MCP Server；**关于**——关于、隐私条款（占位说明页，正式条款未定）。

快捷键为可修改项（`keybindings` 键，只存与默认不同的动作，null 表示显式解绑）：动作目录与默认键位是 `shared/keybindings.ts` 的单一事实来源（16 个动作：文件/导航/视图 11 个全局 + 工作台 5 个），AppShell 经该表派发窗口级动作、Workbench 经装配层传入的键位表派发工作台动作；`Alt+数字` 聚焦工作组为 digit 族（末位接受 1…9）。编辑器内部键位（复制/粘贴/保存等）与鼠标手势不纳入重映射范围。

内置能力开关（`tools-disabled` 键，只存停用项，缺键或损坏即全开）：列出 38 个内置 Agent 工具并按 8 个能力域分组，停用后工具从模型工具表移除，执行侧在旧名别名解析之后返回 `DISABLED`（与 MCP 的“运行中停用仍按旧定义调用”边界同款处理）；`read_resource`、`read_skill`、`read_skill_file` 为常驻能力（被其他工具描述与 Skill 索引依赖），只读展示原因、不可关闭；系统提示按本轮实际下发的工具裁剪网页检索与 PDF 页图像指引，避免提示词指挥模型调用已关闭的工具。开关只作用于 Agent 工具，不影响应用自身的同步与界面。

### TODO 与作业状态

- 侧栏入口位于「水源(beta)」下方，标签 TODO，图标 CircleCheckBig。统一列表展示 Canvas 作业和本地个人待办，支持来源筛选、显示已完成。点击待办自底部滑出详情卡片（与新建面板同壳）：卡片固定为所在视图 85% 高，标题与元信息（课程·状态、截止、提交时间、已写入日历）固定不滚动，元信息下 divider 接描述区、限高超出内部滚动（Canvas 作业 HTML 经自适应高度沙箱 iframe 渲染，个人待办显示备注），操作钉在卡片底部（个人：删除/编辑；Canvas：在 Canvas 中打开）。悬停行尾浮现快捷图标（个人待办：写入日历开关/编辑/删除；Canvas 作业：外链打开），图标始终占位、悬停或键盘聚焦浮现、窄屏常显。个人待办左侧圆圈即完成/重开开关，整行点击打开详情并标记已读。
- 新建/编辑待办共用 workspace 底部滑出的面板：标题、备注、五列步进式截止时间（^/v 调整；新建默认创建时刻，可清除后重设）、日历候选色与「写入日历」开关；编辑态页脚提供删除。开启写入日历的待办在课表周/月视图按截止时刻渲染为 30 分钟色块（止于截止时刻，颜色随待办），点击可跳转 TODO，日历侧不可删除。派生只发生在渲染层（事件 id 为 `todo:` 前缀），不写 calendar_events，LLM 的日程查询因此不重复计入待办。
- Canvas 作业只读；按 submission 返回区分未完成、已提交、已批改、豁免、需重交、线下和未知。成绩本身不作为已提交证据；本地已读不等于完成，完成也不自动标记已读。
- 启动和连接后同步在读且未归档课程的作业，运行期间每 15 分钟轮询；只拉取作业与 submission，不下载课程文件。失败保留缓存及每条成功同步时间，展示同步错误。
- 首次成功同步每门课程建立基线，不生成历史通知；后续新增作业生成一条通知，轮询和未完成状态不重复提醒。暂不提供截止倒计时推送或个人 TODO 定时提醒。完全退出后不轮询。
- SQLite todo_items 保存个人待办与作业缓存，read_at 和状态分开；Canvas 缓存按令牌摘要隔离，更换令牌重新建立基线，断开连接隐藏该连接的作业。
- 全局搜索纳入 TODO，搜索和通知跳转打开同一详情卡片并标记已读。LLM 使用 query_todos、save_todo、refresh_todos 与扩展后的 query_assignments（两者返回剥离作业描述 HTML，正文经 readCanvasSource 读取）；不提供作业提交入口或工具。

### 课堂视频（侧栏业务视图）

- 侧栏入口位于课表与水源之间，标签「课堂视频」，图标 MonitorPlay。数据来自 v.sjtu.edu.cn 录播平台，复用课表的校园会话（persist:dela-campus 分区，共享 openCampusLoginWindow 登录窗）；连接探活 authority/me，平台未登录的空响应与 3xx 重定向都按会话失效提示重新登录，不把空列表当无录课。
- 同步取已选课程（curriculum）与录播场次（subject_vod_list_new，每批 10 个 teclId），课程栏只显示有录播的课程（用户裁决）；失败保留本地缓存并显示同步错误。场次卡片显示缩略图、日期节次、教室与「转写生成中/课件处理中」状态位。
- 播放页双流（教师/学生机位）切换保留进度与播放状态；右侧复习面板四页签：信息、章节（AI mindmap 时间段树，点击跳转）、字幕（机器转写逐句高亮）、课件（PPT 切片 + OCR，按进度高亮），后三者懒加载一次。MP4 直链现取现用不缓存（免 cookie、live.sjtu.edu.cn），CSP media-src 仅放行该域。
- Dela 内播放不调用平台观看上报接口（addVodWatchRecord / recordPlayInfo / keepAlive），不计入官方观看记录，信息页签明示这一点。
- 「加入项目」写 vsjtu_video_refs 引用行并建 `vsjtu-video:<courseId>` 来源条目（MonitorPlay 图标）；预览中不播放视频，引用文档与目录点击经深链指回「课堂视频」播放页定位场次。
- 后续设想（未实现，M3）：Agent 工具读取字幕/章节/课件作为对话上下文。

## 7. Harness 的执行约定

当前实现（2026-09 阶段二起）复用 Pi Agent Core 作为执行循环，Dela 自有 SQLite 持久化为唯一事实来源；会话与运行采用 Session/Run 身份模型（数据库 v13 的 sessions/runs 表，设计见 [refactor/state-model.md](refactor/state-model.md)）。工具按领域重设计为统一契约（见附录），外部能力经 MCP 与 Skills 接入（阶段四）。重构前的自研 SSE 循环（`agent/loop.ts`）与单文件工具表（`agent/tools.ts`）已删除，沿革见[开发记录](devlog.md)。

```text
User request -> Create run -> Select context -> Model response
                                  ^                  |
                                  |           tool call / answer
                                  |                  v
                              Save result <- Validate & execute
                                                     |
                                      needs input / done / failed
```

现行约定：

- 模型请求经 `src/main/agent/core/pi.ts`（Pi Agent Core 执行循环的适配层）发往设置 › 模型供应商中配置的 OpenAI 兼容提供商；重试、max_tokens 回退与思考剥离（reasoning 不回灌）在包装层实现。轮次上限（12 轮、末轮注入收尾提示）与单条工具结果截断（20000 字符）在 `src/main/agent/core/run.ts`。pi 系纯 ESM 包经 `core/pi-load.ts` 动态 `import()` 加载（CJS 产物不能静态 require）。API Key 不进入 renderer 或模型消息。
- 可用模型以提供商「检测连接」返回的模型列表为准；工具调用、流式、中断与上下文限制需逐个实测，不把模型名当作能力保证。
- 上下文包括项目背景、当前请求、用户选中的资料和必要检索片段，不默认发送全部历史和全部文件。
- 系统消息按固定次序拼装（`context/assemble.ts` 的 `systemText()`，预算估算与实际下发共用同一函数）：基础系统设定（按本轮实际下发的工具裁剪外部信息指引）→ **用户附加 Instruction**（设置 › 自定义指令，`agent-instruction` 键，缺省空串不注入，上限 2000 字符）→ 已启用 Skill 索引 → 历史摘要。Instruction 优先级仅次于基础设定，不能越过其中的安全与权限边界；内容随每次请求离开本机。
- 邮件、课件、网页是资料，其中的指令不能扩大工具权限。
- Run 状态机落库（runs 表）：保存执行步骤与结果，支持取消、超时与步数限制；启动时未完成的 Run 标记 interrupted。会话消息持久化在 sessions 表（JSON parts 保存正文、思考与工具步骤的交错顺序和逐项工具结果）。
- 重启后不自动恢复执行；用户提供后续背景。模型上下文按[重构计划](agent-workspace-plan.md)第 6.1 节以预算组装（已实施）：system + 历史摘要（`sessions.summary` 前置块，标注非资源最新状态）+ 从最新向前按预算容纳的完整历史 + 本轮引用与用户消息（永不压缩或丢弃），不再有固定条数上限；估算输入达阈值（窗口 32768 保守值 − 输出与工具预留 12288 后的 70%）时，把放不下的较早历史压缩为结构化摘要并持久化，压缩用独立非流式请求、失败保留原始历史且放不下时明确报错；持久历史与原始记录完整保留，摘要跨 Run 生效。窗口大小与估算口径在接入 provider 配置后校准。
- 写入工具直接执行用户请求：笔记沿用 revision 校验，`edit_note` 支持局部修改并把每次写入记入 note_versions；尚无修改差异预览（content/review 为占位标签）。邮件工具只准备草稿，由用户在编辑器点击发送。不提供提交作业工具。
- 外部能力：MCP 工具以 `mcp_<server>_<tool>` 命名空间并入工具表，Skills 经 `read_skill`/`read_skill_file` 渐进加载（正文不常驻上下文，Skill 内容仅作资料参考、不执行其中的指令）。
- 首版不开放任意 shell。未来增加命令执行时单独设计目录范围、进程管理和结果记录。
- 本地存储不等于本地推理：发送给模型服务商的上下文会离开本机。界面应能让用户了解所选资料范围。

历史存档：2026-09 重构前，模型请求由自研 TypeScript 循环（`agent/loop.ts` 的 SSE 解析与工具循环）直接执行，校园工具为 `agent/tools.ts` 单文件内的普通函数，会话按 scope 字符串组织、历史窗口固定截取最近 12 条。该实现已被上述架构取代，细节见 git 历史与[开发记录](devlog.md)。

## 8. 接口、同步与检索原则

优先次序：Canvas 和邮箱等个人可用协议，其次是已验证的个人网页会话接口。网页自动化仅在具体需求无法由接口满足时使用，不作为全站通用默认方案。

- 数据保留来源 ID、原文链接、来源更新时间（如有）和抓取时间。
- 同步处理分页、增量、重复数据、限流和登录失效；重试有上限。
- DDL 优先使用系统明确返回且适用于当前用户的时间；邮件推断与系统记录冲突时并列显示，不擅自覆盖。
- 同一事项跨平台关联不完全依赖标题相似度；不确定关联由用户修正。
- 通知中心聚合邮件、水源与 TODO。邮件通知的已读派生自邮件本身的 seen 状态：通知面板标记已读即在邮件服务器标记 `\Seen`（他端读信经同步后通知红点随之清除），读信、删除与同步完成都会即时重播通知状态。系统桌面通知仅提示标题、点击直达对应内容；启动首轮刷新为基线不弹，主窗口聚焦或暂停通知期间不弹。
- 首版按项目、来源和文件名定位资料，辅以文本检索。SQLite 全文搜索作为后续按需能力，中文检索质量实测后决定；不预先部署向量数据库。
- 课堂视频直链现取现用不落库；应用内播放不调用平台观看上报接口，官方观看记录不受影响。
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
6. 2026-10-06 UX 审查批次的响应式与交互改动需实机审阅：月历窄容器压缩态（色点课程条）、日期步进器横向折行、抽屉/弹窗遮罩变暗动画、设置导航右缘渐隐、PDF 独立「适合宽度」按钮、导出横幅紧凑形态。动画类观感由用户审阅。
7. 课堂视频真实会话回归：envelope 包裹键与字段候选名（records/rows/list、mindmap 时间段/子节点候选键、转写/课件字段）、curriculum 默认 acteId 与学期过滤行为、teclId 逗号分隔参数、直链 TTL 与免 cookie 播放，均基于 2026-10-06 用户报告样本实现，待实机验证。

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

工具重设计已随 2026-09 重构交付（阶段二批次 2B）：全业务工具按领域重落地为统一契约，阶段四又并入 MCP 动态工具与 Skills 读取工具。阶段一的覆盖缺口盘点与重设计依据见 [refactor/tools-inventory.md](refactor/tools-inventory.md) 与[重构计划第 5.2 节](agent-workspace-plan.md)。保持单应用、单 package，不引入 HTTP 服务或 MCP 服务端。当前调用结构：

```text
renderer（workbench / content / navigation / sessions 镜像）
    → preload（session / chat / workspace / layout 等命名空间）
    → agent/session/ipc.ts（session:* 通道注册与 zod 校验）
    → agent/session/manager.ts（会话生命周期、上下文压缩接线、Run 编排）
    → agent/core/pi.ts + core/run.ts（Pi Agent Core 执行循环、轮次与截断）
    → agent/tools/registry.ts（工具定义、执行、旧名别名；MCP 动态工具并入）
    → agent/tools/<领域>/ → 各业务域 api.ts（mail / canvas / timetable / workspace / shuiyuan）
```

| 模块                         | 职责                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/core/`                | `pi.ts`（Pi 适配层）、`pi-load.ts`（纯 ESM 动态加载）、`run.ts`（轮次、取消、结果截断、运行内修剪）、`providers.ts`（模型服务配置与 llm:* 通道）、`budget.ts`（token 估算与预算口径）                       |
| `agent/session/`             | `manager.ts`（生命周期编排）、`store.ts`（会话表读写）、`runs.ts`（Run 记录与状态机）、`commands.ts`（自定义指令）、`media.ts`（图片暂存 GC）、`subscriptions.ts`（WebContents 推送）、`ipc.ts`（通道注册） |
| `agent/context/`             | `references.ts`（@ 引用与附件读取）、`assemble.ts`（预算组装）、`compaction.ts`（摘要生成）                                                                                                                 |
| `agent/tools/`               | 8 领域目录（canvas/common/mail/shuiyuan/timetable/todo/web/workspace）+ `registry.ts`（契约、聚合、旧名别名、MCP 并入）+ `shared.ts`（分页/匹配等契约助手）                                                 |
| `agent/capabilities/`        | `skills.ts`（SKILL.md 发现与启停）、`skill-tools.ts`（system 索引装配）、`mcp.ts`（stdio 客户端生命周期）、`ipc.ts`（capabilities:* 通道，阶段四）                                                          |
| `src/main/resource-parse.ts` | PDF 文本提取与整页渲染（JPEG）、DOCX/PPTX 文本提取、OOXML 类型识别                                                                                                                                          |
| `src/shared/resources.ts`    | 严格校验 workspace/canvas/mail/attachment/shuiyuan-topic 引用                                                                                                                                               |

资源引用使用对象，如 `{ type: 'workspace', id }`、`{ type: 'canvas', id: 'file:123' }`、`{ type: 'mail', id }`、`{ type: 'attachment', messageId, part }`、`{ type: 'shuiyuan-topic', id }`。引用不是磁盘路径或下载 URL，解析时验证资源仍存在；邮件缓存 ID 不承诺永久有效。

### 工具契约

统一执行结果为 `{ ok: true, result }` 或 `{ ok: false, error: { code, message } }`；通用错误码 UNKNOWN_TOOL、INVALID_INPUT、OPERATION_FAILED，领域工具另经 ToolError 返回细分码（NOT_CONFIGURED、AUTH_EXPIRED、NOT_FOUND、VERSION_CONFLICT 等）。只读联网/缓存工具普遍带 freshness 与 coverage 元信息，列表类工具统一 cursor/offset 分页。

内置 38 个工具按领域分布（各 `src/main/agent/tools/<领域>/index.ts`）：

| 领域                 | 工具                       | 说明                                                                                                                                      |
| -------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| canvas（5）          | `get_canvas_status`        | 令牌与各课程同步时间/错误（只读本地）                                                                                                     |
|                      | `list_canvas_courses`      | 已缓存课程列表，可按名称/学期过滤                                                                                                         |
|                      | `search_canvas_sources`    | 按标题查缓存资料，返回可传 read_resource 的 ref                                                                                           |
|                      | `refresh_canvas_courses`   | 联网刷新课程列表缓存（不含课程内容）                                                                                                      |
|                      | `refresh_canvas_course`    | 联网同步单门课程内容，文件/作业/通知/模块分支独立报告成败                                                                                 |
| common（5）          | `read_resource`            | 读资源正文（笔记/Canvas/邮件/附件/水源），按字符分页；PDF 可传 pages 渲染页图像                                                           |
|                      | `write_note`               | 整篇替换笔记正文，携带 revision，冲突返回 VERSION_CONFLICT                                                                                |
|                      | `edit_note`                | 局部修改（一组 oldText/newText，唯一匹配且不重叠），写入记 note_versions                                                                  |
|                      | `read_skill`               | 读取 SKILL.md 正文（渐进加载，Skill 内容仅作资料参考）                                                                                    |
|                      | `read_skill_file`          | 读取 Skill 目录内文本支持文件（仅文本扩展名，200KB 上限）                                                                                 |
| mail（3）            | `search_mail`              | 按主题/摘要缓存搜索，可按发件人/日期/文件夹筛选                                                                                           |
|                      | `list_mail_folders`        | 文件夹列表（id/总数/未读/同步时间）                                                                                                       |
|                      | `prepare_email`            | 准备邮件草稿（只备稿不发送，可附项目/Canvas/附件引用）                                                                                    |
| shuiyuan（7）        | `shuiyuan_status`          | 绑定状态（只读本地，未绑定时其余水源工具 NOT_CONFIGURED）                                                                                 |
|                      | `search_shuiyuan_topics`   | 关键词实时搜索主题，返回摘要与 topicId                                                                                                    |
|                      | `list_shuiyuan_topics`     | latest/featured/分类/标签浏览，cursor 分页                                                                                                |
|                      | `list_shuiyuan_categories` | 分类树与常用标签（10 分钟缓存）                                                                                                           |
|                      | `read_shuiyuan_topic`      | 主题详情与首段楼层，返回全量楼层 id stream 与续读游标                                                                                     |
|                      | `read_shuiyuan_posts`      | 按楼层 post id 续读（每次至多 50 个）                                                                                                     |
|                      | `link_shuiyuan_topic`      | 把主题关联到项目/文件夹（本地写引用条目）                                                                                                 |
| timetable（5）       | `get_timetable_status`     | 课表连接/同步状态与当前学期推断（含真实在线试探）                                                                                         |
|                      | `query_schedule`           | 时间范围内课程与个人事件（上海时区），缺数据带 coverage 警告                                                                              |
|                      | `refresh_timetable`        | 同步指定学期课表缓存                                                                                                                      |
|                      | `create_event`             | 创建个人日程（不修改课程课表）                                                                                                            |
|                      | `delete_event`             | 删除自建日程（课程与待办派生事件不经此删除）                                                                                              |
| todo（5）            | `query_todos`              | 统一待办清单（个人+Canvas 作业，本地缓存）                                                                                                |
|                      | `query_assignments`        | Canvas 作业截止视图（含真实提交状态）                                                                                                     |
|                      | `save_todo`                | 新建/修改个人待办（不能修改 Canvas 作业）                                                                                                 |
|                      | `remove_todo`              | 删除个人待办（仅个人）                                                                                                                    |
|                      | `refresh_todos`            | 联网刷新作业与提交状态缓存（新作业触发系统通知）                                                                                          |
| web（2）             | `web_search`               | 自建 SearXNG（阿里云 ECS）JSON 结果；HTTP 错误与全部引擎无响应均明确报错                                                                  |
|                      | `fetch_page`               | 网页转文本（http(s) 公网）；PDF 直链提取文字；超长分段返回                                                                                |
| workspace（6）       | `list_workspace_entries`   | 浏览/弱过滤工作区条目，返回可传 read_resource 的引用                                                                                      |
|                      | `create_entry`             | 创建项目、文件夹或 Markdown 笔记（可带初始正文）                                                                                          |
|                      | `update_entry`             | 重命名/移动条目，或文件夹与项目原地互转                                                                                                   |
|                      | `remove_entry`             | 移除条目引用（不删磁盘文件）                                                                                                              |
|                      | `link_canvas_source`       | 保留来源的 Canvas 资料关联                                                                                                                |
|                      | `copy_file_to_project`     | Canvas/项目文件或邮件附件复制为工作区文件                                                                                                 |
| capabilities（动态） | `mcp_<server>_<tool>`      | 外部 MCP 服务器声明的工具经 stdio 接入，重名跳过；本地 echo-server 验证通过，真实外部服务器待实机验证（见[开发记录](devlog.md) 第十五轮） |

旧工具名别名（`tools/registry.ts` 的 legacyAliases，阶段二重设计改名，保留一个发布窗口供旧会话上下文衔接）：`find_courses`→`list_canvas_courses`、`sync_sources`→`refresh_canvas_courses`、`search_sources`→`search_canvas_sources`、`search_workspace`→`list_workspace_entries`、`link_source`→`link_canvas_source`。

### 执行与上下文

- 上下文 = 用户请求（支持图文混排 parts，图片为 base64 data URL，仅当轮生效）+ @ 引用正文 + 历史摘要与按预算保留的近期对话角色/正文（估算口径：CJK 1 token/字、其他 4 字符/token、图片 1000 token/张，计入 system、工具定义、摘要与全量历史；触发压缩时摘要含目标约束、已作决定、已完成、未完成、资源引用与版本六要素）+ 本轮工具结果（PDF 页图像经 `role:'tool'` 无法承载，剥离 base64 后以合成 user 图片消息附后，持久化只留页码元数据）；不默认发送全部历史和全部文件。
- 每轮模型请求独立 120s 超时；429/5xx/网络错误按 1s/3s 退避重试（4xx 与已产出内容后不重试）；最多 12 轮，末轮注入“总结收尾”提示；单条工具结果回灌前截断至 20000 字符；运行内每次模型请求前按预算修剪较早工具结果（最近 2 轮保持完整，修剪为占位并保留前 500 字符，不做运行中模型调用）；单次回复输出上限 32768 tokens，提供商以 400 拒绝该上限时自动退回 8192 重试。
- 思考内容（`reasoning_content`/`reasoning`）仅展示、不回灌模型；用户停止标记 `stopped` 并正常返回，保留已生成内容；已执行的业务操作不回滚。
- 边界：邮箱缓存仅每文件夹近期 300 UID 窗口；作业提交状态以 TODO 同步缓存为准，缺失时明确未知；缺失周次或学期日期时不猜测日期；邮件、课件、网页是指令不可执行的资料；不提供提交作业工具，不开放任意 shell。
- 本地存储不等于本地推理：发送给模型服务商的上下文会离开本机，界面让用户了解所选资料范围。

实现细节的历史沿革与验证边界见[开发记录](devlog.md)。
