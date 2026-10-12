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

- 单用户、单应用、单 package，仅 Windows（跨平台明确放弃）。
- 分发两条线：自建分发用 NSIS（`.exe`），商店分发用 `.appx` 包（提交 Partner Center，签名由商店完成，**尚未真实提交验证**）。应用内更新只对商店版生效。
- 无服务端，无账号系统。模型服务与检索 API 都由用户自己配置。
- **固定约束**：交大 jAccount 开放平台的 `client_id` 已停止申请，不存在取得途径。凡是需要官方 jAccount 授权的方案都不可行；现有能力走 Canvas Personal Token、邮箱 IMAP/SMTP、致远一号 API 与个人会话型接口。

## 2. 分层架构（建设顺序＝依赖方向，自下而上）

### 2.1 内核＝Pi Coding Agent（冻结）

`@earendil-works/pi-coding-agent` SDK 的 `createAgentSession` 就是 agent 内核。会话树（JSONL）、多轮工具上下文、自动压缩、重试、`AGENTS.md` 上下文文件、skills 发现与渐进加载都由 Pi 承担，Dela 不另写执行循环、上下文组装或压缩。

| 工具                       | 来源                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| read / write / edit / bash | Pi 内置，cwd＝会话所属项目目录；bash 用 Git Bash（与终端同源），不可关闭                                                        |
| grep / find / ls           | Pi 内置；首次使用时 Pi 自动下载 rg/fd（待验证离线体验）                                                                         |
| web_search / web_fetch     | Dela 自定义工具；web_search 默认关闭（要自备搜索服务），web_fetch 默认开启；搜索服务在「网络」域注册（Brave / Google / 自定义） |
| MCP 工具                   | Dela 连接 stdio 服务器后作为自定义工具注入                                                                                      |

目录注意：rg/fd 落在 `~/.pi/agent/bin`，**不是** `userData/pi/bin`——Pi 只读 `PI_CODING_AGENT_DIR` 环境变量，Dela 不设置它。同理，Pi 的默认 skills 位置 `~/.pi/agent/skills` 也仍被扫描。`userData/pi` 里隔离的是 auth、models 与 sessions，不是 bin 与默认 skills 目录。

`web_fetch` 的 HTML 转换使用纯 JS `@mdream/js`，保留 Markdown 结构、解析相对链接；仅过滤导航、页脚与非正文标签。PDF、编码处理、2MB 上限与 offset 续读沿用现有实现；不执行网页 JavaScript。`web_search` 由用户提供搜索服务。

### 2.2 dela 命令

领域能力的 CLI 门面。应用生命周期内一个本机 HTTP 桥（`127.0.0.1` 随机端口 + Bearer token），经 Pi 的 `shellCommandPrefix` 注入 bash，终端同样可用；`dela help` 列命令与 JSON Schema。

### 2.3 skills

纯文档领域知识，Pi 按 Agent Skills 规范发现。五个内置领域 skill（shuiyuan / canvas / mail / todo / curriculum）写进 `~/.dela/skills` 并作为附加 skill 目录交给 Pi；设置页的禁用名单经 `skillsOverride` 过滤。扫描位置共三处：`~/.dela/skills`、`~/.agents/skills`、`<userData>/workspace/.agents/skills`。

### 2.4 GUI

标签工作台（聊天 / 笔记 / 预览 / 终端），经 IPC 消费同一套领域实现。UI 组件统一以 vendored beautiful-ui 为基座（见其 [README](../src/renderer/components/ui/beautifului/README.md)），被替代的自研 UI 必须清理。

设置页语义约定：

- 状态用颜色点表达（绿＝连接 / 使用中，灰＝未连接）；页面主操作用主色（default）按钮。
- 常驻能力整组说明一次，行内用锁徽标替代禁用开关。
- Skills 行支持查看 `SKILL.md` 与打开所在位置（`capabilities:read-skill` / `reveal-skill`，主进程按名单独解析路径，渲染端不传路径）。
- 隐私页按文档排版（限宽、13px 正文、枚举两列表）。

瞬时动作失败的报错走应用内通知浮窗（`app/toasts.tsx` 的 `showToast`，内容区顶部居中滑入，error / success 变体，卡片为 beautifului `atoms/Toast.tsx`；error 8s / success 4s 自动消失，至多 4 条）；表单校验与持久态错误仍内联展示，不进浮窗。

## 3. 会话与上下文

- **项目＝目录**：项目是 `kind='project'` 的 workspace 条目，身份是条目 UUID，目录是其 `local_path`；目录可在工作区内新建，也可导入电脑上已有的文件夹（留在原处，重命名 / 移动按同一套语义真的动磁盘）。远程项目的 `local_path` 是远端 POSIX 路径，本地没有这份目录（见 §4）。
- **会话 cwd**：项目会话是该项目的目录；通用（随聊）会话是 `<userData>/chat-sessions/<会话 id>` 私有目录；资料页会话用 `<userData>/courses`；`sessions.cwd` 为 NULL 的旧会话才回退到工作区根。目录缺失时报错，不静默换目录（远程项目跳过本地存在性检查）。
- 会话的完整记录是 Pi JSONL（`userData/pi/sessions`），SQLite `sessions` 只是索引（项目归属、标题、置顶、归档、cwd、文件路径）。renderer 看到的 `WorkspaceChat` 是 Pi 消息的投影（`main/agent/session.ts`）。
- 会话归属在创建时确定，ChatTab 从会话快照取 projectId/cwd，不取当前工作台。
- **上下文是 pull 模型**：@ 引用是会话 cwd 下文件的绝对路径，模型自主 read；附件文本与图片随用户消息进入 Pi 会话。引用以「@相对路径」token 内联在 composer 文本里（发送前经 `content/chat/reference-tokens.ts` 解析回绝对路径，未命中的 @文本只是正文），因此引用无数量上限；拖入 / 粘贴附件维持在 composer 上方 chips、上限 5，与引用分开计数。
- **上下文占用**：快照与流式事件携带 `contextUsage`（Pi `getContextUsage` 的投影，仅打开中的会话有）；composer 底部圆环按占用显示进度，悬浮面板报 tokens、窗口总量、百分比与本会话缓存命中率。压缩后 tokens 未知时显示「—」。
- 系统提示＝Pi 默认提示 + Dela 追加段（dela 命令说明、项目名与目录、用户自定义指令）。
- 编辑重发在 Pi 会话树上分支，旧分支保留在 JSONL。
- 自定义 OpenAI 兼容网关的 API 根由模型列表端点探测决定（`{base}/v1/models` 应答则根为 `{base}/v1`；网关把控制台首页以 200 返回时不算命中）；检测回传校正地址，表单直接采用。密钥留空一律沿用已存值，改地址不要求重填。

## 4. 远程项目

把远端 Linux 主机上的目录登记为项目。**本地内核 + 远程执行**：内核、模型密钥、会话 JSONL、skills 与系统提示都在本地，只有工具执行、终端、目录读取与文件预览落到 SSH 远端（`src/main/remotes/`）。

- **传输**：`transport.ts` 是一次性 ssh 的唯一边界，全部走 `ssh <host> <script>`，不引入 SFTP。系统 OpenSSH 优先、`vendor/openssh` 兜底（自带 `ssh.exe` + `libcrypto.dll` 经 `extraResources` 进 `resources/openssh`）。探测顺序是 System32 → Program Files → 自带目录；**System32 那份可能是旧版本**（本机实测 System32 为 9.5p2、Program Files 为 10.0p2），排障时先确认实际生效的是哪一个。一次调用一个 ssh 子进程，实测每次 0.3–0.6 秒。
- **helper 通道**（日常路径）：`ssh -L` 隧道 + 远端 `127.0.0.1` 上的 HTTP。helper 是一个 Go 静态二进制，Dela 把它放到 `~/.dela/helper/<版本>-<sha8>/` 再启动。建好之后不再付握手钱（列目录实测 28 ms vs 310 ms）。端点、心跳与生命周期规则见 [helper/README.md](../helper/README.md)。
- **工具**：read / write / edit / bash / ls / find 复用 Pi 的工具定义、只换 `operations`；grep 在 Pi 内部固定 spawn 本地 rg，故保留其 schema 与描述、自写 execute 在远端搜（rg 缺失时退回 `grep -rnH`）。同名自定义工具覆盖内置（`agent-session.js` 注册表后写覆盖），因此这七个名字**不能**进 `excludeTools`。
- **路径**：会话 cwd 就是远端 POSIX 绝对路径；工具传来的路径先经 `remotePath` 还原（Windows 会把 `/root/x` 解析成 `\root\x`）。远端上下文镜像到 `<userData>/remote-context/<remoteId>/<projectId>/`，`remotePath` 是唯一收口——七个工具（含 grep）的全部路径入口自动生效。
- **本地不碰远端路径**：`projectLocation` 分远程分支，`entry()` 拒绝远端路径，远程项目内禁新建 / 重命名 / 移动，目录不进本地扫描也不 `fs.watch`。远端条目 id 是「项目 id + 远端路径」，两台连接上的同路径目录不会混。远端目录的变化由 helper 的 inotify 事件流推给目录树（只监视展开的那几层）。
- **认证**：Dela 不存任何口令；密钥走 ssh 自身的 `~/.ssh/config` 与 agent，密码只在交互终端里由 ssh 询问。连接自检 `ssh -o BatchMode=yes -o ConnectTimeout=10 <dest> true`，主机指纹不自动接受。
- **降级**：helper 起不来时（服务器禁执行 `noexec`、只读挂载、SELinux 拦截）自动分类原因并退回一次性 ssh，向导日志与目录树都显示人话文案。降级后端口预览与远端改动实时刷新不可用，其余功能照常。
- **不做**：远端笔记写回与编辑器内保存；远端 PPTX 内嵌预览（下载后用 PowerPoint 打开）；远程会话里没有 dela 校园命令；JS 扩展宿主；远端 MCP 端口转发。

开发注意（真机踩过的坑）：

- 连接是「一次调用一个 ssh 子进程」，没有多路复用。短时间并发握手太多时主机会直接断开（`Connection closed by <host> port 22`），并行跑多个真机测试文件就会偶发；`pnpm test:remote` 因此要串行（`--fileParallelism=false`）。App 侧一次工具调用只有一条连接，但模型并发发起多个工具调用时可能撞上主机的 MaxStartups。
- `sshBaseArguments` 统一带 `ServerAliveInterval=15`、`ServerAliveCountMax=3`：一次 10 分钟无输出的远端命令会被对端 reset（`clientaliveinterval 0` + 客户端不发保活，中间的 NAT/防火墙丢连接）。心跳同时是隧道的保活包。
- **路径归一化是最容易静默改错文件的点**：工具在调用 operations 之前用宿主 `node:path` 解析参数，本机实测 `path.resolve('/home/u/proj','src/a.ts')` → `E:\home\u\proj\src\a.ts`。operations 必须先去盘符前缀、再把 `\` 换成 `/`、合并重复斜杠后才拼命令。
- 快速反复重启会在远端留几个「过期」helper：Dela 退出不发退出请求，旧实例带着过期 token 最多再活 5 分钟，拿不到请求，只是占位进程。
- 多通道没有空闲回收，也没有条数上限：一个会话里用到过几个连接，就各留一条通道与一个远端 helper（各带自己的心跳），直到应用退出全部关掉。上界通常是个位数。

## 5. 课堂视频（试验）

- 侧栏「课堂视频」入口（水源上方）随试验开关显隐：试验功能为「总开关 + 子项」结构（设置 › 通用，两者都默认开启），「课堂视频」是当前唯一子项，任一关闭即隐藏入口（`renderer/features/settings/experimental` 为侧栏、设置区与页面共用的开关镜像）。
- `renderer/features/classroom` 为可折叠课程侧栏 + 播放器两栏（无页头；侧栏与资料面板同款：inset 底、紧凑头、可拖宽度、折叠态在播放器标题行给展开钮），支持选课选场次、在线播放、拖拽进度、音量与倍速、多画面切换及原始下载（下载默认目录写入 `video-download-directory` 键，空值即由系统保存对话框决定）。
- 主进程门禁检查两个开关的与：未开时拒绝新的登录、查询、播放与下载操作，已有下载仍可查询、取消或打开位置。键缺失或损坏都视为开启。
- `main/vsjtu` 复用课表的加密校园会话，使用前探测身份；用户在官方窗口手动登录。相同 API 的在途请求合并，短暂网络失败、超时与 408/500/502/503/504 延迟 250ms 后重试一次，登录失效或数据格式错误不重试。Cookie 与媒体签名留在 main。
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

只走微软商店：`StoreContext` 的检查 / 下载 / 安装 API 由商店校验并安装，签名问题随之消失；不自建 appcast，也不引入 `electron-updater`。

- **分三步而非官方示例的一步式**：先下载、再按用户动作安装。一步式调用时 `PackageDownloadProgress` 从 0.0 到 0.8 是下载、0.8 到 1.0 才是安装，直接映射进度条会卡在 80%；拆开还把重启时机留给用户：下载完成弹一个应用级确认框，让用户选「现在安装」还是「下次启动时提醒」。进度取 `TotalDownloadProgress`——按包上报的 `PackageDownloadProgress` 在多包更新时每个包都从 0 重来。
- **原生模块** `native/store-update/`（C++/WinRT + N-API，`pnpm build:native`）只做四件事：校验包标识、给 `StoreContext` 绑属主窗口（不绑会拿到 0x80070578）、发起检查 / 下载 / 安装、把 WinRT 的进度与错误翻成普通对象。失败一律 resolve、不跨边界抛异常；`RequestDownload*` 必须在 UI 线程调用。
- **权威状态机在主进程**（`main/update/state.ts` 是纯函数）：下载可能持续几分钟，而设置页随时会被关掉。结果事件只在对应的进行中阶段生效；重复开始事件保持原状态，IPC 根据状态对象是否改变决定是否调用原生模块。下载和安装失败后允许重试原步骤；渲染层只读快照、只派发动作。
- **通道判据**是 `process.windowsStore`（等价于进程有包标识）；NSIS 安装版与开发运行只得到「前往商店」。
- 检查入口有两处，读主进程的同一份快照：设置 › 通用 的「软件更新」行，与标题栏左侧最右端的 `circle-arrow-up` 提示（只在可下载 / 下载中 / 待安装时亮）。主进程每两小时后台查一次、启动后 30 秒先查一次，且只在商店版与窗口已就位时查。
- 安装会让系统结束 Dela 且不保证自动重启。界面在安装前统一保存已打开笔记、聊天文字草稿、邮件草稿与**工作台布局**；富文本先回传正文，保存期间阻止编辑，任一步失败都不安装。运行中的 Agent、未发送聊天附件及图片阻止安装；终端进程无法恢复。
- 用户选「下次启动时提醒」就落盘待装标记（`workspace_settings` 的 `pending-install`），下次启动 5 秒后检查并下载，完成后再次提示确认，**绝不自动安装**；准备更新前消费标记，手动安装前也清除标记。
- **未验证**：Dela 尚未上架商店，进程真有包标识时商店调用的真实返回没有实测过。

## 7. 安全边界

诚实而非表演：给了 bash 就不设业务级守卫、无沙箱、无越权校验；skill 启停是引导层。保留进程级基本边界：renderer 隔离、凭据不进 renderer、preload 有限暴露。

- 数据保存在本机 SQLite，凭据经 Electron `safeStorage` 加密（`src/main/credentials.ts`）。
- renderer 不接触文件系统、数据库与凭据，一切经受控 IPC 通信。
- Agent 的 bash 与文件工具即本机权限，不设沙箱。
- Pi 的 auth / models / sessions 放在 `userData/pi`，与用户自己的 `~/.pi` 隔离（bin 与默认 skills 目录除外，见 §2.1）；模型密钥只在主进程内注册给 Pi 的运行时，不写入 `auth.json`。
- 应用启动**不读取仓库 `.env`**，凭据只能在应用内配置。

## 8. 持久化

schema v4。迁移是逐段演进：v1→v2 只重建 `sessions`，删除 `runs` 与 `projects`（会话不迁移）；v2→v3 只加 `workspace_entries.remote_id` 并建 `remotes` 表（旧条目一律视为本地项目）；v3→v4 给 `sessions` 加 `cwd` 列。更早的旧世界库整库备份为 `dela-legacy-backup.db` 后重建，旧聊天与笔记记录不迁移。

表：`workspace_settings`、`workspace_entries`、`remotes`、`sessions`（索引，含 `cwd`、`message_count`），以及领域缓存（mail 三表、timetable 两表、`calendar_events`、canvas 两表、`shuiyuan_topics`、`todo_items`、notifications 两表）。笔记即磁盘文件。

## 9. 终端

与 Bash 同源：Git Bash + node-pty（ConPTY）+ xterm.js，实现参考 VS Code / Hyper；dela 桥函数同样注入项目终端。本机须装 Git for Windows，缺失时明确报错（`locateBash()`），**不回退 PowerShell**。

远程项目的终端是本地 `ssh -tt` 申请远端 PTY，远端不需要 node-pty；该终端不注入 dela 桥，但可以让 ssh 自己问密码与主机指纹。

## 10. 仓库组织

单仓库、单 `package.json`，三个进程分别构建：

- `src/main/` — 主进程，按业务域分目录（`mail/`、`canvas/`、`timetable/`、`workspace/`、`shuiyuan/`、`remotes/`、`vsjtu/`、`update/`、`settings/` 等，每域 `api.ts` + `ipc.ts`）。`agent/` 为 Agent 基座：`pi.ts`（Pi SDK 接线与模型注册）、`session.ts`（会话索引、事件投影与 ask）、`environment.ts`（追加提示、dela 桥、skills、MCP 与联网工具）、`commands.ts` + `domain/`（dela 命令）、`index.ts`（`capabilities:*` 与 `chat:*` 通道注册）、`providers.ts`、`skills.ts`、`mcp.ts`、`tools.ts`（内置能力开关）、`media.ts`、`chat-commands.ts`、`web-fetch.ts`、`web-search.ts`、`tools/`（自写工具）。根级有数据库、凭据、终端、搜索、通知等共用模块。
- `src/preload/` — contextBridge：`index.ts` 聚合入口 + 分域文件，只暴露受控 API。
- `src/renderer/` — React 界面：`app/`（装配与视图路由）、`workbench/`（标签工作台与布局树）、`content/`（chat / note / preview / review / terminal 标签内容）、`navigation/`、`sessions/`、`workspace/`（镜像与草稿）、`features/`（mail / timetable / shuiyuan / todo / notifications / onboarding / search / settings / classroom 整页视图）、`lib/`、`styles/`；共享组件在 `components/ui/`，样式用 Tailwind v4 + 语义 token。
- `src/shared/` — 进程间共享的 IPC 契约与纯函数（`api.ts` 聚合 re-export）。
- `native/` — 原生模块（目前只有 `store-update/`），用 `pnpm build:native` 单独构建，与上面三个进程的构建互不影响。
- `helper/` — 远端工具服务的 Go 模块，只依赖标准库。
- 测试放在各级 `test/` 子目录，`scripts/` 存放开发服务器与冒烟脚本。

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
- `pnpm-workspace.yaml` 只放 pnpm 12 的项目设置（`saveExact`、`engineStrict`、`allowBuilds` 门控），**不是** monorepo：没有 `packages` 字段，也没有子包。注意 `allowBuilds` 里 `better-sqlite3: false`、`node-pty: true`——原生依赖用随包预编译产物，关闭源码重建。
- `pnpm install` 会通过 Electron 提供的 `install-electron` 命令下载运行时（`postinstall`）。
- `@earendil-works/*`（pi-coding-agent / pi-agent-core / pi-ai / pi-mcp）在 main 构建中以正则保持 external、随 node_modules 打包进 asar；pi 系为纯 ESM 包，main 的 CJS 产物经 `agent/pi.ts` 动态 `import()` 加载。
- `@napi-rs/canvas` 在 `vite.main.config.ts` 标记 external 并加入 electron-builder `asarUnpack`。
- 运行时依赖 Git for Windows：内核 Bash 工具与内置终端统一使用 Git Bash，缺失时明确报错。
- 首启引导只由 `userData/dela.db` 是否存在决定：首次跑完即不再重播，开发模式也一样。URL 加 `?smoke-test=1` 可短路引导；冒烟会另开临时 profile。
- 远端 helper 的静态二进制已入库在 `vendor/dela-helper/`，日常开发不需要 Go；改了 `helper/` 下的 Go 代码后执行 `pnpm build:helper --all` 重建 amd64 与 arm64 两个产物并一并提交——只重建 amd64 会让仓库里的 arm64 停在旧版（发布时 CI 会覆盖，但本地对 arm64 远端的测试用的是旧版）。

## 12. 商店更新的原生模块

`native/store-update/` 是 C++/WinRT 写的 N-API 插件，调用 `Windows.Services.Store` 让微软商店替 Dela 校验并安装更新。它不在 `pnpm build` 覆盖范围内：

- 构建用 `pnpm build:native`：`scripts/build-native.mjs` 找出版本最高、且带 `cppwinrt\winrt\Windows.Services.Store.h` 的 Windows SDK，把 SDK 头目录经 `DELA_WINRT_INCLUDE` 注入，再让 `node-gyp` 调 MSBuild，产物拷到 `out/native/store_update.node`。
- `native/store-update/binding.gyp` **显式配置**了 `AdditionalIncludeDirectories`（`$(DELA_WINRT_INCLUDE)` 与 `$(WindowsSdkDir)Include\$(WindowsSDKVersion)cppwinrt`），不是依赖 MSBuild 的默认包含路径。
- 本机需要 Visual Studio 2022 的 C++ 生成工具与该 SDK；不需要 NuGet 包，也不需要为 Electron 重编（N-API 的 ABI 是稳定的）。
- `electron-builder.yml` 的 `asarUnpack` 把它放到 `app.asar.unpacked`；Electron 会把 asar 内的 `dlopen` 路径重定向过去，因此 `src/main/update/native.ts` 直接按 `__dirname/../native` 拼路径即可（打包布局已实测）。
- 商店对检测接口限流：30 分钟内最多一次、24 小时最多十次，**超限返回上一次结果而不是报错**，所以连点检查可能拿到陈旧结论。两小时一次加启动那次，挂满一天约 13 次，会略微越过上限；要严格守住就把间隔改成三小时（一天 8 次）。

## 13. 常用命令

| 命令                                            | 用途                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                                      | 启动开发服务器和窗口，监听主进程 / preload 变更                    |
| `pnpm typecheck`                                | 三组 tsconfig 的类型检查                                           |
| `pnpm build`                                    | 类型检查 + main / preload / renderer 三入口生产构建                |
| `pnpm build:native`                             | 构建商店更新的原生模块到 `out/native/`（需 VS 2022 C++ 工具链）    |
| `pnpm build:helper`                             | 重建远端 helper 的静态二进制（`--all` 含 arm64）                   |
| `pnpm start`                                    | 启动已构建产物                                                     |
| `pnpm check`                                    | `format:check` + `lint` + `build` + `test` 的组合检查              |
| `pnpm format` / `pnpm format:check`             | Prettier 格式化 / 检查                                             |
| `pnpm lint`                                     | Oxlint（TypeScript 正确性、未使用代码、React Hook 规则）           |
| `pnpm test`                                     | Vitest 单元测试（不含真机远程套件）                                |
| `pnpm test:remote`                              | 真机远程回归：需 `DELA_REMOTE_HOST`，CI 不跑，需串行               |
| `pnpm smoke`                                    | Electron 冒烟：SQLite、React 渲染、Pi runtime 与 preload 隔离      |
| `pnpm smoke:workspace`                          | 工作区回归                                                         |
| `pnpm smoke:pdf`                                | PDF.js 阅读器回归                                                  |
| `pnpm smoke:shuiyuan`                           | 水源社区回归                                                       |
| `pnpm smoke:remote`                             | 真窗口远程冒烟：需 `DELA_REMOTE_HOST`，可选 `DELA_REMOTE_KEY`      |
| `pnpm exec electron scripts/terminal-smoke.cjs` | 内置终端回归（Git Bash、多会话、选取复制）                         |
| `pnpm exec electron scripts/agent-smoke.cjs`    | Agent 基座回归：需 `DELA_SMOKE_BASE_URL/API_KEY/MODEL`，发真实请求 |
| `pnpm package:dir`                              | 生成未安装的可执行目录                                             |
| `pnpm package:dist`                             | 生成 Windows 安装包                                                |

打包目录可运行 `dist/win-unpacked/Dela.exe --smoke-test` 做与 `pnpm smoke` 相同的检查；终端冒烟加 `dist/win-unpacked/resources/app.asar` 参数可验证包内资源。冒烟脚本使用独立测试目录与脱敏数据；除 `agent-smoke` 外不发送真实请求。

真机远程测试的跑法：

```powershell
. ./scripts/use-local-tools.ps1
$env:DELA_REMOTE_HOST='root@…'
pnpm test:remote
```

## 14. 提交前检查

改动后至少运行与其相关的检查（完整约束见 [AGENTS.md](../AGENTS.md)）：

```sh
pnpm format:check
pnpm lint
pnpm build
pnpm test
```

- 改动远端（`src/main/remotes/`、`helper/`、连接与上下文镜像）时，另用 `pnpm test:remote` 对着真机跑一遍：那批用例需要 `DELA_REMOTE_HOST`，默认套件与 CI 都会跳过它们（`vitest.remote.config.ts`）。
- 涉及构建、原生依赖或打包时，另验证 `pnpm smoke` 与打包目录启动。
- 改动 `native/` 时另跑 `pnpm build:native`，并确认打包后的 `dist/win-unpacked/resources/app.asar.unpacked/out/native/` 里有对应 `.node`（CI 有同样的检查）。
- 重要改动同步更新 [CHANGELOG.md](../CHANGELOG.md)；面向使用者的变化更新 [README.md](../README.md)；架构与流程变化更新本文。

## 15. CI

`.github/workflows/check.yaml` 在 PR 创建、更新、重新打开及 push 到 `main` 时运行，job 名 `Check win-x64`：

- 应用只构建 Windows x64（`windows-2022`），与发布一致的 runner 和固定 Node / pnpm 版本。
- helper 任务名即 `Check helper linux (amd64 + arm64)`，在 `ubuntu-24.04` 用 Go 1.27.2 执行 `go vet`（含交叉 `linux/arm64`）、`go test`、构建两个架构的静态产物并跑 `--version`（arm64 走 qemu 用户态仿真）。Windows 任务下载当次产物用于打包，并逐字节核对打包后的文件。
- 执行冻结锁文件安装、`pnpm format:check`、`pnpm lint`、`pnpm build`（含类型检查）、`pnpm test`、`pnpm smoke`、`pnpm build:native`、应用目录打包、包内原生模块检查及打包后冒烟。**CI 是分步执行这些命令，不是调用 `pnpm check`。**
- Go 测试只使用 runner 本机临时目录、inotify 与回环 HTTP，不连接 SSH。Windows 任务明确留空 `DELA_REMOTE_HOST`，真实 SSH 联调继续手动运行，不作为发布前置条件。
- 检查不生成安装包、不发布 Release，仅使用 `contents: read` 权限；同一 PR 或 main 分支的新提交会取消旧检查。

若要限制合并，需在 GitHub 的 main 分支规则中将 `Check win-x64` 设为必需检查——仅添加 workflow 不会自动启用分支保护。

## 16. 版本与发布

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
- 安装包也会带上 helper（`extraResources` 拷到 `resources/dela-helper`）。CI 与发布从本次源码构建 Linux amd64 与 arm64 产物（`build-helper.mjs --all`），覆盖仓库中的预编译文件后打包，避免发布旧 helper。预编译文件仍保留供无 Go 的本地开发者使用；升级 helper 时同步 Go 与 TS 两端的版本常量。

### 发布

`.github/workflows/release.yml` 在推送 `v*` tag 时构建并发布 GitHub Release：

1. 先提交版本号和代码，再执行 `git tag v0.1.0 && git push origin v0.1.0`；tag 必须等于 `v` + `package.json` 的版本。
2. Linux helper 任务测试并构建该 tag 对应的源码；Windows 任务下载其产物，执行锁文件安装、类型检查与生产构建、原生模块构建、单元测试、Electron 冒烟、NSIS 构建、包内 helper 一致性与原生模块存在性检查、打包目录启动检查。全部成功后创建 Release 并上传 `.exe`。
3. 含预发布后缀的版本（如 `0.2.0-beta.1`）自动标记为 prerelease。
4. 也可在 Actions → Release installers → Run workflow 中手动填入已有 tag 构建发布。

`prepare` 与 `release` 任务是 Ubuntu runner，只做校验与 `gh` 上传，不构建应用；发布 job 会把 release notes 作为 artifact 上传，供 `publish-public` 复用，后者同样跑在 `ubuntu-24.04`。release 工作流的 `concurrency` 设了 `cancel-in-progress: false`，与 CI 相反。

**重跑已有 tag**：私有与公开仓库已存在的 Release 不会被重建，而是以 `gh release upload --clobber` 覆盖同名安装包后重新公开。因此为历史 tag 补发可直接重跑。

**公开镜像**：私有 Release 发布成功后，同一工作流会把同一批安装包和完全相同的 release notes 再发布到公开仓库 [Chang-Yo/Dela_releases](https://github.com/Chang-Yo/Dela_releases) 的同名 tag Release。公开仓库中的 tag 由 GitHub 自动创建在其默认分支最新提交上，仅作发布锚点，不对应源码。

首次使用前的准备：

1. 公开仓库已有初始提交（例如 README）。
2. 在本仓库 Settings → Secrets and variables → Actions 配置 `PUBLIC_RELEASE_TOKEN`：仅授权 `Chang-Yo/Dela_releases`、权限 Contents: Read and write 的 fine-grained PAT——内置 `GITHUB_TOKEN` 无法跨仓库发布。

## 17. 通过 Partner Center 提交商店包

发布流水线在 NSIS 之后额外产出商店提交包，作为 Actions artifact `store-package-win-x64` 上传（`build` 任务末尾），不随 Release 发布。

```sh
pnpm exec electron-builder --win appx --x64 --prepackaged dist/win-unpacked --publish never
```

本地要复现需先跑一次 `pnpm exec electron-builder --dir --x64` 得到 `dist/win-unpacked`。

1. `electron-builder.yml` 的 `appx` 块按 Partner Center 应用概览 → 产品管理 → View app identity details 填好三项：`identityName`（Package/Identity/Name）、`publisher`（Package/Identity/Publisher，形如 `CN=<GUID>`）、`publisherDisplayName`（Package/Properties/PublisherDisplayName）。三项必须逐字一致，大小写与标点都要对，否则商店拒收；在 Partner Center 改名后要同步这里。见 [View product identity details](https://learn.microsoft.com/en-us/windows/apps/publish/view-app-identity-details) 与 [App package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)。
2. 推送 `v*` tag 或手动重跑工作流，产出 `Dela-<版本>-win-x64.appx`。
3. 从该次运行的 Artifacts 下载 `store-package-win-x64`。
4. 在 Partner Center 提交的 Packages 页上传该文件。

### 提交前必须做

- **版本号第一段不能为 0。** 清单 `Identity/@Version` 由 `package.json` 版本补成四段（实测 `1.0.0` → `1.0.0.0`）。官方规则：最后一段必须为 0，其余各段取 0–65535，例外是「the first section, which cannot be 0」，对 `.msix` / `.appx` 同样适用。版本若回落到 `0.x` 会重新触发限制。Partner Center 对这条的执行严格程度属待验证。
- **包内图标用 Dela 自己的。** `build/appx/` 下的文件按文件名逐字被采用：`StoreLogo.png`、`Square44x44Logo.png`、`Square150x150Logo.png`、`Wide310x150Logo.png` 是模板清单引用的四个槽位（electron-builder 按文件名子串替换自带的微软示例图 `SampleAppx.*`，那批图带 Sample 水印）；该目录不存在或为空时会退回示例图。当前 21 张，四个槽位都按 100/125/150/200/400 全档放入。带 `.scale-` 的文件名会让 electron-builder 额外跑 `makepri.exe`，按现存档位生成 `resources.pri` 与 `resources.scale-*.pri`。
- **21 张图出自同一张母图。** `build/appx/Square150x150Logo.scale-400.png`（600×600）是唯一的源：验证方法是对任一现有文件与它按目标尺寸重采样后比平均 RGB（实测差 ≤ 0.07）。改图时从它重出整套，不要单独手改某一张。
- **`StoreLogo.png` 基图故意是 200×200，不是 50×50。** App Installer 不认 `.scale-*`：它按清单 `<Properties><Logo>` 的字面路径只取这一张再自行缩放（实测安装对话框把 50×50 拉到了约 88px）。放大基图消掉这次上采样，另配 `StoreLogo.scale-100.png`（50×50）让 scale-100 的解析仍然合规。
- **宽图是透明底，不烤背景色。** 310×150 是把方形母图缩到 150×150 后居中贴在透明画布上（x=80, y=0），各档按高度同法；不是拉伸方形图。
- **`appx.backgroundColor` 必须显式设置。** 不配置时 electron-builder 用默认值 `#464646`，这个灰不属于 Dela：`uap:VisualElements` 的 BackgroundColor 会出现在开始磁贴的透明四角，也用于商店「应用说明」页。改它时要连 `Wide310x150Logo` 一起重出。
- **已知缺口：没有 `targetsize-*` 与 `altform-unplated` / `altform-lightunplated` 档。** 官方图标规范要求补这套给任务栏与开始菜单用，缺了会把图标缩小、再垫一层系统底板；Dela 的图标本身带板，会变成两层。本次未做。
- **不需要自己签名。** 未配置证书时产物不含 `AppxSignature.p7x`，商店收包后用自己的证书重新签名。
- **应用内更新要等商店里真的有新版才生效。** `StoreContext` 只认商店已发布的包：包没上架或商店还没发布更高版本时，检查失败或报「已是最新」。判据是 `process.windowsStore`，所以只有商店安装版会走到这条路径。

### 机制要点（2026-10 核实）

- electron-builder 没有 `msix` 目标，商店包由 `appx` 目标产出，扩展名是 `.appx`；Windows 目标只有 `nsis`、`nsis-web`、`portable`、`appx`、`msi`、`msi-wrapped`、`squirrel`、`7z`、`zip`、`tar.*`、`dir`，传 `msix` 会报 `Unknown target: msix`（依据本仓库锁定的 electron-builder 26.15.3 的配置 schema 与 `winPackager` 源码）。
- 可选、非推荐：确实需要 `.msix` 文件名时，只能设 `appx.artifactName`。扩展名只是文件名：实测同一支 makeappx（electron-builder 自带的 10.0.17763.1）用 `/p a.appx` 与 `/p b.msix` 产出的文件逐字节相同。副作用：electron-builder 的签名分支按 `path.endsWith(".appx")` 判定，只有 `.appx` 强制 SHA-256，`.msix` 会落到默认的 `sha1`+`sha256`。
- Partner Center 的 Packages 页接受 `.msix`、`.msixupload`、`.msixbundle`、`.appx`、`.appxupload`、`.appxbundle`；官方建议 Windows 10 以上传 `.msixupload` / `.appxupload`，但单个 `.appx` 也可提交。见 [Upload MSIX app packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages)。
- 不需要自己签名：[App package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements?pivots=store-installer-msix) 说明 MSIX/AppX 提交商店无需 CA 信任链证书，商店会在认证通过后用微软证书重新签名并替换原有签名。
- `.msixupload` / `.appxupload` 是「包 + 符号文件」容器，electron-builder 26.15.3 没有产出它的目标或选项。
- 未配置证书时 electron-builder 把 appx 当「Windows Store only build」构建，不签名（日志 `AppX is not signed`），并把 `appx.publisher` 原样写进清单 `Identity/@Publisher`。这一条来自读源码（`out/codeSign/windowsSignToolManager.js` 的 `computePublisherName`、`out/targets/AppxTarget.js`、`templates/appx/appxmanifest.xml`），非官方文档。
- 清单字段实测合格：根命名空间为 `http://schemas.microsoft.com/appx/manifest/foundation/windows10`；`<TargetDeviceFamily Name="Windows.Desktop" MinVersion=… MaxVersionTested=… />` 由 `appx.minVersion` / `appx.maxVersionTested` 指定（不配置时 electron-builder 写死 `10.0.14316.0`）；`<Application Id="Dela" Executable="app\Dela.exe" EntryPoint="Windows.FullTrustApplication">`；`<Capabilities>` 含 `<rescap:Capability Name="runFullTrust"/>`；`appx.languages` 为 `['zh-CN']` 时清单里是 `<Resource Language="zh-CN" />`（不设置时 electron-builder 写 `en-US`）。
- 工具链解压告警只在首次下载时出现：本机首次解 `winCodeSign-2.6.0.7z` 时报 `Cannot create symbolic link : A required privilege is not held by the client`，electron-builder 容忍并继续；CI 未复现。

本地需要签名时（只为在本机安装测试，提交商店不需要）：

- 先生成自签名证书，证书 Subject 必须逐字等于 `appx.publisher`（含 `CN=`）：用 `New-SelfSignedCertificate -Subject "<appx.publisher 的值>"`，再把证书导出成 `.pfx`。electron-builder 自带的 `create-self-signed-cert --publisher` 只接受不含 `CN=` 的名字。
- 自签名包只能装在信任该证书的机器上，测试机要先把证书导入 `LocalMachine\TrustedPeople`；步骤见 [Sign your MSIX package: end-to-end guide](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide)。
- 让 electron-builder 顺便签名：设 `WIN_CSC_LINK`（`.pfx` 路径、base64 或 https 地址）与 `WIN_CSC_KEY_PASSWORD`，再跑同一条 appx 命令；`.appx` 固定用 SHA-256 签名。

### 已验证 / 尚未验证

已验证（2026-10，本机 Windows 10.0.26100 实跑）：

- `.appx` 构建退出码 0，产物是 zip 容器（根含 `AppxManifest.xml`、`AppxBlockMap.xml`、`[Content_Types].xml`），**未签名**（不含 `AppxSignature.p7x`，与日志 `AppX is not signed reason=Windows Store only build` 一致）。
- 图标全档与背景色改动已复建通过：包内 `assets/` 是 21 张 Dela 图标、无微软示例图；清单 `<Properties><Logo>` 仍指向 `assets\StoreLogo.png`（现为 200×200）；`BackgroundColor="#0A0A0A"`；根下有 `resources.pri` 加 `resources.scale-125/150/200/400.pri`。
- `makepri.exe` 接受「200×200 无限定符基图 + 50×50 的 `scale-100`」，构建日志无报错或告警。
- 包内 `app/resources/app.asar.unpacked/out/native/store_update.node` 说明 `asarUnpack` 对 appx 目标同样生效，且商店包的进程有包标识时能 `dlopen` 到它。

尚未验证：

- **签名与安装**：本机未签名、未安装、未做实机验收；Partner Center 是否接受本流水线产出的包也未验证（身份与版本已就位，仍须真实提交一次才知结果）。
- Partner Center 是否接受当前 `MinVersion=10.0.19041.0`：官方只要求包针对商店支持的 Windows 版本，未给出具体下限。这个值是为应用内更新取的——`StoreContext` 的更新 API 要在 1607（14393）以上，静默下载与下载进度回调要在 1803（17134）以上——与 ChatGPT 桌面版的清单取齐。
- 商店对声明语言与实际资源的匹配要求。
- `StoreLogo.png` 未限定基图放大到 200×200 后，商店包校验是否接受。
- 安装对话框 LOGO 放大后的实际观感：要重新安装该 `.appx` 后在 App Installer 里目视确认。
- 受限环境（`noexec`、只读 `$HOME`、磁盘满）只在代码路径与本机路径遮罩式验证过，没有真在 `noexec` 机器上跑过。
- helper 的 arm64 产物只有 qemu 用户态仿真验证，真 arm64 机器上的上传与启动还没跑过。
- 跨主机并行会话已可用，但需要真机环境才能跑那条用例；本机只有单台远端可选。
- 心跳判死与隧道退出失效是新引入的失效路径，未在真机验证（连续 3 次心跳无回应约 1.5 分钟或隧道进程退出即丢通道）。
- helper 资源占用未实测：常驻一个 Go 进程（约 10 MB 内存量级），未做压测。

## 18. 平台基线

| 平台    | 最低系统基线 | 架构 | 产物                                          | GitHub runner  |
| ------- | ------------ | ---- | --------------------------------------------- | -------------- |
| Windows | Windows 10   | x64  | NSIS `.exe` 安装包                            | `windows-2022` |
| Windows | Windows 10   | x64  | 商店包 `.appx`（未签名，仅 Actions artifact） | `windows-2022` |

- 以上是项目选择的构建基线，不代表最低系统实机兼容性已验收。GitHub runner 是构建环境，与最低运行系统不同。
- 安装包名包含版本、系统和架构，避免产物重名。私有发布任务使用内置 `GITHUB_TOKEN`（`contents: write`），公开发布任务使用 `PUBLIC_RELEASE_TOKEN`，token 权限只覆盖公开仓库。

## 19. 当前限制

- 未配置代码签名，安装时可能遇到 SmartScreen 提示。
- 工作流中的冒烟检查验证打包后程序及 SQLite / preload，不代替 NSIS 安装向导的实机验收。
- 自动更新元数据（`latest*.yml`、blockmap）不发布：走微软商店的应用内更新不需要它们，`electron-updater` 要等自建分发有正式签名与更新渠道后再谈。
- 商店包（`.appx`）已随流水线产出但尚未签名、尚未提交商店；面向用户的安装包仍是 NSIS `.exe`。应用内更新的原生模块已随包构建与检查，但整条路径要等商店上架并有更高版本后才能实机验收。
- 远端项目内不支持新建 / 编辑笔记；远端 PPTX 不支持内嵌预览；打开的预览不自动跟随远端改动。
