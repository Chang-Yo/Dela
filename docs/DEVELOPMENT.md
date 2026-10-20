# Dela 开发文档

面向想构建、修改和发布 Dela 的贡献者。本文是**唯一的**开发与架构文档：产品边界、分层、各子系统约定、仓库组织、构建与发布流程都在这里。

- 使用者视角：[README.md](../README.md)
- 协作方式：[CONTRIBUTING.md](../CONTRIBUTING.md)
- 按版本分节的变更记录：[CHANGELOG.md](../CHANGELOG.md)
- 日常编码约束：[AGENTS.md](../AGENTS.md)
- 远端 helper 的协议与端点表：[helper/README.md](../helper/README.md)
- 校园接口实测与资料索引：[sjtu-apis.md](sjtu-apis.md)

## 1. 产品与边界

本地个人 Agent：内核是通用 agent，领域知识外置为 skills 与 `dela` 命令，工作台 GUI 是壳。

- 单用户、单应用、单 package。正式分发仍仅 Windows；macOS 开发约定、跨平台取舍与验证流程见 §16，尚不代表功能完整或可以发布。
- 仅通过 NSIS（`.exe`）分发 Windows x64 应用。应用内更新使用 electron-updater，从自有 CDN 获取正式 Release。
- 无服务端，无账号系统。模型服务与检索 API 都由用户自己配置。
- **固定约束**：交大 jAccount 开放平台的 `client_id` 已停止申请，不存在取得途径。凡是需要官方 jAccount 授权的方案都不可行；现有能力走 Canvas Personal Token、邮箱 IMAP/SMTP、致远一号 API 与个人会话型接口。

## 2. 分层架构（建设顺序＝依赖方向，自下而上）

### 2.1 内核＝Pi Coding Agent（冻结）

`@earendil-works/pi-coding-agent` SDK 的 `createAgentSession` 就是 agent 内核。会话树（JSONL）、多轮工具上下文、自动压缩、重试、`AGENTS.md` 上下文文件、skills 发现与渐进加载都由 Pi 承担，Dela 不另写执行循环、上下文组装或压缩。

| 工具                       | 来源                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| read / write / edit / bash | Pi 内置，cwd＝会话所属项目目录；Windows 用 Git Bash，macOS 用系统 `/bin/bash`（与终端同源），不可关闭                                                                                                      |
| grep / find / ls           | Pi 内置；rg/fd 随包提供对应平台与架构版本，缺失时 Pi 才尝试下载                                                                                                                                            |
| web_search / web_fetch     | Dela 自定义工具；web_fetch 默认开启，web_search 默认关闭，由聊天输入框左下角选择搜索配置时一并启用，菜单里选「关闭」即停用；搜索配置（Brave / Google / DeepSeek / 自定义，同类型可多条）在「网络」域增删改 |
| MCP 工具                   | Dela 连接 stdio 服务器后作为自定义工具注入                                                                                                                                                                 |

目录注意：rg/fd 落在 `~/.pi/agent/bin`，**不是** `userData/pi/bin`——bin 只认 `PI_CODING_AGENT_DIR` 环境变量，Dela 不设置它。skills 不是同一套：Dela 把 `agentDir` 显式指到 `userData/pi`，Pi 的 agent 级 skills 目录随之变成 `<userData>/pi/skills`，而 SDK 里没有读 `~/.pi/agent/skills` 的代码路径。所以 `userData/pi` 里隔离的是 auth、models、sessions 与 skills，**bin 是唯一例外**。

`web_fetch` 的 HTML 转换使用纯 JS `@mdream/js`，保留 Markdown 结构、解析相对链接；仅过滤导航、页脚与非正文标签。网页保留编码处理、2MB 上限与 offset 续读，不执行 JavaScript。PDF 按响应 MIME 或文件头识别，完整下载到文档临时任务并返回工具路径，正文由 document-reading skill 解析；超过 128 MiB 明确失败，不能把网页截断字节当成完整 PDF。`web_search` 由用户提供搜索服务；注册 DeepSeek 并勾选「网页读取也使用 DeepSeek」后，`web_fetch` 优先走 `/v1/tools/fetch`，取不到正文、超时或 PDF 直链时回退本地抓取。

### 2.1.1 轮次文件变化与 Git 审阅接口

`main/agent/changes.ts` 提供本地目录的变更记录，`session.ts` 在每次 ask 开始时保存基准，执行结束后比较并冻结。覆盖目录范围内新增、修改、删除，不依赖 write/edit，所以 Bash 和脚本产物也能记录；运行期间人工或其他会话的并发修改也可能进入结果，不保证归因为 Agent 独占操作。

卡片按 `WorkspaceChat.projectId` 区分会话：项目会话提供差异审阅与增删行数；随聊（无 projectId）只列变更文件，提供 Dela 内打开、VS Code 与系统文件管理器选项，不显示审阅和行数，也不调用文件 diff 详情接口。两类会话仍使用同一套后端快照记录，此处仅收窄随聊的展示与详情请求，不减少轮前、轮后目录扫描及快照存储。

前端审阅 UI 建在这些接口上：回答末尾的 `TurnChangesCard` 读取冻结记录并以折叠卡片列出文件，项目会话通过 `readTurnChanges(sessionId, turnId, true)` 一次获取文件清单与增删统计。后端只解压一次整轮记录，按文件顺序计算 patch 统计，文件间让出主进程；不再为每个文件并发解压整轮记录。随聊省略统计，列表接口也默认不计算统计；无法统计的文件返回 `stat: null`。行内「审阅」开 `review:{sessionId}:{turnId}:{path}` 标签（`content/review`，unified patch 只读呈现），「打开」先经 `chat:locate-file` 解析本机绝对路径再开 `preview:{绝对路径}` 标签（文本/Markdown/PDF/Office 走既有预览，二进制显示不支持），下拉另提供 VS Code（`chat:open-in-vscode`）与资源管理器（`chat:reveal-file`）；已删除的文件禁用打开。两组动作与标题栏「新聊天」共用同一落位规则（`workbench/open-aside.ts` 的 `prepareAsideGroup`）：单组向右分出空新组，多组进最右组；区别只在开标签机制（newChat 走 reveal 脉冲，卡片直接 openTab）。无文件的记录（远程轮次、轮前快照缺失）不渲染卡片；partial 记录展开后展示警告。落盘失败的 `changesError` 尚未在界面呈现。

`DiffView` 对长差异分页，每页最多 500 行，提供上一页与下一页；换 patch 时回到第一页。解析保留完整行号，DOM 仅挂载当前页，避免多行小文件一次生成大量元素。

未提交改动的前端入口在会话顶栏（`ChatTab`，`uncommittedAvailability` 轻探测可用后才显示；非仓库、缺 Git、远程项目与随聊都不显示，探测开销约两次 git 调用，不做文件扫描）。目标为 `review:{sessionId}:uncommitted` 的聚合标签（`UncommittedReview`）：左侧文件列表、右侧选中文件的 `DiffView`，打开时自动选中第一个文件，不做自动轮询。已查看文件的 patch 与展示信息在组件内缓存，不保留前后完整文本；按序列化 UTF-16 长度估算，总预算 16 MiB，超限淘汰最早缓存项，单项超限则只展示不缓存。刷新开始时清空缓存并隐藏旧详情，刷新成功后即使选中文件不变也重取详情，原选中文件已不在列表时回落到第一个；组件卸载时释放缓存。未访问或被淘汰文件按请求时点读取，缓存文件的外部修改需刷新后才可见；列表与详情不保证同一时点快照。刷新前的过期响应不能覆盖新结果。读取警告在面板中展示，文件列表为空但有警告时不声称工作区没有改动。列表行不显示行数统计。`available: false` 按原因呈现（not-git / git-unavailable / remote）。

`readUncommittedFileChange` 使用 Git 的 literal pathspec 精确限定目标路径，仅读取该文件的 HEAD 与磁盘内容，不再读取其他变更文件；已跟踪文本的 patch 交给 `git diff --no-ext-diff --no-textconv --no-color` 生成，遵循仓库的换行转换与 `.gitattributes`，详情仍保留读取时的原始前后文本。未跟踪文件和无首个提交的仓库沿用 jsdiff；目录边界、排除规则及文件大小限制保持一致。列表接口仍完整读取范围内的变更，不影响每轮对话快照的记录方式。

每轮 UUID 同时作为 `RunEvent.runId`、消息 `turnId` 和冻结记录标识。消息元数据随 Pi JSONL 保存，assistant 投影继承该 turnId；旧消息不补造历史快照。历史列表也能独立查询，不依赖模型是否配置。轮次完成、模型失败、用户停止都先冻结已发生的文件变化，再通知完成；取消期间的扫描结束后不再启动 prompt。永久删除会话时清理该会话的冻结记录。

前端入口均为 `window.dela.chat`，IPC 统一校验调用来源、会话存在性、UUID 与路径字符串；客户端不传任意工作目录。`path` 必须来自接口返回的相对路径：

| 方法                                                | 返回                   | 用途                                                                |
| --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `listTurnChanges(sessionId)`                        | `TurnChanges[]`        | 按开始时间倒序列出已冻结轮次                                        |
| `readTurnChanges(sessionId, turnId, includeStats?)` | `TurnChanges \| null`  | 读取冻结轮次；includeStats 默认为 false，为 true 时批量返回行数统计 |
| `readTurnFileChange(sessionId, turnId, path)`       | `FileChangeDetail`     | 读取当时前后文本与 unified patch，不读取当前文件                    |
| `readUncommittedChanges(sessionId)`                 | `UncommittedChanges`   | 获取会话目录相对当前 Git HEAD 的净变化与未跟踪文件                  |
| `readUncommittedFileChange(sessionId, path)`        | `FileChangeDetail`     | 按请求时的 HEAD / 工作区重新读取单文件差异                          |
| `uncommittedAvailability(sessionId)`                | `available` + `reason` | 轻探测会话目录能否做未提交改动审阅，供入口可见性判定                |
| `locateFile(sessionId, path)`                       | `string`               | 解析会话内文件的本机绝对路径（须真实存在），供应用内预览标签使用    |
| `openInVsCode(sessionId, path)`                     | `Promise<void>`        | 用 VS Code 打开会话内文件                                           |
| `revealFile(sessionId, path)`                       | `Promise<void>`        | 在系统文件管理器中定位会话内文件                                    |

共享类型位于 `shared/chat.ts`。清单项包含 `path/status/beforeBytes/afterBytes/textDiff`，详情追加 `before/after/patch/note`；新增和删除分别使用 null 表示不存在的一侧。重命名先表示为删除加新增。轮次含 `cwd/startedAt/finishedAt/runStatus/state/warnings`，state 为 complete、partial 或 unavailable。完整文本不可用、扫描超限或不可读时必须展示警告，不把缺失记录伪装成“没有改动”。落盘失败通过完成事件的 `changesError` 上报，不覆盖模型原始结果。

Git 当前改动合并已暂存、未暂存的净结果，额外列出未跟踪文件，不改索引、不建提交、不执行 reset。会话目录是仓库子目录时仅返回该目录内变化；尚无首个提交时以空树为基准。非 Git 目录返回 `available: false, reason: 'not-git'`，前端隐藏该入口；Git 缺失返回 git-unavailable，远程项目返回 remote；其他 Git 错误不伪装成非仓库。冻结的轮次 diff 不依赖 Git；远程轮次目前为 unavailable，不访问同名本机路径。

目录候选：Git 项目使用 `git ls-files --cached --others --exclude-standard`，非 Git 目录使用随包 ripgrep 的 `--files --hidden --no-require-git`，沿用 ignore 规则。两种范围都排除 `.git/node_modules/.venv/venv/__pycache__/.cache/.next/.nuxt/.tools/.build/dist/out/target/coverage` 目录，保留可能含源码资源的 build。拒绝越出 cwd 的路径，不跟随符号链接，不把快照自身纳入扫描。单次最多 10,000 文件；UTF-8 文本单文件最多 1 MiB、每次扫描文本总预算 16 MiB。二进制仅提供变化标记；超过 16 MiB 的文件只比较大小与修改时间，不能保证发现保留时间戳和大小的内容替换。超限通过 warnings/note 暴露。

冻结文件保存到 `userData/chat-changes/<sessionId>/<turnId>.json.gz`，仅保存有变化文件的前后状态，先写临时文件再替换。历史不随当前文件变化；普通缓存清理不删除它，应用数据导出会随 userData 一并备份。扫描并非文件系统事务，异常退出或进程崩溃前未完成的轮次可能没有冻结记录。首次轮前基准仅在内存中，不对崩溃中的未完成轮次补造 diff。每个文本 patch 最多计算 100ms，超时返回 null 及说明，仍可取前后文本。未实现回滚与整个会话累计 diff。

### 2.2 dela 命令

领域能力的 CLI 门面。应用生命周期内一个本机 HTTP 桥（`127.0.0.1` 随机端口 + Bearer token），经 Pi 的 `shellCommandPrefix` 注入 bash，终端同样可用；`dela help` 列命令与 JSON Schema。

### 2.3 skills

领域知识与工具使用指引，Pi 按 Agent Skills 规范发现。六个内置 skill（shuiyuan / canvas / mail / todo / curriculum / document-reading）写进 `~/.dela/skills` 并作为附加 skill 目录交给 Pi；设置页的禁用名单经 `skillsOverride` 过滤。扫描位置共三处：`~/.dela/skills`、`~/.agents/skills`、`<工作目录>/workspace/.agents/skills`（`<工作目录>` 即设置 › 工作区里选定的位置，缺省 `文档\Dela`）。

`document-reading` 同样写入 `~/.dela/skills`，配套脚本由应用维护。没有解析组件时设置页仍列出它，但显示关闭且不注入 Pi；开启前必须通过组件检查。「设置 › Skills」提供安装、阶段/下载进度、取消与重试，成功后启用，设置页关闭不删除组件。远端上传不支持此本机组件。

安装器支持 Windows x64 与 Apple Silicon Mac。两端共用读取脚本、42 项依赖锁文件和安装状态流程；Windows 下载 Python.org 的 Python 3.12.10 embeddable，Mac 下载 Astral python-build-standalone 的 3.12.10 / 20250529 arm64 分发包，uv 均为 0.11.1，Python/uv 压缩包固定 SHA256。环境只安装到 `userData/components/document-reading/1`：Windows 解释器为 `python.exe`，Mac 为 `python/bin/python3`；不要求系统 Python、Homebrew 或管理员权限。依赖只接受官方 PyPI wheels、精确版本和锁定 hashes，禁止源码构建和 Agent 自行安装。解压使用各自系统 tar，最后自检成功才写 ready 标记；失败/取消不启用并清理未完成目录。保留下载包内许可证，并写入有固定来源的补充 `THIRD-PARTY-NOTICES.txt`（Python standalone、uv 及 wheel 缺少的许可证）。主安装包只带 skill/脚本/锁文件/许可证文本，不带 Python/uv/wheels。首次引导与老用户的一次性升级入口均使用「能力拓展」页，复用现有 Skills 安装 API。后续镜像与预打包组件源另行建设。

文档正文通过 skill 的 `prepare_document` → 外部 Python 脚本 → read/grep/读图 → `release_document`：主进程仅获取文件与工具路径，不解析 Office/PDF。输入副本和输出位于系统临时目录 `dela-document-reading/job-*`，读取结束显式释放；下次准备文件时清理超过 24 小时的遗留任务，不写进用户项目。未安装时 prepare 拒绝。`read_resource` 保留文本、邮件正文、水源与图片能力，对二进制文件返回 skill 指引。手写 ZIP/XML 正文解析、解析缓存和 Agent 内 PDF 页渲染已移除；GUI DOCX/XLSX/PPTX 预览仍独立存在，Office 内容识别由 file-type 提供。`web_fetch` 的 PDF 下载复用 `prepareDocumentFile`，返回 `readable: false` 和 `document` 任务，skill 直接使用其中的路径，完成后 release，无需第二次下载。依赖缺失、下载中断或超过上限时失败并释放响应；失败任务目录清理。主进程 PDF.js 提取与其原生 canvas 运行时依赖已移除，renderer 的 PDF.js 阅读器保留。未修改的上一版内置文档 skill 会自动补齐网页 PDF 指引；用户编辑过的版本保留。

`read_resource` 的文件/笔记/来源读取统一走 `resources.readResourceContent`，不调用 GUI 的 `readWorkspaceEntry` / `readCanvasSource`。资源层只直接读取文本与图片，其余文件统一返回 `format: file` 和 skill 指引，不枚举 Office/PDF 格式、不生成预览地址、不查询 PowerPoint 导出关联；Canvas 文档和邮件附件在这一步只取元数据，直到 `prepare_document` 才获取文件。Canvas 非文件正文经 `readCanvasPage` 与 GUI 共用原有按需拉取逻辑。图片与文本继续复用已有输入类型清单；笔记修订值仍为正文 SHA256。GUI 预览格式支持不限制 skill 可尝试的文件类型。

[隔离实测报告](../experiments/document-reading/REPORT.md) 是选型时的历史记录；当前行为以上述实现为准。

### 2.4 GUI

标签工作台（聊天 / 笔记 / 预览 / 终端），经 IPC 消费同一套领域实现。UI 组件统一以 vendored beautiful-ui 为基座（见其 [README](../src/renderer/components/ui/beautifului/README.md)），被替代的自研 UI 必须清理。聊天回答末尾汇总本轮 `write` / `edit` 命中的文件（按首次出现去重），每行给出文件名、所在目录与「定位 / 打开」两个按钮；相对路径按会话 cwd 解析、必须是本机存在的文件，远程项目拒绝本机打开。

聊天工具代码块复用 `CodeBlock`：标题栏的复制按钮保持单行且不参与收缩，长路径在剩余空间省略，避免聊天区的 `overflow-wrap: anywhere` 将 Copy / Copied 拆行；正文的换行与复制内容沿用原行为。

macOS 主窗口使用 `hiddenInset` 与 Window Controls Overlay，让系统红黄绿按钮和应用导航共处一行；标题栏高度与左侧避让使用系统提供的 `titlebar-area-height` / `titlebar-area-x`，不写死按钮坐标。导航控件高度限制在原生区域内，避免大字号与页面缩放时侵入内容区；全屏时系统撤销覆盖区域，恢复既有导航栏高度与左边距。Windows 保持原有自绘窗口控件，辅助登录窗口保留普通原生标题栏。preload 只读的 `platform` 是 renderer 的平台来源。

Mac 原生菜单保留编辑、隐藏、退出、全屏与窗口操作，业务菜单复用现有托盘动作通道；自定义快捷键仍由 renderer 派发，原生关闭窗口菜单不占用关标签的 ⌘W。关闭菜单操作 Electron 传入的当前窗口；辅助登录窗口正常关闭，无窗口时不操作。两端关闭主窗口均隐藏并保留后台任务，Mac 可经 Dock 恢复；真正退出沿用笔记/邮件守卫，终端与命令桥在 `will-quit` 才清理，取消退出时重置退出标记。

共享键位的 `Mod` 在 Windows 为 Control、Mac 为 Command；Mac 的 Control 单独记为 `Ctrl`，不再误触发全局快捷键。Option+字母/数字按物理键识别，组合输入不派发动作。终端复制/粘贴为 Windows Ctrl+Shift+C/V、Mac ⌘C/V，Ctrl+C 继续中断 shell。Mac 编辑器或终端聚焦时 ⌘W 可关标签，弹窗内不关闭后方标签。系统菜单保留的组合（如 ⌘Q、⌘H、⌘M 和原生编辑组合）有优先权，不建议录制为其他动作。

登录启动不使用 `openAsHidden`：Windows 传 `--hidden`，Mac 读取 `wasOpenedAtLogin` 决定是否隐藏；开发与冒烟运行不注册系统启动项。

Mac 设置页切换登录启动后读取系统实际状态，再保存偏好并返回成功；等待系统批准时提示用户到系统设置允许后重试，注册/移除未生效或系统调用失败时保留原偏好。关闭时仍处于 `requires-approval` 也视为未成功移除。首次启动仍只尝试登记一次默认值，设置页读取系统状态；正式签名与公证之前，不能把开关测试视为真实登录启动验收。Windows 原有注册与设置流程保持不变。

设置页语义约定：

- 状态用颜色点表达（绿＝连接 / 使用中，灰＝未连接）；页面主操作用主色（default）按钮。
- 常驻能力整组说明一次，行内用锁徽标替代禁用开关。
- Skills 行支持查看 `SKILL.md` 与打开所在位置（`capabilities:read-skill` / `reveal-skill`，主进程按名单独解析路径，渲染端不传路径）。
- 条款页（隐私条款、使用条款）与引导的条款接受页共用 `components/legal-markdown.tsx` 的 `LegalMarkdown`：正文是仓库根目录 docs 下的 Markdown（`docs/privacy.md` / `docs/terms.md`），构建时 `?raw` 内联后交给 react-markdown + remark-gfm 渲染，组件里不另抄一份，官网发布同一份文本。三处映射完全一致——「序号 + 标题」小节、带表头的表格，正文里最需要读者记住的一句加粗（`font-semibold text-ink`）；Markdown 的 h1 与页面标题重复，映射为不渲染。行宽与字号由各处的容器给：设置页（`sections/legal-doc.tsx` 的 `LegalDocument`）限宽 42rem、text-13，接受页放进固定高度的滚动框。
- 上面这套映射里小节间距落在标题自身的 `mt-10`（Markdown 的块是平级兄弟节点，容器给不了 grid 间距），`first:mt-0` 兜底文档若直接从 h2 开头。元素级的类名都内联在 `legal-markdown.tsx`，改一处三处一起变；各页自己的容器类留在各自文件里。
- 写条款时要避开 `。**你` 这类「加粗以中文标点收尾、紧跟汉字」的写法：CommonMark 不把该 `**` 当作闭合，只会渲染出字面星号（GitHub 同样如此）。把收尾标点移到加粗之外即可；`legal-doc.test.tsx` 对两个文档都以「strong 数 == 源码里 `**` 对数」守住这条。
- 这两个文档同时是官网 `/privacy`、`/terms` 的正文来源（`../Dela_Web` 手抄一份网页版，两仓库互不 import）。**改这里就要同步改那边**，包括顶部的「最后更新」日期；官网独有的只有隐私条款的 7～9 节（关于本站、删除你的数据、条款变更与联系方式）。

瞬时动作失败的报错与成功提示走应用内通知浮窗（`app/toasts.tsx` 的 `showToast`，内容区顶部居中滑入，error / success 变体，卡片为 beautifului `atoms/Toast.tsx`；error 8s / success 4s 自动消失，至多 4 条）。打开着的表单的校验与提交错误、持久态（连接红点、同步失败横幅、加载失败占位）仍内联展示，不进浮窗；终端输入与尺寸同步失败属高频连续操作，留内联红字条；后台自动动作（会话终态后的镜像刷新等）失败不弹浮窗，只留 console 线索。工作区 store 的 `error` 通道只承载镜像加载失败这一持久态，瞬时动作失败一律走浮窗。

### 2.5 设置页接口

设置页只暴露具体、已实现的操作；renderer 不读取已存凭据或数据库。通道由主进程各域注册：多数域在各自的 `ipc.ts`，`agent`、`notifications`、`search`、`terminal`、`todo`、`update` 在各自的 `index.ts`，`layout:*` 在 `src/main/workspace/layout.ts`；偏好落在 SQLite `workspace_settings` 表。

分区契约是 `shared/settings.ts` 的 `SettingsSectionId`；`SettingsNav.tsx` 按 `group` 聚拢：

| 分组 | 分区（id）                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------- |
| 基本 | 通用 general、外观 appearance、快捷键 shortcuts                                                 |
| 数据 | 工作区 workspace、已归档 archived、连接 connections、远程 remotes                               |
| 模型 | 模型供应商 providers、内置能力 capabilities、自定义指令 commands、Skills skills、MCP Server mcp |
| 关于 | 关于 about、隐私条款 privacy、使用条款 terms                                                    |

#### 界面行为速览

| 界面位置            | 操作                   | 受控 API 与行为                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 通用 › 开机自启动   | 读取/保存              | `settings.getOpenAtLogin/setOpenAtLogin`；打包版以系统启动项为准，持久化 `open-at-login`（缺省开启）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 通用 › 系统通知     | 四个开关与暂停         | 校园消息提醒（`campus-notifications`）、任务失败时提醒与任务完成时提醒（`task-notifications`）、暂停通知按钮组（与通知中心共用 `notifications-snoozed-until`）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 通用 › 导航入口     | 显示/隐藏              | 首页固定显示；资料、邮箱、课表、课堂视频、水源可单独隐藏，存 renderer localStorage `dela.nav-entries`。`renderer/navigation/entries.ts` 是侧栏与折叠后标题栏图标的单一真源。规则为「功能开启 > 入口显示」：隐藏入口只影响导航，能力照常；功能关闭时入口消失、显示开关置灰。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 通用 › 试验功能     | 总开关 + 子项          | `settings.getExperiments/setExperiment`；子项为「水源社区」「课堂视频下载」，只在总开关开启时生效（`main/settings/prefs.ts` 的 `experimentEnabled`），其下还有「视频默认下载目录」。键缺失或损坏都视为开启；关闭下载时立即取消进行中的任务。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 通用 › 软件更新     | 检查 / 下载 / 安装     | 打包版经 electron-updater 读取 CDN 的 latest.yml，手动下载，已下载 / 总大小、进度条、百分比依次显示；确认并保存工作区后退出，显示支持展开安装细节的向导；向导完成后可重新打开并提示实际版本。保存失败保留确认入口，安装启动失败提示手动下载；开发运行不检查。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 外观                | 主题/缩放/字号/图标    | `theme`（system/light/dark）、`zoom`（五档）、`fontSize`（12–20px，默认 16）、`icon`（white/black），各自持久化并在主进程即时生效或下次启动生效。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 快捷键              | 查看/改键/重置         | `settings.getKeybindings/setKeybindings/resetKeybindings`；动作目录在 `shared/keybindings.ts`，只存覆盖项，录制时拒绝同表冲突。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 工作区 › 工作目录   | 选择位置               | `workspace.chooseDirectory()`；只影响之后新建的顶层内容。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 工作区 › 笔记编辑   | 读取/保存偏好          | `workspace-prefs` 行的 `defaultNoteEditMode`（rich/source）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 工作区 › 拼写检查   | 开关                   | 同一行的 `noteSpellcheck`（默认关）；所见即所得与源码编辑器即时生效。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 工作区 › 布局重置   | 重置当前项目布局       | `layout.save(projectId, defaultLayout)`；下次进入该项目生效。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 工作区 › 已隐藏项目 | 恢复侧栏入口           | 侧栏「移除项目入口」写下的 `hidden` 偏好（`navigation/store.ts`），重新导入同一条目会清除它。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 已归档              | 搜索/筛选/恢复/删除    | `session.archived/update/remove`；永久删除要求先归档，两步确认，不可撤销。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 连接                | Canvas/邮箱/教务/水源  | Canvas 令牌经 `safeStorage` 加密保存、断开保留缓存；邮箱/教务/水源跳转各自配置页；邮箱回收站保留期 7/30/90 天或永久。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 模型供应商          | 多提供商 CRUD 与检测   | `llm.list/save/remove/setActive/verify/verifyModel`；配置经 `safeStorage` 加密，`list()` 不含密钥；每模型可配上下文窗口、最大输出与思考强度档位。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 内置能力            | 工具开关与搜索服务注册 | `capability.listBuiltinCapabilities/setBuiltinCapability/setBuiltinDomain`：九个内核工具按「基础 / 搜索 / 网络」三域开关，停用名单写入 `workspace_settings('tools-disabled')` 并作为 `excludeTools` 交给 Pi；read/write/edit/bash 常驻不可关（ReadSkills 不在这张表内）；没写过开关时 web_search 默认停用、web_fetch 默认启用，写过名单后全按名单。搜索服务：多条目注册表存于 `workspace_settings('web-search-api')`（同类型可多条，上限 16，旧单条与 SearXNG `{url}` 读取时自动迁移），网络域头部入口弹窗（`SearchConfigDialog`，列表 / 表单两态）增删改 Brave（固定走 LLM Context 端点）/ Google / DeepSeek（可同时让网页读取走 `/v1/tools/fetch`）/ 自定义端点（可带鉴权请求头）；设置里新建即选中并启用 web_search，删空自动停用；当前用哪条由聊天输入框左下角的选择器记录（`capability.selectWebSearchEntry`，选择即启用 web_search、传 null 选「关闭」即停用；删除选中条目自动回落到剩余第一条；select/save/remove 均使空闲会话按新工具重建），`capability.listWebSearchOptions` 为选择器提供脱敏条目与实际启用态（不含密钥；web_search 停用时 selectedId 返回 null，保留已存配置选择），配置增删改、选择与内置工具开关写入后由主进程广播 capabilities:web-search-changed，preload 通过 onWebSearchChanged 订阅，已挂载的聊天与设置页重新读取状态，旧请求不得覆盖新状态；完整条目（含密钥）仅 `capability.listWebSearchEntries` 供编辑弹窗使用；`capability.listWebSearchKeySources/readWebSearchKey(providerId)` 列出可导入密钥的 DeepSeek 模型供应商（使用中的排最前）并读取密钥预填表单，密钥是导入时的静态副本，供应商换 Key 不跟随；表单切换服务类型时清空密钥，导入过程中禁用类型切换，防止向其他服务传递旧密钥。 |
| 自定义指令          | 全局 Instruction       | `settings.getInstruction/setInstruction`（≤2000 字符）；注入位置在基础设定之后、Skill 索引与摘要之前。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 自定义指令 › 快捷   | 指令 CRUD              | `chat.listCommands/saveCommand/deleteCommand`；composer 输入 `/` 手动触发。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Skills              | 发现与启停             | `capability.listSkills/setSkillEnabled`；扫描 `~/.dela/skills`、`~/.agents/skills` 与 `<工作目录>/workspace/.agents/skills` 三处的 SKILL.md，禁用即不进模型索引；文件系统管理，删目录即删除。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| MCP Server          | stdio 服务器管理       | `capability.listMcpServers/addMcpServer/updateMcpServer/removeMcpServer/refreshMcpServer`；视图带连接状态、工具数与错误，改配置即重连。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 关于                | 版本与致谢             | `window.dela.version` 只读；Author 与 Sponsors 名单为源码内硬编码（`credits.ts`）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 隐私条款            | 只读说明               | 无 IPC；正文取自 `docs/privacy.md`，逐条陈述当前实现的数据事实：数据存放位置、凭据加密方式、Agent 外发内容与全部联网去向。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 使用条款            | 只读说明               | 无 IPC；正文取自 `docs/terms.md`；首次使用与接受记录缺失时在引导里强制接受（见 §11 引导条目），官网 `/terms` 发布同一份文本。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

#### 补充约定

- 模型供应商 `verify()` 的密钥留空时一律沿用该提供商已存的密钥，改地址不要求重填；填了就以填的为准。模型列表支持检测导入（上限 64）、手动输入与逐行检测；模型配置先改草稿、随提供商保存。
- 聊天输入框的思考强度只列出当前模型已配置的档位；未配置时显示 `default`，点击说明原因并提供「设置 › 模型供应商」入口，不推断模型能力或自动开启档位。
- 全局搜索（Ctrl+K）由 `features/settings/search-index.ts` 的关键词表跳转对应分区，设置页内无独立搜索框。

#### 全局尺寸与字号（2026-10-14）

设置 › 外观 › 字号改的是根元素 `font-size`（12–20px，默认 16；`app/theme.ts` 应用并镜像到 localStorage `dela.font-size`），rem 派生的一切随之缩放：文字、间距、图标、圆角、行高。由此派生几条硬约束：

- **尺寸一律由 rem 派生**，禁止 `text-[13px]`、`w-[280px]`、`size={16}` 这类写死像素。换算基准固定 16：`N px → N/16 rem`（半像素先向上取整，11.5→12）。字号用 token、不散落魔数：token 以默认根字号下的像素命名（`--text-2xs`=11、`--text-xs`=12、`--text-13`、`--text-sm`=14、`--text-15`、`--text-base`=16、`--text-21`…，见 `styles/globals.css`）；圆角用 beautifului 的 `rounded-chip/control/card/window`。
- **保留 px 的只有三类**：① 边框 / 描边 / 阴影（含 `ring-[3px]`、`shadow-[…]`）；② 媒体与容器查询断点（`md:`、`max-[1080px]`、`@min-[860px]`——CSS 规定查询里的相对单位按初始字号解析，改 rem 也不会跟随）；③ 第三方 dist 内改不到的固定值（已用覆盖规则补齐的见 `styles/globals.css` 末尾的 streamdown 行号）。拖拽调宽的容器尺寸（`AppShell` 侧栏、`MailView` 列表，含其阈值算术）同为 px：它们是用户用鼠标量出的画布尺寸，与实测宽度的比较在同一坐标系里。
- 沙箱 iframe（邮件正文、水源楼层、Canvas 网页）是独立文档，rem 不继承外层：由 `lib/root-font-size.ts` 把当前根字号注进内层 `html`，字号变化时靠 MutationObserver 重新渲染。
- 写邮件正文编辑区显式设置 `font-synthesis: weight style`，覆盖全局的 `none`，保证缺少斜体或粗体字形时仍能显示所选格式；该设置不写进发送 HTML。格式按钮通过编辑区选区和 `queryCommandState` 同步，监听 `selectionchange` 以覆盖鼠标、键盘及程序改变选区的情况。正文仍只保留 B / STRONG、I / EM、链接、段落和 CID 图片等已有安全子集；纯文本草稿按行恢复为 BR，发送与保存的纯文本按 BR / DIV / P 提取换行，不读取脱离文档的 `innerText`（会丢失块换行）。
- 迁移自 `text-[Npx]` 的档位显式声明 `--text-N--line-height: inherit`，与任意值字号原本「只给 font-size、行高继承父级 1.5」的表现一致；`text-sm / base / lg / xl / 2xl / 3xl` 沿用 Tailwind 自带行高比（既有页面依赖，未改动）。

## 3. 会话与上下文

- **项目＝目录**：项目是 `kind='project'` 的 workspace 条目，身份是条目 UUID，目录是其 `local_path`；目录可在工作区内新建，也可导入电脑上已有的文件夹（留在原处，重命名 / 移动按同一套语义真的动磁盘）。远程项目的 `local_path` 是远端 POSIX 路径，本地没有这份目录（见 §4）。
- **会话 cwd**：项目会话是该项目的目录；通用（随聊）会话是 `<工作目录>/chat-sessions/<会话 id>` 私有目录；资料页会话用 `<工作目录>/courses`；`sessions.cwd` 为 NULL 的旧会话才回退到工作区根。目录缺失时报错，不静默换目录（远程项目跳过本地存在性检查）。
- 会话的完整记录是 Pi JSONL（`userData/pi/sessions`），SQLite `sessions` 只是索引（项目归属、标题、置顶、归档、cwd、文件路径）。renderer 看到的 `WorkspaceChat` 是 Pi 消息的投影（`main/agent/session.ts`）。
- 会话归属在创建时确定，ChatTab 从会话快照取 projectId/cwd，不取当前工作台。
- **上下文是 pull 模型**：@ 引用是会话 cwd 下文件的绝对路径，模型自主 read；文本附件与图片随用户消息进入 Pi 会话，文档附件仅传本地 workspace 文件引用，由 document-reading skill 按需解析。引用以「@相对路径」token 内联在 composer 文本里（发送前经 `content/chat/reference-tokens.ts` 解析回绝对路径，未命中的 @文本只是正文），因此引用无数量上限；拖入 / 粘贴 / 选择的附件维持在 composer 上方 chips、上限 5，与引用分开计数。候选默认取会话 cwd 下的工作区文件；通用池会话（projectId 为 null 且非远端）额外并入课件候选——`canvas:cached-files`（`main/canvas/course-files.ts` 纯函数 + `api.ts` 编排）列出 courses 目录下最新学期已下载到本地的文件，workspace store 在进入会话时拉取、30 秒内去重，标题形如「课程名/相对路径」，与工作区候选重名时以工作区为准。
- **聊天文档附件**：输入入口仅区分内联图片、常见文本和其他文件，不枚举 Office/PDF 格式。图片上限 5 MiB、文本上限 1 MiB、文档上限 128 MiB；文档需要已安装且启用 document-reading skill。文档保存为 `userData/chat-media/<UUID>.<ext>`，消息元数据记录附件 id，发送后保留供追问；未发送附件移除时删除，启动时按会话引用回收孤儿文件。二进制不按 UTF-8 注入提示词，不复制进项目；支持只发送附件。当前远端项目无法访问本机解析组件，发送文档附件会提示切换本机会话。
- **上下文占用**：快照与流式事件携带 `contextUsage`（Pi `getContextUsage` 的投影，仅打开中的会话有）；composer 底部圆环按占用显示进度，悬浮面板报 tokens、窗口总量、百分比与本会话缓存命中率。压缩后 tokens 未知时显示「—」。
- 系统提示＝Pi 默认提示 + Dela 追加段（dela 命令说明、项目名与目录、用户自定义指令）。
- 编辑重发在 Pi 会话树上分支，旧分支保留在 JSONL。
- 自定义 OpenAI 兼容网关的 API 根由模型列表端点探测决定（`{base}/v1/models` 应答则根为 `{base}/v1`；网关把控制台首页以 200 返回时不算命中）；检测回传校正地址，表单直接采用。密钥留空一律沿用已存值，改地址不要求重填。

Canvas 资料目录与 `latestTermOf` 共用 `shared/canvas.ts` 的排序规则：从名称提取单年份或相邻两年学年及 Fall/Spring/Summer、春/夏/秋；跨年学年的春夏归入后一年，学院前缀不影响时间顺序。可识别学期排在前面；同一时期或均无法识别时沿用名称降序。仍只选首个非「未标注学期」作为最新学期，用于主列表、刷新和已下载课件的 `@` 候选，其余学期沿用归档区展示；不合并同一时期的分组，不读取日期或判断是否正在开课，不改原名称、数据格式和课程目录。

## 4. 远程项目

把远端 Linux 主机上的目录登记为项目。**本地内核 + 远程执行**：内核、模型密钥、会话 JSONL、skills 与系统提示都在本地，只有工具执行、终端、目录读取与文件预览落到 SSH 远端（`src/main/remotes/`）。

- **传输**：`transport.ts` 是一次性 ssh 的唯一边界，全部走 `ssh <host> <script>`，不引入 SFTP。Windows 系统 OpenSSH 优先、`vendor/openssh` 兜底（自带 `ssh.exe` + `libcrypto.dll` 经 `extraResources` 进 `resources/openssh`），探测顺序是 System32 → Program Files → 自带目录；**System32 那份可能是旧版本**（Windows 本机实测 System32 为 9.5p2、Program Files 为 10.0p2），排障时先确认实际生效的是哪一个。Mac 使用 `/usr/bin/ssh`。一次调用一个 ssh 子进程，Windows 实测每次 0.3–0.6 秒。
- **helper 通道**（日常路径）：`ssh -L` 隧道 + 远端 `127.0.0.1` 上的 HTTP。helper 是一个 Go 静态二进制，Dela 把它放到 `~/.dela/helper/<版本>-<sha8>/` 再启动。建好之后不再付握手钱（列目录实测 28 ms vs 310 ms）。端点、心跳与生命周期规则见 [helper/README.md](../helper/README.md)。
- **工具**：read / write / edit / bash / ls / find 复用 Pi 的工具定义、只换 `operations`；grep 在 Pi 内部固定 spawn 本地 rg，故保留其 schema 与描述、自写 execute 在远端搜（rg 缺失时退回 `grep -rnH`）。同名自定义工具覆盖内置（`agent-session.js` 注册表后写覆盖），因此这七个名字**不能**进 `excludeTools`。
- **路径**：会话 cwd 就是远端 POSIX 绝对路径；工具传来的路径先经 `remotePath` 还原（Windows 会把 `/root/x` 解析成 `\root\x`）。远端上下文镜像到 `<userData>/remote-context/<remoteId>/<projectId>/`，`remotePath` 是唯一收口——七个工具（含 grep）的全部路径入口自动生效。镜像路径和命令正文按路径格式匹配：Windows 镜像兼容大小写与两种分隔符，Mac/POSIX 镜像保留大小写及文件名中的反斜杠；前缀相似的兄弟目录不映射。
- **本地不碰远端路径**：`projectLocation` 分远程分支，`entry()` 拒绝远端路径，远程项目内禁新建 / 重命名 / 移动，目录不进本地扫描也不 `fs.watch`。远端条目 id 是「项目 id + 远端路径」，两台连接上的同路径目录不会混。远端目录的变化由 helper 的 inotify 事件流推给目录树（只监视展开的那几层）。
- **认证**：Dela 不存任何口令；密钥走 ssh 自身的 `~/.ssh/config` 与 agent，密码只在交互终端里由 ssh 询问。连接自检 `ssh -o BatchMode=yes -o ConnectTimeout=10 <dest> true`，主机指纹不自动接受。
- **VS Code 打开项目**：Windows 直接启动 `Code.exe`，Mac 启动应用包内的 CLI；远程项目附带 `--remote ssh-remote+<host>`。不使用 `windowsHide: true`，它会隐藏首次启动的 Windows GUI 窗口。VS Code 的 Remote - SSH 扩展与 ssh config 仍由用户配置。
- **降级**：helper 起不来时（服务器禁执行 `noexec`、只读挂载、SELinux 拦截）自动分类原因并退回一次性 ssh，向导日志与目录树都显示人话文案。降级后端口预览与远端改动实时刷新不可用，其余功能照常。
- **不做**：远端笔记写回与编辑器内保存；远端 PPTX 内嵌预览（下载后用 PowerPoint 打开）；远程会话里没有 dela 校园命令；JS 扩展宿主；远端 MCP 端口转发。

开发注意（真机踩过的坑）：

- 连接是「一次调用一个 ssh 子进程」，没有多路复用。短时间并发握手太多时主机会直接断开（`Connection closed by <host> port 22`），并行跑多个真机测试文件就会偶发；`pnpm test:remote` 因此要串行（串行由 `vitest.remote.config.ts` 的 `fileParallelism: false` 保证）。App 侧一次工具调用只有一条连接，但模型并发发起多个工具调用时可能撞上主机的 MaxStartups。
- `sshBaseArguments` 统一带 `ServerAliveInterval=15`、`ServerAliveCountMax=3`：一次 10 分钟无输出的远端命令会被对端 reset（`clientaliveinterval 0` + 客户端不发保活，中间的 NAT/防火墙丢连接）。心跳同时是隧道的保活包。
- **路径归一化是最容易静默改错文件的点**：工具在调用 operations 之前用宿主 `node:path` 解析参数，Windows 本机实测 `path.resolve('/home/u/proj','src/a.ts')` → `E:\home\u\proj\src\a.ts`。operations 仅对 Windows 形态去盘符、将 `\` 换成 `/`；原生 POSIX 路径不套用这些规则，避免静默改错文件。
- 快速反复重启会在远端留几个「过期」helper：Dela 退出不发退出请求，旧实例带着过期 token 最多再活 5 分钟，拿不到请求，只是占位进程。
- 多通道没有空闲回收，也没有条数上限：一个会话里用到过几个连接，就各留一条通道与一个远端 helper（各带自己的心跳），直到应用退出全部关掉。上界通常是个位数。

## 5. 课堂视频

- 在线观看是常规功能，入口只受「导航入口」显示设置影响。下载属于试验功能：总开关与「课堂视频下载」子项都开启才显示下载按钮、下载面板与默认目录设置（`renderer/features/settings/experimental.ts` 为侧栏、设置区与页面共用的开关镜像）。
- 水源同为试验子项（默认开启）。关闭后：`shuiyuan:*` IPC（除 `get-state`、`unbind`）、`dela` 水源命令与 `read_resource` 的水源来源都拒绝调用，`dela help` 不再列出；内置 `shuiyuan` Skill 不注入 Agent、设置页不列出（不写入用户禁用名单）；通知中心停止轮询并隐藏已有水源通知；停在水源页回首页，已打开的水源来源标签关闭。绑定凭据保留。
- `renderer/features/classroom` 为可折叠课程侧栏 + 播放器两栏（无页头；侧栏与资料面板同款：inset 底、紧凑头、可拖宽度、折叠态在播放器标题行给展开钮），支持选课选场次、在线播放、拖拽进度、音量与倍速、多画面切换及原始下载（下载默认目录写入 `video-download-directory` 键，空值即由系统保存对话框决定）。
- 主进程门禁只拦下载：下载与默认目录通道在「课堂视频下载」未生效时拒绝；开关关闭的瞬间取消进行中的下载（`cancelVideoDownloads`），已有任务仍可查询与打开位置。
- `main/vsjtu` 复用课表的加密校园会话，使用前探测身份；用户在官方窗口手动登录。相同 API 的在途请求合并，短暂网络失败、超时与 408/500/502/503/504 延迟 250ms 后重试一次，登录失效或数据格式错误不重试。Cookie 与媒体签名留在 main。
- 课程与录像共用分页解析。官方成功空分页可能返回 `records: null`：仅第一页、外层 `ok` / `dataOk` 均为 true、`rowCount` / `pageCount` 均为数字 0 时作为空数组；其余 null、缺失或错误类型继续报错，后续页不能用零总数清空已取结果。非空分页沿用原逻辑；renderer 复用现有「本学期暂无课堂录像课程」/「暂无录像」提示，成功空结果不退回登录卡。
- 课程优先取当前学期的 `myself/curriculum`；只有成功解析为空列表时，才分页查询官网「我的课程」使用的 `group_subject_vod_list/t-1`，逐条校验 `acteId` 并保留当前学期，以 `teclId` 去重。原课表非空时不补查、不合并，登录失效、`ok` / `dataOk` 为 false 或格式变化均报错，不用备用来源掩盖失败。两端共用这一规则，不按学院或系统猜测来源；录像、播放和下载继续使用原接口。
- 在线播放走 `dela-resource://vsjtu/video/<videoId>/<view>?t=<token>` 主进程代理（`main/vsjtu/playback.ts`）：本次运行随机密钥按 videoId 签发 HMAC token，元数据缓存淘汰后旧播放地址仍可重新取源；同录像的并发取源与刷新合并。签名地址缓存 10 分钟，过期或上游 401/403 时刷新。Range/If-Range、HEAD 和 206/416 语义透传；上下游媒体缓存均禁用，媒体请求不携带校园 Cookie、不跟随重定向。
- 媒体首包等待、下游需要数据时的读取等待均限 15 秒。响应体被取消时显式中止上游。已开始传输的流若中断或读超时，结束响应交由页面重试，**尚不支持无缝续接**。CSP 为 `media-src 'self' dela-resource:`。
- 下载沿用 Electron `DownloadItem`，重复任务拒绝启动；区分用户取消与网络中断，中断后需重新下载。任务列表仅驻留内存，无跨重启续传。不合并、不转码、不依赖外部 FFmpeg，不调用观看上报、AI、字幕、PPT、直播或旁听接口。

preload 暴露的 API：

| preload API                                             | 保留能力                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `vsjtu.connect()`                                       | 打开官方登录窗口，探测登录并保存会话                                   |
| `vsjtu.listCourses()`                                   | 查询本学期本人课程的编号、名称与课程代码                               |
| `vsjtu.listVideos(courseId)`                            | 查询课程录像编号、起止时间、节次与教室                                 |
| `vsjtu.streams(videoId)`                                | 返回画面编号、时长与代理播放地址（含本次运行有效的 token，非签名直链） |
| `vsjtu.download(videoId, view, name)`                   | 选择保存位置，重新获取签名地址并启动原始 MP4 下载                      |
| `vsjtu.downloads()` / `vsjtu.onDownload(listener)`      | 查询及订阅本次应用运行期间的下载进度和状态                             |
| `vsjtu.cancelDownload(id)` / `vsjtu.revealDownload(id)` | 取消任务或打开已完成文件的位置                                         |

**已验证**：本学期 8 门课、计算理论 9 场录像与两路画面信息；两路代理视频跳到第 10/27/50 分钟均就绪（200–461ms），连续快速跳转后播放继续且无媒体错误。该验证使用独立 video 元素调用同一代理，**未验证**整页交互与长时间弱网表现。

## 6. 应用内更新

应用内更新用于 Windows 与 macOS（Apple Silicon），使用精确锁定的 electron-updater 6.8.10，配套 electron-builder 26.15.3 的 NSIS 与 DMG/ZIP 目标，不自行实现版本比较、差分下载或安装器。其余平台（如 Linux）从初始快照即返回 `unsupported / platform-unsupported`，不注册后台检查、不恢复待安装标记、不调用更新器或打开下载页；设置页显示当前版本与能力限制。

- 更新源为 `https://openlist.frameneo.com/sd/Dela_latest_release/`，通过 Generic provider 读取 `latest.yml`（Windows）与 `latest-mac.yml`（macOS，顶层 path 指向更新用 zip，dmg 仅供首次安装）。下载页面为对应的 `/@s/Dela_latest_release` 分享页；客户端不解析分享页 HTML。构建时由 electron-builder 在 resources 中生成 `app-update.yml`，主进程构建将 electron-updater 保持 external。
- CDN 定期拉取最新正式 GitHub Release 的文件并扁平存放，只保留最新版；上传和同步由 CDN 侧完成，CI 不持有 CDN 凭据。同步时安装包与 blockmap 应先于元数据就绪，避免元数据指向缺失文件。
- Release 同时提供 `Dela-<版本>-win-x64.exe` 与对应 `.exe.blockmap`、`Dela-<版本>-mac-arm64.dmg/.zip` 与更新用 `.zip.blockmap`。发布元数据 Windows 为 `latest.yml`、macOS 为 `latest-mac.yml`；预发布 Release 不进入 CDN 正式版目录，客户端固定 latest、拒绝预发布及降级。
- 开启 NSIS differentialPackage，Generic provider 使用单段 Range 请求。更新器优先使用本地旧安装包和 blockmap 缓存，缺少缓存、旧 blockmap 或差分失败时退回全量下载；SHA-512 校验由更新器完成，不保证每次都是差分下载。
- 主进程 `main/update/index.ts` 持有状态，检查与下载的 Promise 处理失败；进度和安装器异步启动错误通过事件接收。界面只读快照和派发动作，设置页关闭不会打断下载。发起安装后保持 installing，不把启动安装器当成安装成功。
- 下载进度事件传递 `transferred` / `total`，进度条左侧显示“已下载 MB / 总大小 MB”（formatBytes 口径，与缓存占用等处一致），右侧百分比向下取整，避免未完成时提前显示 100%；总大小未知时显示“—”。差分回退时同步回退实际进度和传输量，避免旧的 100% 掩盖全量下载，差分情况下大小表示实际传输量。
- 进度 100% 仅表示传输已完成，仍需等待校验及安装准备；界面显示“正在校验并准备安装”。收到 `update-downloaded` 正式完成事件即进入 ready，不再等待其后的缓存收尾；下载 Promise 成功回执也可进入 ready。渲染端先订阅再读取初始状态，迟到的读取结果不能覆盖推送；若漏收 ready 广播，下载 IPC 回执仅在同版本仍为 downloading 时补齐，不覆盖安装中的状态。
- **完成状态修复验证（2026-10-14，本机）**：113 个更新相关测试、生产构建、lint、格式检查和启动冒烟通过；覆盖完成事件先于 Promise、迟到快照、漏收完成广播、100% 后才准备好安装及差分回退。尚未以新版客户端执行线上两版覆盖升级，不能把这些回归检查视为该次现场故障已完成端到端复现。
- 每两小时后台检查一次，启动后 30 秒先查一次；仅打包运行且已有窗口时执行。开发模式不联网检查。缺少或不可读的渠道元数据显示检查失败，不显示“已是最新”。
- `autoDownload=false`、`autoInstallOnAppQuit=false`：用户手动下载，下载完成后选择“退出并安装”或“下次启动时提醒”；关闭弹窗后从设置页安装会重新确认。安装前保存笔记、聊天文字草稿、邮件草稿和工作台布局；运行中 Agent、未发送附件或保存失败会阻止安装，失败时保留确认入口。确认弹窗的正文只留一行（退出后自动安装、终端任务会结束），保存与安装进行中只显示标题、不再解释细节。终端任务会结束，不能恢复。
- 安装调用 `quitAndInstall(false, true)`，关闭 Dela 并显示 NSIS 安装向导及进度，沿用原安装目录。`build/installer.nsh` 通过官方 NSIS 扩展宏启用可展开的“显示细节”：electron-builder 进入安装段先执行 `SetDetailsPrint none`，所以细节输出由 `customCheckAppRunning` 钩子重新打开（该钩子取代其默认实现，内部按原样重跑关闭 Dela 的检查），日志里才会出现开始安装、关闭运行中的 Dela、解压和安装完成这几段。`autoRunAppAfterInstall=true`，但非静默向导仍由用户在完成页选择是否运行 Dela。NSIS 安装后启动时自带 `--updated`，主进程以只读 preload 标记传给界面，只在该次启动提示实际版本，不把启动安装器当成更新成功。
- 发起安装的行为由旧客户端决定：已安装 1.0.1 / 1.0.2 首次升级到修复版仍会使用旧的静默流程，运行修复版后的下一次更新才显示向导；手动运行新版安装包可直接使用向导。
- 窗口图标显式解码为 `NativeImage`；EXE 内嵌图标与应用内两张品牌 PNG 是不同资源。启动冒烟检查两张 PNG 均可从打包路径解码。本机已安装 1.0.2 的 EXE 图标与 PNG 完整，任务栏／窗口图标异常尚未复现，不能据此宣称已修复 Windows 图标缓存问题。
- 推迟标记仍为 workspace_settings 的 `pending-install`。下次启动 5 秒后检查并复用下载缓存，准备到 ready 后再次提示，绝不自动安装。安装器启动失败提供手动下载安装包入口。
- 尚未配置 Authenticode 签名。SHA-512 只验证文件与元数据一致，不能替代发布者签名。下载源固定为 HTTPS，不随意关闭签名验证；未来启用签名时需保持发布者身份连续。
- 更新后首次启动的「更新内容」弹窗（`renderer/features/release-notes/`）：构建时以 `?raw` 内联 `CHANGELOG.md`，只取已发布版本的 `### 亮点` 小节；localStorage `dela.release-notes.last-seen` 记录已看过的版本，跨版本升级合并显示区间内各版本。首次安装只记录不弹，冒烟模式、没写亮点的版本不弹。亮点的写法约束见 AGENTS.md。
- 旧 NSIS 版本没有此更新客户端，需手动覆盖安装一次新版本；现有 appId `io.dela.desktop` 保持不变。
- **已验证（2026-10-13，本机）**：生产构建、lint、更新相关 102 个测试、Electron 与打包后启动冒烟；NSIS 1.0.1 的安装包、blockmap、latest.yml 与包内 app-update.yml 已生成。打包只包含 main / preload / renderer 三个入口产物，避免收进迁移前遗留的 out/native。
- **待验证**：线上 CDN latest.yml、Range / 差分流量、两版真实安装后的覆盖升级、UAC 与重启。本次按产品决定推迟线上 Range 验证；不能把单元测试或打包启动视为端到端升级通过。
- **更新引导修复验证（2026-10-13，本机）**：111 个相关测试、生产构建、lint、开发与打包目录启动通过；打包启动检查两种品牌 PNG 可解码。“显示细节”扩展通过 NSIS 编译（复用隔离打包目录验证安装器脚本），尚未执行覆盖安装。新版 NSIS 可见进度、细节展开、完成页返回应用及任务栏／窗口图标仍需两版实机升级验收。

## 7. 安全边界

诚实而非表演：给了 bash 就不设业务级守卫、无沙箱、无越权校验；skill 启停是引导层。保留进程级基本边界：renderer 隔离、凭据不进 renderer、preload 有限暴露。

- 数据保存在本机 SQLite，凭据经 Electron `safeStorage` 加密（`src/main/credentials.ts`）。
- renderer 不接触文件系统、数据库与凭据，一切经受控 IPC 通信。
- Agent 的 bash 与文件工具即本机权限，不设沙箱。
- Pi 的 auth / models / sessions / skills 放在 `userData/pi`，与用户自己的 `~/.pi` 隔离（只有 bin 例外，见 §2.1）；模型密钥只在主进程内注册给 Pi 的运行时，不写入 `auth.json`。
- 应用启动**不读取仓库 `.env`**，凭据只能在应用内配置。

## 8. 持久化

schema v5。迁移是逐段演进：v1→v2 只重建 `sessions`，删除 `runs` 与 `projects`（会话不迁移）；v2→v3 只加 `workspace_entries.remote_id` 并建 `remotes` 表（旧条目一律视为本地项目）；v3→v4 给 `sessions` 加 `cwd` 列；v4→v5 建 `consent_records` 表（条款接受记录，见 §11 引导条目）。更早的旧世界库整库备份为 `dela-legacy-backup.db` 后重建，旧聊天与笔记记录不迁移。旧世界库的判定与建表都不放进版本闸门：旧体系自己用 v5–v15，撞上当前版本号的老库只看版本号的话，既不会被拒绝也不会重建，只会留下缺表的库；`consent_records` 因此与 `addColumnIfMissing` 一样每次打开都幂等补建。

表：`workspace_settings`、`workspace_entries`、`remotes`、`sessions`（索引，含 `cwd`、`message_count`），`consent_records`（条款接受记录），以及领域缓存（mail 三表、timetable 两表、`calendar_events`、canvas 两表、`shuiyuan_topics`、`todo_items`、notifications 两表）。笔记即磁盘文件。

## 9. 终端

以下 Git Bash / MinGit 安装流程仅用于 Windows。macOS 固定使用 `/bin/bash` 和 Unix PTY，不安装/清理 MinGit、不设置 ConPTY 或 `MSYSTEM`；rcfile 读取 `/etc/bashrc` 与 `~/.bashrc` 后注入同一份 dela 桥。缺少系统 Bash 时直接返回 macOS 提示，不显示 Windows 安装引导。交互 shell 仍是 Bash，不读取用户的 Zsh 配置；PATH 保留继承顺序并补齐标准系统目录与 `/opt/homebrew/bin`、`/usr/local/bin`，不执行用户的登录 shell 来获取环境。Mac 的 Git 使用本机可用安装，不随包附带 Git。

与 Bash 同源：Git Bash + node-pty（ConPTY）+ xterm.js，实现参考 VS Code / Hyper；dela 桥函数同样注入项目终端。Git Bash 探测顺序：系统 Git for Windows → 随包 MinGit（`resources/mingit`）→ 应用自装的 MinGit 运行时（下段），都缺失时明确报错（`locateBash()`），**不回退 PowerShell**。随包副本由 `scripts/prepare-runtime.ts` 在打包前按源码里写死的版本与 SHA256 下载校验（版本定义只在 `src/main/terminal/mingit.ts` 一处），仓库不提交这份约 40MB 的产物（`.build/` 已忽略）；随包已有运行时时，启动会顺手清掉旧版本自装进用户目录的 MinGit 副本。

系统没装 Git for Windows 时（开发模式或旧版升级前的兜底），终端页可一键安装固定版本的官方 MinGit（`src/main/terminal/mingit.ts`）：从 npmmirror 镜像下载 zip（大陆 CDN 直连快，GitHub Releases 兜底，两者与官方发布物逐字节一致），SHA256 与版本号写死在源码（换版本必须成对更新），由系统自带 tar 解压进 `%LOCALAPPDATA%\Dela\mingit\v<版本>`，全程无需管理员权限。MinGit 只以 `sh.exe` 名义带 bash 本体，安装时复制出 `bash.exe`——argv[0] 决定 bash 是否走完整模式，`--rcfile` 注入 dela 桥依赖它；装成后把 `cmd/` 前插进主进程 PATH（`prependRuntimePath()`），终端与 Agent 的 bash 内 git 随即可用。失败与取消都清理半成品，换绑新版本安装时顺手删除旧版本目录。

内核（pi）的 `grep` / `find` 不在进程内实现，而是 spawn 外部 `rg` / `fd`；用户机器通常没有，pi 自身兜底是从 GitHub 直连下载（大陆大概率失败），因此随包分发：`vendor/bin/` 里的 `rg.exe` / `fd.exe` 经 `extraResources` 进 `resources/bin`，启动时前插 PATH 即被 pi 的 PATH 探测命中，不再触发下载（来源与升级步骤见 [vendor/bin/README](../vendor/bin/README.md)）。

macOS 的 rg/fd 位于 `vendor/bin/darwin-<arch>`，打包后为 `resources/bin/darwin-<arch>`；只拷贝目标架构，许可证与 Windows 共用。PATH 按平台使用 `;` 或 `:` 分隔，不将 Windows exe 目录注入 Mac。

远程项目的终端是本地 `ssh -tt` 申请远端 PTY，远端不需要 node-pty；该终端不注入 dela 桥，但可以让 ssh 自己问密码与主机指纹。macOS 使用 `/usr/bin/ssh`（SFTP 同样来自 `/usr/bin`），Windows 保留系统 OpenSSH → 随包客户端的顺序；远端协议与 Linux helper 不变。

## 10. 仓库组织

单仓库、单 `package.json`，三个进程分别构建：

- `src/main/` — 主进程，按业务域分目录（`mail/`、`canvas/`、`timetable/`、`workspace/`、`shuiyuan/`、`remotes/`、`vsjtu/`、`update/`、`settings/`、`todo/`、`terminal/`、`search/`、`notifications/`、`documents/`），每域一个入口：`canvas/`、`mail/`、`remotes/`、`shuiyuan/`、`timetable/`、`workspace/`、`vsjtu/` 的入口叫 `api.ts`，`settings/`、`agent/`、`update/`、`todo/`、`terminal/`、`search/`、`notifications/` 叫 `index.ts`；`ipc.ts` 只在其中 8 个域与入口并列存在（上面七个 `api.ts` 域再加 `settings/`），其余域的 `register*Ipc()` 写在入口内部；`documents/` 无入口与 IPC，由其他域直接 import。大域的入口按职责拆出同目录模块，入口仍是对外唯一 import 点：`mail/` 拆出 `parse.ts`（MIME 与正文解析）、`store.ts`（行类型、IMAP 连接、账号与回收站设置）、`sync.ts`（同步引擎与账号配置），由 `api.ts` re-export；`shuiyuan/sources.ts`（来源引用与来源读取）同样经 `api.ts` re-export；`workspace/project.ts`（Git 分支、用 VS Code / 资源管理器打开项目）由调用方直接 import。`agent/` 为 Agent 基座：`pi.ts`（Pi SDK 接线与模型注册）、`session.ts`（会话索引、事件投影与 ask）、`environment.ts`（追加提示、dela 桥、skills、MCP 与联网工具）、`commands.ts` + `domain/`（dela 命令）、`index.ts`（`capabilities:*` 与 `chat:*` 通道注册）、`providers.ts`、`skills.ts`、`mcp.ts`、`tools.ts`（内置能力开关）、`media.ts`、`chat-commands.ts`、`web-fetch.ts`、`web-search.ts`（自写工具）。根级只留不属于任何业务域的模块：入口 `index.ts`、`database.ts`、`credentials.ts`、`storage.ts`（路径与文件名）、`ipc.ts`（调用来源校验与右键菜单）、`resources.ts`（跨域资源解析）、`consent.ts`（条款接受记录）、`backup.ts`（把本机数据导出到用户选定的位置）、`cache.ts`（Chromium 缓存占用与清理）、`campus.ts`（课表、水源与课堂视频共用的加密校园会话、官方登录窗口，以及课表与课堂视频共用的 `campusRequest`：经校园 Session 发请求、15 秒超时、重定向与 401/403 视为登录失效，并把超时、断网与 408/5xx 标为可重试）与 `modules.d.ts`。
- `src/preload/` — contextBridge：`index.ts` 聚合入口 + 分域文件，只暴露受控 API。
- `src/renderer/` — React 界面：`app/`（应用装配、主题、快捷键、通知与浮窗）、`workbench/`（标签工作台、布局树、工作台装配 `WorkbenchShell` 与目录 `WorkbenchExplorer`）、`content/`（chat / note / preview / review / terminal 标签内容，笔记草稿在 `content/note/drafts.ts`）、`navigation/`（侧栏与视图路由 `view.ts`）、`sessions/`、`workspace/`（条目镜像、条目操作与远程向导）、`features/`（mail / timetable / shuiyuan / todo / notifications / onboarding / search / settings / classroom 整页视图）、`lib/`、`styles/`；共享组件在 `components/`（`AppShell.tsx`、`ErrorBoundary.tsx`、`legal-markdown.tsx` 与 `ui/`），样式用 Tailwind v4 + 语义 token。
- `src/shared/` — 进程间共享的 IPC 契约与纯函数（`api.ts` 聚合 re-export）。
- `helper/` — 远端工具服务的 Go 模块，只依赖标准库。
- 测试与被测代码同层，但摆法按层不同：`src/main/` 一律用各域的 `test/` 子目录，根级 `src/main/test/` 只放根级模块的测试；`src/renderer/` 与 `src/shared/` 一般把 `*.test.ts` 与源码并排（`renderer/workbench/`、`renderer/workspace/` 仍用 `test/`）。`scripts/` 存放开发服务器与冒烟脚本，全部为 TypeScript（Node 24 原生执行，仓库不再有 `.mjs`；`tsconfig.scripts.json` 纳入 `pnpm typecheck`）；需要打包的 TS 冒烟（workspace / remote / runtime）统一经 `scripts/run-ts-smoke.ts <名称>` 构建并运行。

边界约定：renderer 不导入 main、不访问凭据和数据库；Vite 三个配置都写死 `envDir: false`；不引入 Manager/Service/Factory 等抽象层级，出现真实重复前不做提取。打包白名单（`electron-builder.yml` 的 `files`）只含 `out/**/*`、`package.json` 与 `assets/` 下的两张品牌图——文档、个人凭据与 `.tools/` 都不进安装包。

## 11. 工具链与启动

| 工具    | 版本                                  | 何时需要             |
| ------- | ------------------------------------- | -------------------- |
| Node.js | 24.21.0（`.node-version`、`engines`） | 总是                 |
| pnpm    | 12.3.4（`packageManager`）            | 总是                 |
| Go      | `go.mod` 声明 1.22，CI 固定 1.27.2    | 只在改远端 helper 时 |

- 版本固定后不要使用全局其他版本。仓库本机把工具装在被 Git 忽略的 `.tools/` 中，PowerShell 里执行以下命令为当前会话启用：

  ```powershell
  . ./scripts/use-local-tools.ps1
  ```

- 新克隆的仓库不包含 `.tools/`，需自行安装上述版本。也可以将官方 Windows Node ZIP 解压到 `.tools/node-v24.21.0-win-x64`，再用该 Node 自带的 npm 执行 `npm install --prefix .tools/package-manager pnpm@12.3.4`。
- Apple Silicon 本机也可将校验后的官方 Node 压缩包解压到 `.tools/node-v24.21.0-darwin-arm64`；已安装固定版本的 Node 与 pnpm 后，在当前 shell 启用并核对版本：

  ```sh
  export PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH"
  node --version
  pnpm --version
  ```

- `pnpm-workspace.yaml` 只放 pnpm 12 的项目设置（`saveExact`、`engineStrict`、`allowBuilds` 门控），**不是** monorepo：没有 `packages` 字段，也没有子包。注意 `allowBuilds` 里 `better-sqlite3: false`、`node-pty: true`——原生依赖用随包预编译产物，关闭源码重建。
- `pnpm install` 的 `postinstall` 先通过 Electron 提供的 `install-electron` 命令下载运行时，再执行 `scripts/fix-native-permissions.ts`。后者仅在 Darwin 上给 node-pty 1.1.0 的 arm64/x64 `spawn-helper` 补上可执行位（包内原为 0644，会导致 `posix_spawnp failed`）；Windows 上不修改文件，不重建或升级依赖。
- 已安装依赖后若只更新了 postinstall 脚本，显式执行 `pnpm run postinstall`，增量 install 可能不重新运行。
- `@earendil-works/*`（pi-coding-agent / pi-agent-core / pi-ai / pi-mcp）在 main 构建中以正则保持 external、随 node_modules 打包进 asar；pi 系为纯 ESM 包，main 的 CJS 产物经 `agent/pi.ts` 动态 `import()` 加载。
- PDF.js 仅作为 renderer 的构建依赖；主进程不加载 PDF.js 或原生 canvas，不随正式安装包分发该原生解析依赖。
- 运行时依赖 Bash 与搜索工具 rg/fd：Windows 随包分发 Git Bash，macOS 使用系统 Bash；rg/fd 两端均按架构随包分发（见 §9）。终端页的 MinGit 一键安装只用于 Windows。
- `userData/dela.db` 是否存在只用来区分新装与升级（`window.dela.firstLaunch`，主进程在建库前判定）；是否展示引导、展示哪一段，由 localStorage 里的同意标记与引导标记决定，见下条。URL 加 `?smoke-test=1` 可短路引导；冒烟会另开临时 profile。
- 新用户引导顺序是 Intro 动画 → 条款接受页（`features/onboarding/ConsentStep.tsx`）→ 五步配置向导 → 能力拓展 → 完成动画。接受页不在向导里：它没有跳过、不占进度点，两份条款（`docs/terms.md`、`docs/privacy.md`）依次展示，各自滚到底才能点「同意并继续」，另一侧「不同意并退出」走 `window:quit` 真正结束进程（窗口栏的关闭按钮走 `close()`，那只是收进托盘、后台照跑）。正文映射与设置里的两个条款页共用 `components/legal-markdown.tsx`。「已读到底」一旦成立就不再回退，导出提示出现或窗口变矮只改变文本框高度，不会把读完的人重新锁住。
- 条款门对所有人成立：`onboardingCompleted()` 只看 `hasConsent()`，没有同意标记就一定先展示条款页——否则「不同意并退出」再打开就绕过去了。唯一例外是 `?smoke-test=1` 的短路（`--smoke-test` 走临时 profile，`--terminal-smoke-test` 在真实 profile 上也算短路，仅供开发）。接受过条款不重走旧向导，App 继续检查独立的能力拓展版本。
- 「能力拓展」作为新用户六步向导的最后一步，复用同一个 WizardShell、步骤过渡与进度点，可返回模型配置；完成后才进入结束动画。老用户只补这页，完成后直接进主界面，不重放开场或完成动画。版本标记落在 SQLite `workspace_settings('capabilities-onboarding-version')`，当前版本为 1；缺失、无效或低于当前版本时展示，点击「完成配置」才通过 `capabilities:complete-setup` 写入，读取页面不写标记。未安装任何组件也能完成；关闭前没完成则下次继续显示。仅主动提高此版本才再次提醒，普通应用更新不触发。条款优先，更新内容弹窗在此页完成后才挂载。
- 能力列表只展示真实带依赖的 Skill，不放入尚未实现的 OCR/语音示例；复用 beautiful-ui 的中性通知卡片，标题「能力拓展」，没有副标题说明。完成按钮使用既有 StepButton，在 WizardShell 底栏居中；新用户左侧保留上一步，老用户单独进入时没有上一步。内容区单独滚动，安装进度和列表长度不推移按钮；内容宽度与前五步一致。组件状态来自 `listSkills`，安装期间轮询实际阶段与下载字节，支持取消/失败重试；已安装但禁用的组件只做启用自检，不重复下载。点击完成不取消正在进行的安装，用户可在设置 › Skills 查看后续状态；设置页仍可安装、启停。页面和版本读取失败可重试，写标记失败不离开页面。
- **老用户只补一次条款，不走开场与向导**：`needsWizard()` 判断本次是否还需要向导，老用户为 false——同意后走 `onConsentDone` 直接进主界面（不播「配置完成」动画），开场动画也不放。老用户的判据见 `existingUser()`：旧版引导痕迹（`completed` / `step` / `splash`），或「本次启动前就有数据库」——清过浏览数据、渲染层 origin 变过的老安装只剩一个 `dela.db`，只能靠这一点认出来。**不能拿「引导有没有开过头」反推**：上一版的 `started` 标记同样只在全新安装的首次启动写入，老用户里也有一批人只留下它，那样会把在用 Dela 的人当成新装。反过来，全新安装在条款页点了「不同意并退出」时会写下 `dela.onboarding.declined`（`markDeclined()`，只对新装生效）：下次启动数据库已经存在，不记这一笔就会被当成老用户，一次都没配置就被丢进主界面。
- 门禁与留证分两处：门禁读 localStorage 里的同意标记（同步、启动就能判），留证写 `dela.db` 的 `consent_records`。用户每同意一份条款，界面就调一次 `consent:record`（`src/main/consent.ts`），主进程追加一行——文档名、正文顶部的「最后更新」日期、应用版本与时间；后两项由主进程盖章，界面只能提供前两项（`revisionOf()` 抓的就是 `docs/*.md` 里那行日期，抓不到时写 `unknown`）。写失败只记日志、不拦住用户：界面关心的是同意与否，而缺表这类错误已经在建库时幂等补掉。记录只追加不改写，条款改版后再次接受会留下新行，因此「同意的是哪一版、什么时候」可回溯。接受记录不参与门禁：localStorage 被清掉会重新弹条款页，这是有意的。
- 「导出本机数据」（`backup:export`，`src/main/backup.ts`）只在条款接受页出现，且只给已经有本机数据的安装（`!needsWizard()`）——全新安装没有可导出的东西，摆一个出口只会让人以为有。主进程弹目录选择框，在所选位置下建一个带日期的文件夹，分「应用数据」「工作目录」「技能」（`~/.dela/skills`，用户自己写的 Skill 与内置 Skill 混在一处、分不开）三层复制：Chromium 的可再生缓存按名字在每一层跳过（本机实测占 userData 的 97%），数据库单独用 `VACUUM INTO` 取一致快照、不复制运行中的 `-wal`/`-shm`——一致快照说的是数据库，其余文件是读取那一刻的样子，导出期间应用照常运行。符号链接一律跳过（Windows 上的 junction 也在内，pnpm 的 `node_modules` 就是）：实测没有开发者模式时复刻链接直接 EPERM，会连累整个顶层条目一个文件都复制不出来。复制失败的顶层条目名（或「工作目录」「技能」）如实回报给界面，界面只说「没有复制成功」，不替用户断言是被占用。目标落在数据目录里面时直接拒绝，不让导出边写边读自己。
- 导出期间界面按钮锁住，「不同意并退出」也在内——导出到一半退出会留下半个文件夹，用户还不知道少了什么。
- 设置 › 通用 底部的「缓存占用」（`cache.ts`）：统计与清理都只认 Chromium 的缓存目录名 `cacheDirectoryNames`，在每一层按名字找，分区（`Partitions/dela-campus`）里的同名目录也算；用户数据、数据库与同名文件不动，链接（含 junction）一律不跟，避免量到目录树外面去。清理先让默认会话与校园会话自己放手（`clearCache` / `clearCodeCaches` / `clearStorageData` 的 cachestorage 与 shadercache，与名单一一对应），再按目录删；删不掉的如实回报 `blocked`，界面提示重启后再清。清除前后各量一次，差值为负时夹到 0（清除期间 Chromium 又在写新缓存）。导出本机数据跳过的是同一份名单（`backup.ts`）。
- 远端 helper 的静态二进制已入库在 `vendor/dela-helper/`，日常开发不需要 Go；改了 `helper/` 下的 Go 代码后执行 `pnpm build:helper --all` 重建 amd64 与 arm64 两个产物并一并提交——只重建 amd64 会让仓库里的 arm64 停在旧版（发布时 CI 会覆盖，但本地对 arm64 远端的测试用的是旧版）。

## 12. 常用命令

| 命令                                            | 用途                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                                      | 启动开发服务器和窗口，监听主进程 / preload 变更                    |
| `pnpm typecheck`                                | 四组 tsconfig（main / preload / renderer / scripts）的类型检查     |
| `pnpm build`                                    | 类型检查 + main / preload / renderer 三入口生产构建                |
| `pnpm build:helper`                             | 重建远端 helper 的静态二进制（`--all` 含 arm64）                   |
| `pnpm start`                                    | 启动已构建产物                                                     |
| `pnpm check`                                    | `format:check` + `lint` + `build` + `test` 的组合检查              |
| `pnpm format` / `pnpm format:check`             | Prettier 格式化 / 检查                                             |
| `pnpm lint`                                     | Oxlint（TypeScript 正确性、未使用代码、React Hook 规则）           |
| `pnpm test`                                     | Vitest 单元测试（不含真机远程套件）                                |
| `pnpm test:remote`                              | 真机远程回归：需 `DELA_REMOTE_HOST`，CI 不跑，需串行               |
| `pnpm smoke`                                    | Electron 冒烟：SQLite、React 渲染、Pi runtime 与 preload 隔离      |
| `pnpm smoke:macos`                              | macOS 依赖验证：SQLite、Keychain、系统工具与 Bash PTY              |
| `pnpm smoke:runtime`                            | 离线执行 Pi Bash/grep/find、真实 dela help 桥与平台工具定位        |
| `pnpm smoke:desktop`                            | 原生菜单、关闭/恢复、取消退出后终端与命令桥存活                    |
| `pnpm smoke:workspace`                          | 工作区回归                                                         |
| `pnpm smoke:documents`                          | Apple Silicon 文档组件真实安装与读取（显式联网、隔离数据）         |
| `pnpm smoke:pdf`                                | PDF.js 阅读器回归                                                  |
| `pnpm smoke:shuiyuan`                           | 水源社区回归                                                       |
| `pnpm smoke:remote`                             | 真窗口远程冒烟：需 `DELA_REMOTE_HOST`，可选 `DELA_REMOTE_KEY`      |
| `pnpm exec electron scripts/terminal-smoke.cjs` | 内置终端回归（平台 Bash、多会话、选取复制）                        |
| `pnpm exec electron scripts/mingit-smoke.cjs`   | MinGit 一键安装回归：真实下载约 40MB，装进临时沙箱                 |
| `pnpm exec electron scripts/agent-smoke.cjs`    | Agent 基座回归：需 `DELA_SMOKE_BASE_URL/API_KEY/MODEL`，发真实请求 |
| `pnpm package:dir`                              | 生成未安装的可执行目录                                             |
| `pnpm package:dist`                             | 生成当前平台安装产物（Windows NSIS / macOS DMG 与 ZIP）            |

打包目录可运行 `dist/win-unpacked/Dela.exe --smoke-test` 做与 `pnpm smoke` 相同的检查；终端冒烟加 `dist/win-unpacked/resources/app.asar` 参数可验证包内资源。冒烟脚本使用独立测试目录与脱敏数据；除 `agent-smoke`（真实模型请求）与 `mingit-smoke`（真实下载 MinGit）外不发送真实请求。

真机远程测试的跑法：

```powershell
. ./scripts/use-local-tools.ps1
$env:DELA_REMOTE_HOST='root@…'
pnpm test:remote
```

## 13. 提交前检查

改动后至少运行与其相关的检查（完整约束见 [AGENTS.md](../AGENTS.md)）：

```sh
pnpm format:check
pnpm lint
pnpm build
pnpm test
```

- 改动远端（`src/main/remotes/`、`helper/`、连接与上下文镜像）时，另用 `pnpm test:remote` 对着真机跑一遍：那批用例需要 `DELA_REMOTE_HOST`，默认套件与 CI 都会跳过它们（`vitest.remote.config.ts`）。
- 涉及构建、原生依赖或打包时，另验证 `pnpm smoke` 与打包目录启动。
- 重要改动同步更新 [CHANGELOG.md](../CHANGELOG.md)；面向使用者的变化更新 [README.md](../README.md)；架构与流程变化更新本文。
- 单元测试只保留能挡住回归的用例：优先行为契约、边界与错误、安全、持久化/迁移、平台差异；不为字面默认值、setter/getter 往返、第三方库行为或纯 DOM 结构单独写用例。同一行为只留一处覆盖，修 bug 时补的用例在注释里写清真实场景。
- UI 测试断言状态、动作与副作用，不锁具体措辞；只有条款/同意、危险操作确认和可访问性名称保留原文，避免改一句提示语就要同步改测试。

默认 Vitest 配置将平台对应的 `vendor/bin` 搜索工具目录前插到测试进程 PATH，不依赖开发机或 CI 预装 ripgrep；单元测试不会执行 Electron 启动时的运行时初始化。磁盘路径断言使用与生产代码相同的 `fsPromises.realpath` 规范化实际路径与预期路径，避免 Windows 的 `RUNNER~1` 与长用户名路径别名造成误报；不能依赖普通 `realpathSync` 与异步原生实现返回相同的路径拼写。

## 14. CI

保留三个 workflow：`check.yaml` 负责 PR 与 main 检查，`pr-labels.yml` 负责 PR 分类标签，`release.yml` 负责 tag 发布。没有定时回归，也不要求 Draft PR 或手动启动检查；PR 标签自动维护，但不是必需检查。

`.github/workflows/check.yaml` 在 PR 创建、更新、重新打开及 push 到 `main` 时运行。同一 PR 或 main 的新提交取消旧检查。

- `changes` 使用固定版本的 dorny/paths-filter。PR 按相对目标分支的累计改动分流；main 按本次 push 的全部改动分流，包括删除文件。
- `basic` 在 Windows 执行格式检查。仅修改根目录 Markdown、`docs/`、`.agents/`、`.claude/` 或 `skills-lock.json` 时，安装依赖但不执行安装脚本，不构建或测试应用。其余改动执行 lint、`pnpm build`（含类型检查）及完整单元测试。
- `helper` 在基础检查通过后按需执行：Go vet/test、Linux amd64/arm64 构建及可执行文件冒烟。触发范围是 `helper/`、helper 构建脚本、预编译 helper，以及公共依赖与构建配置。
- `windows` / `macos` 在基础检查通过后按路径执行。主进程根目录、terminal/remotes/documents/update、preload/shared、scripts、helper 和共享工具资源触发两端；OpenSSH 资源触发 Windows，Darwin 工具触发 Mac。公共依赖、锁文件、构建配置、workflow、build/assets 触发两端及 helper。精确规则以 workflow 中的 filters 为准。
- 平台检查默认打目录包并验证包内资源和启动。Windows 下载基础任务的 out 产物，不重复构建；Mac 在 arm64 runner 原生构建、测试并验证原生依赖、桌面、终端与 LaunchServices。两端不再重复格式/lint，也不再调用会重复构建的 package 脚本。
- 公共配置与资源改动额外生成 Windows NSIS、Mac DMG/ZIP；修改 Mac 包验证脚本也生成归档。Mac 归档通过完整性检查后保留 7 天；普通目录包不上传。Windows 中间构建产物保留 1 天。
- helper 被选中时，平台任务必须等待其成功并下载当次产物；无需重建时使用入库的 helper，不能因 helper 合理跳过而跳过平台任务。
- `CI required` 始终汇总结果：changes/basic 必须成功，被选中的任务必须成功，未选中的任务必须为 skipped。失败、取消或非预期跳过均不能通过。

`pr-labels.yml` 使用 `pull_request_target` 在 PR 创建、更新与重新打开时打标签，覆盖 fork PR 的写权限；它不 checkout、不执行 PR 代码，只读取 API 元数据。标签必须预先创建，缺失时 workflow 只在 job summary 输出 `gh label create` 建议。大小按新增+删除行统计：S 0–99、M 100–399、L 400–800、XL 801–999、XXL 1000+；锁文件、`vendor/`、`out/`、`dist/` 不计入，文档与 CHANGELOG 正常计入。范围标签按路径叠加：`src/renderer/**` 或 `.tsx` 为 frontend，`src/main/**`、`src/preload/**`、`helper/**` 为 backend，`src/shared/**` 为 shared。类型标签优先取 closing issue 的 labels（`Fixes`/`Closes`/`Resolves`；`Refs` 不是关闭引用，不参与），单一类型优先于 PR 标题；多个 issue 类型冲突时回退到标题前缀（fix→bug、feat→enhancement、refactor、test、ci/build→ci、perf→performance、chore(deps)→dependencies），仍不明确则不打类型标签。`documentation` 仅在全部改动为文档时添加。这些标签由 workflow 管理，人工改动会在下一次 PR 事件中被校正；其他人工标签不受影响。

GitHub 分支规则应将固定的 `CI required` 设为必需检查，并替换旧的平台必需检查名称；修改 workflow 本身不会更新远端分支规则。首次云端运行成功后再切换规则。变更识别 job 额外使用 `pull-requests: read`，其余检查仅有 `contents: read`。

路径分流可能遗漏隐含的平台依赖；新增运行时入口或资源目录时同步更新 filters。真实 SSH 联调仍手动执行 `pnpm test:remote`，不接入 CI。Mac 云端冒烟不能替代签名、公证、Gatekeeper 下载后首启与自动更新验收；发布流程见 §15。

Mac 的 `--dir` 开发目录包不生成 `app-update.yml`，目录资源校验不要求该文件；DMG/ZIP 构建及 `--signed` 校验仍要求包内更新配置，正式发布的检查不放宽。

## 15. 版本与发布

### 升版

| 命令                                        | 示例（从 `0.1.0` 开始） |
| ------------------------------------------- | ----------------------- |
| `pnpm version:patch`                        | `0.1.1`                 |
| `pnpm version:minor`                        | `0.2.0`                 |
| `pnpm version:major`                        | `1.0.0`                 |
| `pnpm version:bump 0.2.0-beta.1`            | 指定预发布版本          |
| `pnpm version:bump prerelease --preid beta` | `0.1.1-beta.0`          |

- 命令只修改 `package.json` 版本（npm 负责 SemVer 校验），不自动创建 commit / tag，也不推送或发布。
- 单包 pnpm 锁文件不记录应用自身版本，升版无需修改锁文件。
- preload 在构建时从 `package.json` 内联版本号，设置页关于与冒烟检查随之同步；升版后需重新构建，开发模式需重启。
- 安装包会带上 `vendor/openssh`（`extraResources` 拷到 `resources/openssh`）。升级或更换它时按该目录 [README](../vendor/openssh/README.md) 的步骤做，并在打包目录里实跑一次 `resources\openssh\ssh.exe -V` 与一次真实连接。
- 安装包也会带上 helper（`extraResources` 拷到 `resources/dela-helper`）。CI 在 helper 或公共配置变动时、发布在每次发版时，从本次源码构建 Linux amd64 与 arm64 产物（`build-helper.ts --all`），覆盖仓库中的预编译文件后打包，避免发布旧 helper。预编译文件仍保留供无 Go 的本地开发者使用；升级 helper 时同步 Go 与 TS 两端的版本常量。
- 安装包会带上搜索工具 `vendor/bin`（`extraResources` 拷到 `resources/bin`）。升级 rg/fd 时按该目录 [README](../vendor/bin/README.md) 的步骤做，并在打包目录里实跑一次 `resources\bin\rg.exe --version` 与 `resources\bin\fd.exe --version`。
- 安装包会带上 MinGit 运行时：`pnpm package:dir` / `pnpm package:dist` 与发布 CI 都先执行 `node scripts/prepare-runtime.ts`（下载、SHA256 校验、解压到 `.build/mingit`，幂等），再由 `extraResources` 拷到 `resources/mingit`。仓库不提交该产物；换 MinGit 版本只改 `src/main/terminal/mingit.ts` 的成对常量（脚本从源码解析同一份定义），打包目录里实跑一次 `resources\mingit\usr\bin\bash.exe --version` 验证。

### 发布

`.github/workflows/release.yml` 在推送 `v*` tag 时构建并发布 GitHub Release：

1. 先提交版本号和代码，再执行 `git tag v0.1.0 && git push origin v0.1.0`；tag 必须等于 `v` + `package.json` 的版本。发版前把 `CHANGELOG.md` 的 `## Unreleased` 改成 `## <版本> - <发布日>`：更新内容弹窗只认 `## X.Y.Z - 日期` 分节（`features/release-notes/notes.ts`），留在 `Unreleased` 下的 `### 亮点` 会被静默跳过，弹窗不出现。
2. Linux helper 任务测试并构建该 tag 对应的源码；Windows 任务下载其产物，执行锁文件安装、类型检查与生产构建、单元测试、Electron 冒烟、随包运行时准备（`prepare-runtime.ts` 下载并校验 MinGit）、NSIS 构建、包内 helper 一致性与更新产物检查、打包目录启动检查。全部成功后创建 Release，上传 `.exe`、对应 `.exe.blockmap` 和渠道 `.yml`。正式版必须提供 `latest.yml`，包内必须有 `resources/app-update.yml`。
3. Mac 下载同一批 helper，独立完成检查、arm64 DMG/ZIP 构建、Developer ID 签名、Apple 公证、签名校验、更新产物检查与启动冒烟；通过后向源码仓库和公开仓库的同版本 Release 追加 Mac 安装包、`.zip.blockmap`、`latest-mac.yml`、校验和及源码提交记录。Mac 失败或等待环境批准不阻塞 Windows 发布，但会影响工作流整体状态。
4. 含预发布后缀的版本（如 `0.2.0-beta.1`）自动标记为 prerelease。
5. 也可在 Actions → Release installers → Run workflow 中手动填入已有 tag 构建发布。

`prepare` 与 `release` 任务是 Ubuntu runner，只做校验与 `gh` 上传，不构建应用；发布 job 会把 release notes 作为 artifact 上传，供 `publish-public` 复用，后者同样跑在 `ubuntu-24.04`。release 工作流的 `concurrency` 设了 `cancel-in-progress: false`，与 CI 相反。

**重跑已有 tag**：Windows 与 Mac 上传均用 `gh release upload --clobber` 覆盖同名产物。正式分发后不要覆盖重建安装包：CDN 缓存可能与新元数据不一致；程序变更应升版并发布新 tag。失败时优先 Re-run failed jobs；artifact 保留 7 天。

**公开镜像**：私有 Release 发布成功后，同一工作流会把同一批安装包、blockmap、更新元数据和完全相同的 release notes 再发布到公开仓库 [Chang-Yo/Dela_releases](https://github.com/Chang-Yo/Dela_releases) 的同名 tag Release。公开仓库中的 tag 由 GitHub 自动创建在其默认分支最新提交上，仅作发布锚点，不对应源码。

首次使用前的准备：

1. 公开仓库已有初始提交（例如 README）。
2. 在本仓库 Settings → Secrets and variables → Actions 配置 `PUBLIC_RELEASE_TOKEN`：仅授权 `Chang-Yo/Dela_releases`、权限 Contents: Read and write 的 fine-grained PAT——内置 `GITHUB_TOKEN` 无法跨仓库发布。
3. Mac 签名需要在 Settings → Environments 创建 `macos-release` 环境（允许 `main` 分支与 `v*` tag），并在其中配置 Secrets：`MAC_CSC_LINK`（Developer ID Application 证书 `.p12` 的 Base64）、`MAC_CSC_KEY_PASSWORD`（导出密码）、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。Mac 上传复用上述 token，不修改 Windows 附件或 Release 说明。

## 16. 平台基线

| 平台    | 最低系统基线 | 架构  | 产物               | GitHub runner  |
| ------- | ------------ | ----- | ------------------ | -------------- |
| Windows | Windows 10   | x64   | NSIS `.exe` 安装包 | `windows-2022` |
| macOS   | macOS 13.0   | arm64 | DMG / ZIP          | `macos-15`     |

- 以上是项目选择的构建基线，不代表最低系统实机兼容性已验收。GitHub runner 是构建环境，与最低运行系统不同。
- 安装包名包含版本、系统和架构，避免产物重名。私有发布任务使用内置 `GITHUB_TOKEN`（`contents: write`），公开发布任务使用 `PUBLIC_RELEASE_TOKEN`，token 权限只覆盖公开仓库。

### 16.1 macOS 开发约定

macOS 已接入签名与自动发布流程，首次云端正式分发尚待验收。2026-10-16 用户明确只支持 Apple Silicon，不适配 Intel Mac；早期记录中的 x64/双架构计划已撤销。当前验证覆盖 Apple Silicon 开发运行、arm64 目录包与 DMG/ZIP 解包启动、主要桌面交互、文档读取及核心校园业务。

保持一个应用、一个 package、一套主干代码。业务逻辑、数据格式与 IPC 共用，Windows 合作者的常规业务功能无需另写 macOS 版本；涉及系统命令、路径或外部程序时仍需适配与双平台回归。平台差异优先留在现有定位、进程启动与系统交互函数中，出现真实重复和多个调用方后再提取共享函数。PPTX 在 Mac 仅提供系统默认应用打开，复用同一个资源解析与 `shell.openPath` 入口，不接入 Keynote 或其他 PDF 转换器；Windows 保留 PowerPoint 转换。

Mac 的 VS Code 入口先查 PATH 中的 `code`，再查 `/Applications` 与 `~/Applications` 下标准应用包内的 CLI；完整路径以参数数组传递，本地与 Remote-SSH 入口共用，未安装时明确提示。项目目录入口在 Mac 显示 Finder，在 Windows 显示资源管理器，共用原有打开目录 IPC。Bash、PTY、搜索工具和 SSH 的运行约定见 §9，窗口与快捷键见 §2.4。

聊天 `@` 文件引用按工作目录的路径格式判断归属：Windows 盘符与反斜杠 UNC 路径兼容大小写及两种分隔符；POSIX 路径逐字匹配，保留文件名里的反斜杠，避免大小写敏感卷上的不同项目相互干扰。引用的绝对路径保持不变。新建文件名仍使用两端共用的可移植命名限制。

已下载课件的 `@` 候选同样按课程根目录的路径格式计算相对路径，不用宿主系统的路径规则解析另一平台的路径；排除目录自身、父级和其他盘符，POSIX 保留大小写及文件名中的反斜杠。移动或重命名本地条目时，标签、草稿和目录选中状态只迁移实际子树；POSIX 的反斜杠不是目录边界，草稿标题保留完整文件名。Windows 原有移动匹配规则保持不变。

同一代码版本生成不同平台产物。`electron-builder.yml` 将 OpenSSH exe、MinGit 与 Windows 搜索工具限定在 Windows 资源中；Mac 只拷入对应架构的 rg/fd，共享其许可证和 Linux helper，`prepare-runtime.ts` 在 Mac 不下载 MinGit。Mac 产物仅为 arm64 DMG 与 ZIP，打包配置显式限定 arm64，CI 同样传入 `--arm64`；不构建 Intel 或 Universal 包。`mac.publish` 与 `win.publish` 指向同一 CDN generic 更新源，Mac 包内同样生成 `app-update.yml`，发布产物多出 `latest-mac.yml`；签名包通过检查后追加到同版本 Release。开发验证使用 `CSC_IDENTITY_AUTO_DISCOVERY=false`，不读取本机签名身份；发布构建由 `release.yml` 内联生成独立配置，强制 Developer ID 签名与公证。云端签名、公证与装订已随 v1.3.0 发布通过，Gatekeeper 下载后首启与两版升级仍待实机验收。

Mac 正式发布的 Apple 开发者账号由 aizyeee 长期维护。接入时保持应用标识与发布者身份连续，签名私钥和公证认证材料仅放本机钥匙串或受保护的 CI Secrets，不进入仓库；Mac 应用内更新已启用，与 Windows 共用检查、下载、确认与安装流程，两版升级仍需实机验收。

### 16.2 跨平台取舍与待验收事项

| 项目           | 当前处理                                                                | 影响与后续决定                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心业务与协作 | 单应用、同一主干与 IPC，业务功能共用                                    | 常规 Windows 功能更新可复用；新增系统调用、路径假设、外部程序依赖仍需双平台回归                                                                 |
| 窗口控件       | Mac 原生红黄绿按钮与导航共用一行；Windows 自绘                          | 用系统覆盖区域适应按钮避让与页面缩放，保留原生全屏及窗口操作；辅助登录窗口继续使用普通标题栏                                                    |
| 关闭与退出     | 两端关闭主窗口均隐藏并保留任务；Mac 经 Dock 唤回、⌘Q 退出               | Mac 菜单关闭当前窗口，辅助登录窗口正常关闭；真正退出才结束终端                                                                                  |
| 快捷键         | Mac 用 ⌘，Control 保留 shell/编辑含义；Option 按物理字母/数字键识别     | 用户显式绑定的 Option 组合会占用相应特殊字符输入；系统菜单组合优先，自定义键位需避开；⌘W 在编辑区关标签，Windows 保留原有输入区域守卫           |
| Shell 与环境   | Mac 系统 Bash、系统 SSH、本机 Git；补常见工具目录，不执行用户登录 shell | 不自动加载 Zsh 配置；用户只写在 Zsh 初始化中的 SDK 环境不一定可见，系统命令参数也不保证与 Git Bash 完全一致；暂不随包引入另一套 Bash/GNU 工具链 |
| 登录启动       | 保留默认开启的产品行为，参数按系统处理                                  | Mac 登录项许可、实际登录后隐藏启动仍待验收；冒烟脚本禁止注册，避免测试修改启动偏好                                                              |
| PPTX 预览      | Mac 仅用系统默认应用打开原文件；Windows 保留 PowerPoint 转换            | Mac 不显示导出/重导出按钮，主进程提前拒绝转换；已有 PDF 仍可阅读并提示过期，不要求安装 Keynote                                                  |
| Agent 文档读取 | Windows x64 / Apple Silicon 共用脚本与锁文件，安装器按平台选择运行时    | Office/PDF 正文读取、文档附件与网页 PDF 读取依赖该组件；扫描件只输出页面图片，不宣称 OCR。与 GUI 阅读器及 PPTX 外部打开分别验收                 |
| 分发与凭据     | 相同源码生成不同平台产物                                                | 签名 DMG/ZIP 已接入 Release（v1.3.0 云端签名、公证通过）；Mac 应用内更新已启用。Gatekeeper 下载后首启与两版升级未验收；Intel 不在支持范围       |

本机已通过界面实测从 Dela 将含中文、空格和分号的项目目录交给 Finder 与 VS Code，笔记两种编辑模式下的 ⌘W、自动保存及 ⌘Q 退出也已验证；测试使用隔离 profile，由开发 Electron 加载打包代码。实际登录启动、系统级键位冲突、多显示器与动画表现仍需人工验收；Windows 实机、真实 SSH 与 VS Code Remote-SSH 链路也尚未在适配分支验收。模拟的平台分支测试不能替代实机回归。

水源授权、课表和课堂视频登录共用 `campus.ts` 中的窗口创建函数：Mac 使用带原生标题栏的普通子窗口，提供关闭按钮、Esc 与 ⌘W；Windows 保留模态窗口。关闭快捷键仅作用于辅助窗口，不抢主工作台的关标签动作。外部页面仍使用校园 Session、sandbox 与 contextIsolation，不加载主界面 preload。水源重复授权唤回现有窗口而不替换密钥，关窗后保留待绑定状态，绑定成功关闭本次窗口，失败可重试；课表/视频按发起窗口和入口 URL 复用正在进行的登录及其结果，取消时返回「未完成登录」并清理重探计时器。可见关闭入口已在本机实机界面验收；自动测试覆盖窗口形态、复用与绑定路径。

按当前协作决定，SSH 真机回归不作为本次 macOS 适配的阻塞项：合作者反馈已有远端测试稳定，本次重点验证 Mac 编译、打包、启动与本地 SSH 工具定位。该反馈不等于 macOS 客户端到远端的链路已验收；适配分支仍未执行真实 SSH 套件，不重复要求提供测试主机。

### 16.3 macOS 本地验证

使用 §11 的固定工具链。以下命令适用于 Apple Silicon，打包复用本机 Electron，不寻找签名身份、不发布。当前 Electron 与文档组件 wheels 声明的最低 macOS 为 13.0，不代表 Dela 的最低版本已实机验收：

```sh
pnpm build
pnpm smoke
pnpm smoke:macos
pnpm smoke:runtime
pnpm smoke:desktop
pnpm smoke:workspace
pnpm exec electron scripts/terminal-smoke.cjs
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dist --mac --arm64 -c.electronDist=node_modules/electron/dist
node scripts/verify-macos-package.ts dist/mac-arm64/Dela.app
node scripts/macos-launch-smoke.ts dist/mac-arm64/Dela.app
dist/mac-arm64/Dela.app/Contents/MacOS/Dela --smoke-test
pnpm smoke:macos "$PWD/dist/mac-arm64/Dela.app/Contents/Resources/app.asar"
pnpm smoke:desktop "$PWD/dist/mac-arm64/Dela.app/Contents/Resources/app.asar"
pnpm exec electron scripts/terminal-smoke.cjs "$PWD/dist/mac-arm64/Dela.app/Contents/Resources/app.asar"
```

`smoke:runtime` 使用临时 profile、Pi 缓存与合成文件，在 `PI_OFFLINE=1` 下执行真实 Pi Bash 中的 `dela help`、grep 与 find；Mac 以仅含 `/usr/bin:/bin` 的 PATH 起步。桌面冒烟的 Mac 标题栏检查在调整窗口和缩放后，有界等待 viewport、原生覆盖区域与 CSS 留白/高度一致，再检查导航遮挡、边界和拖动区；超时打印该尺寸组合与坐标，不跳过断言。桌面冒烟使用合成项目，经真实 IPC 打开水源授权窗（远端页面与验证响应替换为本地桩），检查平台窗口形态、隔离设置、重复打开复用及关闭后的 RSA 密文绑定；另给原生菜单回调传入真实辅助窗口，验证关闭目标及主窗口隐藏行为。执行真实 `app.quit()` 并通过 `beforeunload` 取消，再调用终端中的 `dela help`。邮件路径只覆盖退出意图的 IPC 与取消后存活，不连接邮箱或验证真实草稿保存。`smoke:workspace` 用本地网络桩与临时文件验证资料同步、导入、笔记冲突保护、移动恢复、预览协议及邮件附件草稿。

`pnpm smoke:documents` 是 Apple Silicon 专用的显式联网检查，不包含在默认 CI 冒烟中：从官方源安装真实组件到独立临时 profile，经原 Skills API 启用，执行 `prepareDocumentFile` → 未修改的 Python 脚本 → `releaseDocumentResource`，读取合成 DOCX/XLSX/PPTX 和扫描 PDF，最后清理 profile；读取子进程仅使用系统 PATH。首次组件下载约 128 MiB（本机所选 wheels），需要 GitHub、Python 分发源和 PyPI 可达；网络失败与取消必须保留可重试状态。

传入 `app.asar` 的冒烟由开发 Electron 加载包内代码与资源，Keychain 测试也属于开发 Electron 身份；实际 `.app` 另用 `--smoke-test` 检查。上述检查不代表正式签名应用、全部账号业务或全部模型调用已验收。早期 Keynote 转换实验仅作历史证据，已从当前验证记录移除；当前产品决定不接入转换器。

## 17. 当前限制

- CDN 的线上更新文件、Range 和两版覆盖升级尚未验收，检查失败时可从下载页手动获取安装包。
- 未配置代码签名，安装时可能遇到 SmartScreen 提示。
- 工作流中的冒烟检查验证打包后程序及 SQLite / preload，不代替 NSIS 安装向导的实机验收。
- 远端项目内不支持新建 / 编辑笔记；远端 PPTX 不支持内嵌预览；打开的预览不自动跟随远端改动。
