# Dela 开发文档

面向想构建、修改和发布 Dela 的贡献者。本文是**唯一的**开发与架构文档。

本文档不是详细的技术细节，而是为不同的开发场景提供一份尽可能准确的导航。

如果你要更新此文档，请记住以下几个原则：

- 代码能读出来的不写入文档，默认开发者可以通过阅读代码理解其实现思路
- 涉及到常量，编码，清单的内容不写，它们已经出现在代码中
- 那些可以写入此：读代码得不到的外部事实（第三方接口的实际行为、平台约束）、设计取舍的理由、以及尚未验收的状态。

或者简单一句话，**此文档在常规情况下不需要更新，如果你想传递你的开发信息，请直接放进 commit log 中。**

其他文档导航：

- 使用者视角：[README.md](../README.md)
- 协作方式：[CONTRIBUTING.md](../CONTRIBUTING.md)
- 按版本分节的变更记录：[CHANGELOG.md](../CHANGELOG.md)
- 日常编码约束：[AGENTS.md](../AGENTS.md)
- 远端 helper 的协议与端点表：[helper/README.md](../helper/README.md)
- 校园接口实测与资料索引：[sjtu-apis.md](sjtu-apis.md)

## 1. 产品与边界

本地个人 Agent：内核是通用 agent，领域知识外置为 skills 与 `dela` 命令，工作台 GUI 是壳。

- 单用户、单应用、单 package。正式分发仅 Windows x64；macOS（Apple Silicon）在适配中，详见 §16。
- 无服务端，无账号系统。模型服务与检索 API 都由用户自己配置。
- **固定约束**：交大 jAccount 开放平台的 `client_id` 已停止申请，不存在取得途径。凡是需要官方 jAccount 授权的方案都不可行；现有能力走 Canvas Personal Token、邮箱 IMAP/SMTP、致远一号 API 与个人会话型接口。
- 不做的功能见 [what-we-not-do.md](what-we-not-do.md)。

## 2. 分层架构

建设顺序即依赖方向，自下而上。GUI 只消费同一套领域实现，不复制业务逻辑。

### 2.1 内核＝Pi Coding Agent（冻结）

`@earendil-works/pi-coding-agent` 的 `createAgentSession` 就是 agent 内核。会话树（JSONL）、多轮工具上下文、自动压缩、重试、`AGENTS.md` 上下文文件、skills 发现与渐进加载都由 Pi 承担，Dela 不另写执行循环、上下文组装或压缩。

工具来源分四类：Pi 内置（read / write / edit / bash / grep / find / ls）、Dela 自写（web_search / web_fetch）、MCP（stdio 服务器）、Pi package 扩展（见 §2.3.1）。read/write/edit/bash 常驻不可关。

两个容易踩的目录事实：

- **rg/fd 落在 `~/.pi/agent/bin`，不是 `userData/pi/bin`**。bin 只认 `PI_CODING_AGENT_DIR`，Dela 不设置它。`userData/pi` 里隔离的是 auth、models、sessions 与 skills，bin 是唯一例外。
- 搜索工具**随包分发**。Pi 自身的兜底是从 GitHub 直连下载，大陆大概率失败，所以 rg/fd 经 `extraResources` 进 `resources/bin`，启动时前插 PATH 直接命中（来源与升级见 [vendor/bin/README](../vendor/bin/README.md)）。

`web_fetch` 用纯 JS `@mdream/js` 转 Markdown，不执行 JavaScript。PDF 按 MIME 或文件头识别，完整下载后交给 document-reading skill 解析——**不能把网页截断的字节当成完整 PDF**。`web_search` 由用户提供搜索服务，默认关闭；`web_fetch` 默认开启。

### 2.1.1 轮次文件变化与 Git 审阅

变更记录的做法是「轮前存基准、轮后比较并冻结」，不依赖 write/edit，所以 Bash 与脚本产物同样被记录。代价是并发修改（人工操作、其他会话）也会进结果，不保证归因为 Agent 独占。

两条划分：

- **项目会话**给差异审阅与增删行数；**随聊**只列文件与打开方式。两者共用后端快照，只是收窄展示与详情请求。
- **冻结的轮次 diff 不依赖 Git**；「未提交改动」审阅才需要 Git，非仓库、缺 Git 与远程项目都不显示入口。

不变量：缺失记录必须展示为警告，不能伪装成「没有改动」；落盘失败通过完成事件上报，不覆盖模型原先的结果。

### 2.2 dela 命令

领域能力的 CLI 门面。应用生命周期内一个本机 HTTP 桥（`127.0.0.1` 随机端口 + Bearer token），经 Pi 的 `shellCommandPrefix` 注入 bash，终端同样可用；`dela help` 列命令与 JSON Schema。

### 2.3 skills

领域知识与工具使用指引，Pi 按 Agent Skills 规范发现。七个内置 skill（shuiyuan / canvas / classroom / mail / todo / curriculum / document-reading）由应用写进 `~/.dela/skills` 并作为附加 skill 目录交给 Pi。

设置 › Skills 按来源分四组：内置、本机、每个 Pi package、每个本地项目。**开关的粒度不一样**——全局 skill 按名称记禁用，项目与包里的按 `SKILL.md` 绝对路径记，因为同名的可以共存且互不牵连。

`document-reading` 是唯一带依赖的 skill：它需要一套独立的 Python 环境（Windows 用 Python.org embeddable，Mac 用 python-build-standalone，均为 3.12.10；uv 固定，压缩包固定 SHA256），装进 `userData/components`，不要求系统 Python、Homebrew 或管理员权限。依赖只接受 PyPI 官方 wheels 与锁定 hashes，**禁止源码构建，也禁止 Agent 自行安装**。没装组件时设置页仍列出它，但显示关闭且不注入 Pi。

文档正文的读取交给外部 Python 脚本，主进程只负责取文件与工具路径，不解析 Office/PDF。输入副本与输出都在系统临时目录，用完显式释放，不写进用户项目。GUI 的 DOCX/XLSX/PPTX 预览是**另一条独立路径**，不复用这套。

### 2.3.1 Pi packages

Pi 社区的 package（扩展、skills、提示模板、主题）原样交给 Pi 加载；Dela 不重写解析、安装或扩展运行时。原则是**兼容优先、用户知情选择**：Dela 负责告知、来源展示、启停与卸载，不设沙箱、不做权限隔离，也不以安全为由缩减兼容范围。

要记住的几点取舍：

- 包的状态存在 `workspace_settings`，建会话时以内存设置交给 Pi，**不读写 Pi 自己的 settings.json**。首版只做全局范围，不加载项目 `.pi/settings.json` 声明的包。
- 会话用 Pi 默认的「信任项目」策略，Pi 会按 cwd 自动加载项目里的 `.pi/extensions`、`.pi/skills`、`.pi/prompts` 与 `.agents/skills`——这是接入 packages 之前就有的行为，**不经过 Packages 的启用开关**。
- 交给 Pi 的 `npmCommand` 必须是 npm 本身（`npm.cmd` / `bin/npm`）。Pi 按命令名识别包管理器，写成 `node npm-cli.js` 会识别失败。
- `AgentSession.dispose` 不发 `session_shutdown`（Pi 由 `AgentSessionRuntime` 发），Dela 直接持有 `AgentSession`，所以自己补发再 dispose，扩展靠它关掉子进程。应用退出在 `before-quit` 拦一次等收尾——**不能拦在 `will-quit`**，被拦下后 Electron 不再响应后续 `app.quit()`。
- 扩展代码与主进程同权限（见 §7）。

### 2.4 GUI

标签工作台（聊天 / 笔记 / 预览 / 审阅 / 终端），经 IPC 消费同一套领域实现。UI 组件以 vendored beautiful-ui 为基座（见其 [README](../src/renderer/components/ui/beautifului/README.md)），被替代的自研 UI 必须清理。

**标签规则**：所有「打开某样东西」的入口只决定打开什么、是否放到旁边；落在哪个组、是否预览只由 `workbench/open-target.ts` 决定，规则表写在该文件顶部并被测试逐条覆盖。要点：

- 已打开的标签去它所在的组聚焦，否则落焦点组。会话、终端、审阅是单例。
- 预览标签（VS Code 语义，组内至多一个）只用于**项目工作台**里的文件与资料，单击就地替换；编辑、双击、拖动、右键「保留」后转常驻。资料工作台与会话一律常驻。
- 「在旁边打开」落到焦点组右侧相邻的组，没有就向右分出一个空组。

**文件模型**：工作区只有 `folder / project / file / source` 四种条目，不区分「应用内笔记」与「外部文件」——笔记就是 `.md` 文件。格式判定只有一条规则且全线共用（本地工作区、远端、Agent 读取、聊天附件）：扩展名只用来挑专用查看器，其余按内容判定，**不维护文本扩展名白名单**。非 UTF-8 文本按二进制处理，防止按 UTF-8 读进来再写回把它写坏。

**不改原状**是编辑器的核心承诺：不做格式化，Markdown 始终是原文（不经 AST 往返序列化），换行符跟随文件首个换行，BOM 原样保留，保存原地覆写以保住可执行位、硬链接与符号链接。保存前比对内容哈希，外部改过就拒绝并保留草稿。

**通知边界**：瞬时动作的成功与失败走应用内浮窗；打开着的表单校验、持久态（连接红点、同步失败横幅、加载失败占位）与高频连续操作（终端）仍内联；后台自动动作失败只留日志，不打扰用户。

### 2.5 设置页

设置页只暴露具体、已实现的操作；renderer 不读取已存凭据或数据库。分区与分组的契约在 `shared/settings.ts`，通道由各域自己注册，偏好落在 SQLite `workspace_settings`。

几条跨分区的约定：

- 状态用颜色点表达（绿＝连接 / 使用中，灰＝未连接）；页面主操作用主色按钮。常驻能力整组说明一次，行内用锁徽标替代禁用开关。
- 条款页（隐私、使用）与引导的条款接受页共用 `components/legal-markdown.tsx`，正文是 `docs/terms.md` 与 `docs/privacy.md`，构建时内联，**三处不各抄一份**。改这个组件三处一起变。
- 写条款要避开 `。**你` 这类「加粗以中文标点收尾、紧跟汉字」的写法：CommonMark 不把该 `**` 当作闭合，只会渲染出字面星号（GitHub 同样如此）。把收尾标点移到加粗之外即可。
- 这两份文档**同时是官网 `/privacy`、`/terms` 的正文来源**（`../Dela_Web` 手抄一份，两仓库互不 import）。改这里就要同步改那边，包括顶部的「最后更新」日期。
- 搜索服务配置只保留脱敏条目给选择器与列表，完整密钥仅编辑弹窗可取；密钥是导入时的静态副本，供应商换 Key 不跟随。

**尺寸一律由 rem 派生**（字号设置会整体缩放文字、间距、图标与圆角）：禁止写死像素字号与宽高，换算基准固定 16。字号用 token，圆角用 beautifului 的 `rounded-*`。保留 px 的只有三类——边框/描边/阴影、媒体与容器查询断点、第三方 dist 内改不到的固定值；拖拽调宽的容器尺寸也是 px，因为它是用户用鼠标量出的画布尺寸。沙箱 iframe（邮件正文、水源楼层、Canvas 网页）是独立文档，rem 不继承外层，由 `lib/root-font-size.ts` 把根字号注进内层。

## 3. 会话与上下文

- **项目＝目录**：项目是 `kind='project'` 的 workspace 条目，身份是条目 UUID，目录是其 `local_path`；可在工作区内新建，也可导入电脑上已有的文件夹（留在原处，重命名 / 移动真的动磁盘）。远程项目的 `local_path` 是远端 POSIX 路径。
- **会话 cwd**：项目会话是该项目的目录，随聊是私有目录，资料页会话用课程目录。目录缺失时报错，**不静默换目录**。
- 会话的完整记录是 Pi JSONL，SQLite `sessions` 只是索引；renderer 看到的是 Pi 消息的投影。会话归属在创建时确定，不从当前工作台推断。
- **上下文是 pull 模型**：@ 引用是会话 cwd 下文件的绝对路径，模型自主 read。引用以 token 内联在文本里，因此没有数量上限；附件是另一套 count（上限 5）。
- **聊天文档附件**只传本地文件引用，由 document-reading skill 按需解析；二进制不按 UTF-8 注入提示词，不复制进项目。远端项目访问不到本机解析组件，发送文档附件会提示切换本机会话。
- **会话命令**（`/compact`、`/reload`、`/name`、`/new`）由 Dela 自己实现，Pi 的 slash command 只在它的终端界面里。优先级与会话命令同名的扩展命令不列进候选，自定义指令也不许与之同名。命令不是一轮对话，不写用户消息、不改标题、不记文件变化。
- 编辑重发在 Pi 会话树上分支，旧分支保留在 JSONL。

## 4. 远程项目

把远端 Linux 主机上的目录登记为项目。**本地内核 + 远程执行**：内核、模型密钥、会话 JSONL、skills 与系统提示都在本地，只有工具执行、终端、目录读取与文件预览落到 SSH 远端。

- **helper 是唯一通道**：工具调用、目录树、预览、上下文镜像、@ 候选与端口发现全部经远端 helper（`ssh -L` 隧道 + 远端 `127.0.0.1` 上的 HTTP），没有一次性 ssh 的退路。helper 是 Go 静态二进制，放在 `~/.dela/helper/<版本>-<sha8>/`，在远端常驻。端点、任务与生命周期规则见 [helper/README.md](../helper/README.md)。只支持 Linux amd64/arm64；`$HOME` 禁止执行（noexec、只读挂载、SELinux）的服务器不支持，向导会给出分类过的原因并停在「连接」。
- **ssh 的职责**收窄到引导 helper、连接自检、目录选择器首页的主目录解析与终端 `ssh -tt`。**System32 那份 OpenSSH 可能是旧版本**（Windows 本机实测 System32 为 9.5p2、Program Files 为 10.0p2），排障时先确认实际生效的是哪一个。
- **任务接回**：命令以任务运行，按客户端生成的 id 去重，断线后按字节偏移续读输出并拿到真实退出码。断线期间超出缓冲的部分接不回来，工具输出里会补一行说明。取消必须显式调用——断开连接已经不会终止任务。
- **路径归一化是最容易静默改错文件的点**：工具在调用 operations 前用宿主 `node:path` 解析参数，Windows 本机实测 `path.resolve('/home/u/proj','src/a.ts')` → `E:\home\u\proj\src\a.ts`。operations 只对 Windows 形态去盘符、转分隔符，原生 POSIX 路径不套用这些规则。
- **本地不碰远端路径**：远程项目内禁新建 / 重命名 / 移动，目录不进本地扫描也不 `fs.watch`。远端条目 id 是「项目 id + 远端路径」，两台连接上的同路径目录不会混。
- **认证**：Dela 不存任何口令，密钥走 ssh 自身的 `~/.ssh/config` 与 agent，主机指纹不自动接受。
- **ssh 一次调用一个子进程，没有多路复用**。并发握手太多时主机会直接断开，所以 `pnpm test:remote` 必须串行；App 侧日常调用都走 helper 的一条隧道，只有引导与重连才付 ssh 握手。
- 远端一个版本一个实例：重启与重连都复用它，升级 helper 版本才新起一个。多台电脑以同一 SSH 用户连同一台服务器时共用实例，任务互相可见。
- **不做**：远端文件写回与编辑器内保存；远端 PPTX 内嵌预览；远程会话里的 dela 校园命令；JS 扩展宿主；远端 MCP 端口转发。

## 5. 课堂视频

- 在线观看是常规功能，只受「导航入口」显示设置影响；下载属于试验功能，总开关与子项都开启才显示。水源同为试验子项（默认开启），关闭后 IPC、`dela` 命令、Skill、通知轮询与已打开的来源标签一并停用，绑定凭据保留。
- `main/vsjtu` 复用课表的加密校园会话，使用前探测身份，用户在官方窗口手动登录。在途请求合并，短暂网络失败与 408/5xx 延迟重试一次，登录失效或格式错误不重试。Cookie 与媒体签名留在 main。
- **官方成功空分页可能返回 `records: null`**：只有第一页、外层 `ok`/`dataOk` 均为真、总数与页数均为数字 0 时才当空数组；其余情况继续报错。后续页不能用零总数清空已取结果。
- 课程优先取本学期课表，**只有成功解析为空列表时**才补查官网「我的课程」的点播列表并按当前学期筛选。原课表非空不补查、不合并；失败就报错，不用备用来源掩盖。
- 在线播放走主进程代理，本次运行随机密钥签发 HMAC token，Range/HEAD 语义透传，媒体请求不携带校园 Cookie、不跟随重定向。已开始传输的流中断后**不支持无缝续接**，交由页面重试。
- 下载沿用 Electron `DownloadItem`，任务列表仅驻留内存，无跨重启续传；不合并、不转码、不依赖外部 FFmpeg。
- 文稿基础接口复用校园会话，返回带毫秒时间戳的原始识别文本；暂无文稿与请求失败分开处理。文稿只在内存中有限缓存，不自动写入用户目录；Agent 通过 classroom Skill 和 `dela` 命令按时间范围、字符分页读取，批量下载要求明确本机目录；语音页按需加载当前节次，搜索仅过滤展示，导出经系统保存对话框写入完整 TXT；时间戳驱动现有播放器定位。
- `records: null` 与备用来源这两条都是实测得到的行为，代码里只有 `if`，没有「服务器实际这么干」这个事实。

## 6. 应用内更新

Windows 与 macOS 共用一套：`electron-updater` + `electron-builder` 的 NSIS / DMG-ZIP，不自行实现版本比较、差分下载或安装器。其余平台直接返回 `unsupported`，不注册检查、不调用更新器。

- 更新源是自有 CDN 上的 Generic provider，读取 `latest.yml` / `latest-mac.yml`；客户端不解析下载页 HTML，固定 latest、拒绝预发布与降级。CDN 由独立侧同步，**CI 不持有 CDN 凭据**；同步时安装包与 blockmap 必须先于元数据就绪。
- 差分更新是尽力而为：缺少缓存、旧 blockmap 或差分失败都退回全量下载。SHA-512 校验由更新器完成。
- **进度 100% 只表示传输完成**，仍要等校验与安装准备，界面此时应显示「正在校验并准备安装」。总大小未知显示「—」，百分比向下取整，避免未完成时提前显示 100%。
- `autoDownload` 与 `autoInstallOnAppQuit` 都为 false：用户手动下载，下载完后自己选「退出并安装」或「下次启动时提醒」。推迟后手动安装要先清除推迟标记。安装前保存笔记、聊天草稿、邮件草稿与工作台布局；运行中的 Agent、未发送附件或保存失败都要阻止安装并保留确认入口。
- 安装调用 `quitAndInstall`，终端任务会结束且**不能恢复**。
- 更新后首次启动的「更新内容」弹窗（`renderer/features/release-notes/`）以 `?raw` 内联 `CHANGELOG.md`，取每个已发布版本的条目，跨版本升级合并显示区间内各版本。首次安装只记录不弹，冒烟模式不弹。**没有额外的小节或标记**——条目本身就是弹窗内容，这也是 CHANGELOG 要保持简短的原因。
- 尚未配置 Authenticode 签名。SHA-512 只验证文件与元数据一致，不能替代发布者签名。

## 7. 安全边界

诚实而非表演：给了 bash 就不设业务级守卫、无沙箱、无越权校验；skill 启停是引导层。

- 数据保存在本机 SQLite，凭据经 Electron `safeStorage` 加密。
- renderer 不接触文件系统、数据库与凭据，一切经受控 IPC 通信。
- Agent 的 bash 与文件工具即本机权限，不设沙箱。这是已知取舍，不是待修复的漏洞，也不要描述成安全隔离。
- Pi 的 auth / models / sessions / skills 放在 `userData/pi`，与用户的 `~/.pi` 隔离（bin 例外，见 §2.1）。模型密钥只在主进程内注册给 Pi 运行时，不写入 `auth.json`。
- 应用启动**不读取仓库 `.env`**，凭据只能在应用内配置。
- 已启用的 Pi package 扩展与主进程同权限，能读到上述一切。

## 8. 持久化

schema v6，迁移逐段演进：v1→v2 重建 `sessions`；v2→v3 加 `workspace_entries.remote_id` 与 `remotes` 表；v3→v4 给 `sessions` 加 `cwd`；v4→v5 建 `consent_records`；v5→v6 破坏性丢弃旧条目类型与导出关联（条目统一为 file，导出的 PDF 留在磁盘按普通文件出现）。

两条**不能简化掉**的历史包袱：

- 更早的旧世界库整库备份为 `dela-legacy-backup.db` 后重建，旧聊天与笔记记录不迁移。
- 旧世界自己用 v5–v15，撞上当前版本号的老库只看版本号的话既不会被拒绝也不会重建，只会留下缺表的库。所以旧世界判定与建表（含 `consent_records`）都**不放进版本闸门**，每次打开都幂等补建。

笔记即磁盘文件，不进数据库。

## 9. 终端

Git Bash + node-pty + xterm.js，与 Agent 的 bash 同源（同一份 dela 桥注入）。以下安装流程仅用于 Windows；macOS 固定用 `/bin/bash` 与 Unix PTY，不装 MinGit，不读用户的 Zsh 配置，不执行登录 shell 来取环境。

- **Git Bash 探测顺序：系统 Git for Windows → 随包 MinGit → 应用自装的 MinGit**，都缺失时明确报错，**不回退 PowerShell**。
- 随包 MinGit 由打包前脚本按源码里写死的版本与 SHA256 下载校验（版本定义只有一处），仓库不提交这份约 40MB 的产物。
- 一键安装只在系统没装 Git for Windows 时兜底：npmmirror 优先、GitHub 兜底，两者与官方发布物逐字节一致。MinGit 只以 `sh.exe` 名义带 bash 本体，安装时要复制出 `bash.exe`——**argv[0] 决定 bash 是否走完整模式**，而 `--rcfile` 注入 dela 桥依赖它。
- 远程项目的终端是本地 `ssh -tt` 申请远端 PTY，不注入 dela 桥，但可以让 ssh 自己问密码与指纹。

## 10. 仓库组织

单仓库、单 `package.json`（`pnpm-workspace.yaml` 只放 pnpm 设置，**不是** monorepo），三个进程分别构建：`src/main/`、`src/preload/`、`src/renderer/`，共享契约在 `src/shared/`，远端 helper 是 `helper/` 的 Go 模块（只依赖标准库），预编译产物在 `vendor/`。

目录清单见 [AGENTS.md](../AGENTS.md) 的文件树，那一份是权威。

按层约定：

- `src/main/` 按业务域分目录，每域一个入口（大域名 `api.ts`，其余 `index.ts`），IPC 注册在入口或并列的 `ipc.ts`。大域可以在同目录拆模块，但**入口仍是对外唯一 import 点**。根级只放不属于任何业务域的模块。
- 测试与被测代码同层：main 用各域的 `test/` 子目录，renderer 与 shared 与源码并排。
- `scripts/` 全部为 TypeScript（Node 原生执行，仓库不再有 `.mjs`），纳入 `pnpm typecheck`。

边界约定：renderer 不导入 main、不访问凭据和数据库；不引入 Manager/Service/Factory 等抽象层级，出现真实重复前不做提取；打包白名单只含 `out/**/*`、`package.json` 与品牌图——文档、凭据与 `.tools/` 都不进安装包。

## 11. 工具链与启动

| 工具    | 版本                               | 何时需要             |
| ------- | ---------------------------------- | -------------------- |
| Node.js | `.node-version`                    | 总是                 |
| pnpm    | `package.json` 的 `packageManager` | 总是                 |
| Go      | `go.mod` 声明 1.22，CI 固定 1.27.2 | 只在改远端 helper 时 |

CI 从上述文件读取固定版本，本地推荐与 CI 一致；`engines` 声明兼容范围，`engineStrict` 拒绝范围之外的版本。仓库本机把工具装在被 Git 忽略的 `.tools/` 中，当前会话启用：

```powershell
. ./scripts/use-local-tools.ps1
```

Apple Silicon 则把校验后的官方 Node 解压到 `.tools/`，保留原目录名，并将其 `bin` 目录前插 PATH，版本取自 `.node-version`。

- `allowBuilds` 里 `better-sqlite3: false`、`node-pty: true`——原生依赖用随包预编译产物，关闭源码重建。
- `postinstall` 先下载 Electron 运行时，再执行 `fix-native-permissions.ts`：后者**仅在 Darwin** 上给 node-pty 的 `spawn-helper` 补可执行位（包内原为 0644，会导致 `posix_spawnp failed`）。只改了 postinstall 脚本时需显式重跑，增量 install 可能不重新执行。
- `@earendil-works/*` 在 main 构建中保持 external、随 node_modules 打包进 asar；pi 系是纯 ESM，main 的 CJS 产物经动态 `import()` 加载。
- 安装包体积：`dependencies` 只留主进程运行时要加载的包（electron-builder 会把它连闭包原样收进 asar），渲染层依赖放 devDependencies——放错边等于把 npm 目录再装一遍。
- PDF.js 只是 renderer 的构建依赖；主进程不加载它，也不分发原生 canvas。

**引导与条款门**：顺序是 Intro → 条款接受页 → 五步向导 → 能力拓展 → 完成动画。

- **条款门对所有人成立**，只看有没有同意标记——否则「不同意并退出」再打开就绕过去了。
- 老用户的判据是「本次启动前就有数据库」或旧版引导痕迹。**不能拿「引导有没有开过头」反推**：上一版的 `started` 标记同样只在全新安装首次启动写入，老用户里也有一批只留下它，会把在用的人当成新装。反过来，全新安装在条款页点「不同意并退出」时要写一个 `declined` 标记（只对新装生效），否则下次启动数据库已存在，一次都没配置就被当成老用户丢进主界面。
- 门禁读 localStorage（同步、启动就能判），留证追加写数据库（文档名、正文顶部的日期、应用版本与时间，后两项由主进程盖章）。写失败只记日志、不拦用户；记录只追加不改写，因此「同意的是哪一版」可回溯。
- 「能力拓展」的版本标记落在 `workspace_settings`，只有主动提高版本才再次提醒，普通更新不触发；读取页面不写标记。
- 「导出本机数据」只给已经有本机数据的安装。数据库用 `VACUUM INTO` 取一致快照，其余文件是读取那一刻的样子；**符号链接一律跳过**——没有开发者模式时复刻链接直接 EPERM，会连累整个顶层条目一个文件都复制不出来。目标落在数据目录里面时直接拒绝。
- 「缓存占用」只认 Chromium 的缓存目录名，链接一律不跟，清除前后各量一次（差值为负时夹到 0）。导出本机数据跳过同一份名单。

改了 `helper/` 下的 Go 代码后执行 `pnpm build:helper --all` 重建两个架构并一并提交——只重建 amd64 会让仓库里的 arm64 停在旧版。

## 12. 常用命令

| 命令                                | 用途                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                          | 开发服务器 + 窗口，监听主进程 / preload 变更                  |
| `pnpm typecheck`                    | 四组 tsconfig（main / preload / renderer / scripts）类型检查  |
| `pnpm build`                        | 类型检查 + 三个入口生产构建                                   |
| `pnpm build:bundle`                 | 仅三个入口生产构建，供已单独检查类型的 CI 任务使用            |
| `pnpm check`                        | `format:check` + `lint` + `build` + `test`                    |
| `pnpm test`                         | Vitest 单元测试（不含真机远程套件）                           |
| `pnpm test:remote`                  | 真机远程回归：需 `DELA_REMOTE_HOST`，CI 不跑，必须串行        |
| `pnpm smoke`                        | Electron 冒烟：SQLite、React 渲染、Pi runtime 与 preload 隔离 |
| `pnpm smoke:runtime`                | 离线执行 Pi Bash/grep/find、真实 dela help 桥与平台工具定位   |
| `pnpm smoke:desktop`                | 原生菜单、关闭/恢复、取消退出后终端与命令桥存活               |
| `pnpm smoke:workspace`              | 工作区回归                                                    |
| `pnpm smoke:packages`               | Pi packages 回归：夹具包的安装、扩展运行与卸载，不联网        |
| `pnpm smoke:documents`              | Apple Silicon 文档组件真实安装与读取（显式联网、隔离数据）    |
| `pnpm smoke:pdf` / `smoke:shuiyuan` | PDF.js 阅读器 / 水源社区回归                                  |
| `pnpm smoke:remote`                 | 真窗口远程冒烟：需 `DELA_REMOTE_HOST`，可选 `DELA_REMOTE_KEY` |
| `pnpm build:helper`                 | 重建远端 helper 静态二进制（`--all` 含 arm64）                |
| `pnpm package:dir` / `package:dist` | 未安装的可执行目录 / 当前平台安装产物                         |

`pnpm smoke` 之外的冒烟脚本、打包后目录的 `--smoke-test`、终端与 agent 冒烟的具体跑法，直接看 `package.json` 的 `scripts`——那里是权威。冒烟使用独立测试目录与脱敏数据，除显式标注联网的（`agent-smoke`、`mingit-smoke`、`smoke:documents`）外不发送真实请求。

## 13. 提交前检查

```sh
pnpm format:check
pnpm lint
pnpm build
pnpm test
```

- 改动远端（`src/main/remotes/`、`helper/`）时另用 `pnpm test:remote` 对真机跑一遍，那批用例默认套件与 CI 都会跳过。
- 涉及构建、原生依赖或打包时另验证 `pnpm smoke` 与打包目录启动。
- 用户能感知的变化写进 [CHANGELOG.md](../CHANGELOG.md)；面向使用者的功能概览更新 [README.md](../README.md)；架构、取舍与平台状态变化更新本文。
- 单元测试只保留能挡住回归的用例：优先行为契约、边界与错误、安全、持久化/迁移、平台差异。不为字面默认值、setter/getter 往返、第三方库行为或纯 DOM 结构写用例；同一行为只留一处覆盖。
- UI 测试断言状态、动作与副作用，不锁具体措辞；只有条款/同意、危险操作确认与可访问性名称保留原文。

## 14. CI

`ci.yml` 负责变更检测、任务编排与结果汇总，通过 `workflow_call` 调用按职能拆分的文件；`pr-labels.yml` 管标签，`release.yml` 管发布。没有定时回归。

| Workflow              | 职责                                           |
| --------------------- | ---------------------------------------------- |
| `quality.yml`         | 格式检查，按需执行 lint、类型检查与 actionlint |
| `test.yml`            | Windows 应用构建与单元测试，上传 out 产物      |
| `helper.yml`          | Go vet/test、双架构构建，供 CI 与 Release 共用 |
| `desktop-windows.yml` | Windows 冒烟、目录包与安装包验证               |
| `desktop-macos.yml`   | macOS 冒烟、目录包与安装包验证                 |

- 分流按改动路径：纯文档不构建应用，workflow 改动额外跑 actionlint，应用源码与内置 Markdown 资源触发完整检查。精确规则以 `ci.yml` 的 filters 为准。
- 类型检查由 quality 执行一次；Windows 与 macOS 用 `build:bundle` 构建并分别运行测试，Windows 打包复用 test 的 out 产物。本地 `build`、`check` 与打包命令仍包含类型检查。
- 普通 CI 缓存 pnpm store，依赖安装仍使用 `--frozen-lockfile`；发布任务不使用依赖缓存。
- helper 被选中时平台任务必须等它成功并下载当次产物；**不能因为 helper 合理跳过就跳过平台任务**。
- `CI required` 始终汇总：被选中的必须成功，未选中的必须 skipped。入口不使用顶层路径过滤，否则文档 PR 的必需检查会一直 Pending。
- 路径分流可能遗漏隐含的平台依赖——新增运行时入口或资源目录时同步更新 filters。
- 真实 SSH 联调仍手动执行，不接入 CI。云端冒烟不能替代签名、公证与自动更新验收。

## 15. 版本与发布

### 升版

`pnpm version:patch` / `version:minor` / `version:major` / `version:bump <版本>` 只改 `package.json` 的版本，不建 commit / tag，也不推送。preload 在构建时内联版本号，升版后需重新构建。

安装包会带几类 `extraResources`，升级它们时各自按对应 README 的步骤做，并在打包目录里实跑一次验证：`vendor/openssh`（`ssh.exe -V` 与一次真实连接）、helper（发布与 CI 都从本次源码重建，避免发布旧产物）、`vendor/bin`（`rg.exe --version`、`fd.exe --version`）、MinGit（换版本只改源码里那对成对常量）。

### 发布

推 `v*` tag 触发 `release.yml`：`prepare` 解析 tag 的 SHA 并校验，Windows 与 Mac 并行构建验证，**双方都成功才**上传到草稿 Release 并公开；任一平台失败或等待环境批准都会阻塞发布。含预发布后缀的版本自动标记 prerelease。

发布保留两平台测试与产物验证，静态检查只在 Mac 的 `check` 中执行一次。`CI required` 会按路径跳过任务，因此不能用其成功结果替代全部发布检查。

- tag 必须等于 `v` + `package.json` 版本。
- 发版前把 `CHANGELOG.md` 的 `## Unreleased` 改成 `## <版本> - <发布日>`。更新内容弹窗只认 `## X.Y.Z - 日期` 分节，留在 `Unreleased` 下的条目会被静默跳过，弹窗不出现。
- 正式版必须提供 `latest.yml`，包内必须有 `resources/app-update.yml`。
- **重跑已有 tag**：上传用 `--clobber` 覆盖同名产物。正式分发后不要覆盖重建安装包——CDN 缓存可能与新元数据不一致；程序变更应升版发新 tag。
- Mac 签名需要在 Environments 里建 `macos-release` 并配置 Developer ID 证书与 Apple 公证凭据。

## 16. 平台基线

| 平台    | 最低系统基线 | 架构  | 产物               | GitHub runner  |
| ------- | ------------ | ----- | ------------------ | -------------- |
| Windows | Windows 10   | x64   | NSIS `.exe` 安装包 | `windows-2022` |
| macOS   | macOS 13.0   | arm64 | DMG / ZIP          | `macos-15`     |

以上是构建基线，不代表最低系统实机兼容性已验收；runner 是构建环境，与最低运行系统不同。

### 16.1 macOS 开发约定

只支持 Apple Silicon，不适配 Intel，不构建 Universal。保持一个应用、一个 package、一套主干代码：业务逻辑、数据格式与 IPC 共用，平台差异优先留在现有的进程启动、路径与系统交互函数里，出现真实重复和多个调用方后再提取。

几处平台差异记住结论即可，细节在代码里：

- PPTX 在 Mac 只提供「用系统默认应用打开」，不接 Keynote 或转换器；Windows 保留 PowerPoint 转换。
- VS Code 入口先查 PATH 的 `code`，再查应用包内的 CLI；未安装时明确提示。
- 路径归属按**路径格式**判断，不按宿主系统：Windows 盘符与 UNC 兼容大小写及两种分隔符，POSIX 逐字匹配并保留文件名里的反斜杠，避免大小写敏感卷上的不同项目相互干扰。
- 登录启动不使用 `openAsHidden`：Windows 传 `--hidden`，Mac 读 `wasOpenedAtLogin`。Mac 开关以系统实际状态为准，待批准也算未成功。
- 校园登录共用一套窗口创建逻辑：Mac 用带原生标题栏的子窗口（支持关闭按钮、Esc、⌘W），Windows 保留模态窗口。
- 快捷键的 `Mod` 在 Windows 为 Control、Mac 为 Command；Mac 的 Control 单独记为 `Ctrl`。系统菜单保留的组合（⌘Q、⌘H、⌘M 与原生编辑组合）有优先权，不建议录制为其他动作。

### 16.2 跨平台取舍

| 项目           | 当前处理                                      | 影响                                                                         |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| 核心业务       | 单应用、同一主干与 IPC，功能共用              | 新增系统调用、路径假设、外部程序依赖仍需双平台回归                           |
| 窗口与退出     | Mac 原生按钮与导航共用一行；两端关闭都隐藏    | 只有真正退出才结束终端；Mac 经 Dock 唤回                                     |
| Shell 与环境   | Mac 系统 Bash、SSH、Git；不执行用户登录 shell | 只写在 Zsh 初始化里的 SDK 环境不一定可见；暂不随包引入另一套 Bash/GNU 工具链 |
| PPTX 预览      | Mac 仅系统默认应用打开                        | Mac 不显示导出按钮，主进程提前拒绝转换                                       |
| Agent 文档读取 | 两端共用脚本与锁文件，安装器按平台选运行时    | 扫描件只输出页面图片，不宣称 OCR                                             |
| 分发与凭据     | 相同源码生成不同平台产物                      | 签名与公证已接入发布，Gatekeeper 首启与两版升级未验收                        |

**未验收**：Mac 的实际登录启动、系统级键位冲突、多显示器与动画表现；Windows 实机、真实 SSH 与 VS Code Remote-SSH 链路。模拟的平台分支测试不能替代实机回归。

### 16.3 macOS 本地验证

打包复用本机 Electron，不寻找签名身份、不发布：

```sh
pnpm build && pnpm smoke && pnpm smoke:runtime
pnpm smoke:desktop && pnpm smoke:workspace
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dist --mac --arm64 -c.electronDist=node_modules/electron/dist
node scripts/verify-macos-package.ts dist/mac-arm64/Dela.app
dist/mac-arm64/Dela.app/Contents/MacOS/Dela --smoke-test
```

冒烟也可以传入 `app.asar` 路径，用开发 Electron 加载包内代码与资源；实际 `.app` 另用 `--smoke-test` 检查。**这些检查不代表正式签名应用、全部账号业务或全部模型调用已验收。**
