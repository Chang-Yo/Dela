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
- 仅通过 NSIS（`.exe`）分发 Windows x64 应用。应用内更新使用 electron-updater，从自有 CDN 获取正式 Release。
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

目录注意：rg/fd 落在 `~/.pi/agent/bin`，**不是** `userData/pi/bin`——bin 只认 `PI_CODING_AGENT_DIR` 环境变量，Dela 不设置它。skills 不是同一套：Dela 把 `agentDir` 显式指到 `userData/pi`，Pi 的 agent 级 skills 目录随之变成 `<userData>/pi/skills`，而 SDK 里没有读 `~/.pi/agent/skills` 的代码路径。所以 `userData/pi` 里隔离的是 auth、models、sessions 与 skills，**bin 是唯一例外**。

`web_fetch` 的 HTML 转换使用纯 JS `@mdream/js`，保留 Markdown 结构、解析相对链接；仅过滤导航、页脚与非正文标签。PDF、编码处理、2MB 上限与 offset 续读沿用现有实现；不执行网页 JavaScript。`web_search` 由用户提供搜索服务。

### 2.2 dela 命令

领域能力的 CLI 门面。应用生命周期内一个本机 HTTP 桥（`127.0.0.1` 随机端口 + Bearer token），经 Pi 的 `shellCommandPrefix` 注入 bash，终端同样可用；`dela help` 列命令与 JSON Schema。

### 2.3 skills

纯文档领域知识，Pi 按 Agent Skills 规范发现。五个内置领域 skill（shuiyuan / canvas / mail / todo / curriculum）写进 `~/.dela/skills` 并作为附加 skill 目录交给 Pi；设置页的禁用名单经 `skillsOverride` 过滤。扫描位置共三处：`~/.dela/skills`、`~/.agents/skills`、`<工作目录>/workspace/.agents/skills`（`<工作目录>` 即设置 › 工作区里选定的位置，缺省 `文档\Dela`）。

### 2.4 GUI

标签工作台（聊天 / 笔记 / 预览 / 终端），经 IPC 消费同一套领域实现。UI 组件统一以 vendored beautiful-ui 为基座（见其 [README](../src/renderer/components/ui/beautifului/README.md)），被替代的自研 UI 必须清理。

设置页语义约定：

- 状态用颜色点表达（绿＝连接 / 使用中，灰＝未连接）；页面主操作用主色（default）按钮。
- 常驻能力整组说明一次，行内用锁徽标替代禁用开关。
- Skills 行支持查看 `SKILL.md` 与打开所在位置（`capabilities:read-skill` / `reveal-skill`，主进程按名单独解析路径，渲染端不传路径）。
- 隐私页按文档排版（限宽、13px 正文、枚举两列表）。

瞬时动作失败的报错与成功提示走应用内通知浮窗（`app/toasts.tsx` 的 `showToast`，内容区顶部居中滑入，error / success 变体，卡片为 beautifului `atoms/Toast.tsx`；error 8s / success 4s 自动消失，至多 4 条）。打开着的表单的校验与提交错误、持久态（连接红点、同步失败横幅、加载失败占位）仍内联展示，不进浮窗；终端输入与尺寸同步失败属高频连续操作，留内联红字条；后台自动动作（会话终态后的镜像刷新等）失败不弹浮窗，只留 console 线索。工作区 store 的 `error` 通道只承载镜像加载失败这一持久态，瞬时动作失败一律走浮窗。

## 3. 会话与上下文

- **项目＝目录**：项目是 `kind='project'` 的 workspace 条目，身份是条目 UUID，目录是其 `local_path`；目录可在工作区内新建，也可导入电脑上已有的文件夹（留在原处，重命名 / 移动按同一套语义真的动磁盘）。远程项目的 `local_path` 是远端 POSIX 路径，本地没有这份目录（见 §4）。
- **会话 cwd**：项目会话是该项目的目录；通用（随聊）会话是 `<工作目录>/chat-sessions/<会话 id>` 私有目录；资料页会话用 `<工作目录>/courses`；`sessions.cwd` 为 NULL 的旧会话才回退到工作区根。目录缺失时报错，不静默换目录（远程项目跳过本地存在性检查）。
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
- **VS Code 打开项目**：直接启动 `Code.exe`，远程项目附带 `--remote ssh-remote+<host>`；不使用 `windowsHide: true`，它会隐藏首次启动的 GUI 窗口。VS Code 的 Remote - SSH 扩展与 ssh config 仍由用户配置。
- **降级**：helper 起不来时（服务器禁执行 `noexec`、只读挂载、SELinux 拦截）自动分类原因并退回一次性 ssh，向导日志与目录树都显示人话文案。降级后端口预览与远端改动实时刷新不可用，其余功能照常。
- **不做**：远端笔记写回与编辑器内保存；远端 PPTX 内嵌预览（下载后用 PowerPoint 打开）；远程会话里没有 dela 校园命令；JS 扩展宿主；远端 MCP 端口转发。

开发注意（真机踩过的坑）：

- 连接是「一次调用一个 ssh 子进程」，没有多路复用。短时间并发握手太多时主机会直接断开（`Connection closed by <host> port 22`），并行跑多个真机测试文件就会偶发；`pnpm test:remote` 因此要串行（串行由 `vitest.remote.config.ts` 的 `fileParallelism: false` 保证）。App 侧一次工具调用只有一条连接，但模型并发发起多个工具调用时可能撞上主机的 MaxStartups。
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

使用精确锁定的 electron-updater 6.8.10，配套 electron-builder 26.15.3 的 NSIS 目标，不自行实现版本比较、差分下载或安装器。

- 更新源为 `https://openlist.frameneo.com/sd/Dela_latest_release/`，通过 Generic provider 读取 `latest.yml`。下载页面为对应的 `/@s/Dela_latest_release` 分享页；客户端不解析分享页 HTML。构建时由 electron-builder 在 resources 中生成 `app-update.yml`，主进程构建将 electron-updater 保持 external。
- CDN 定期拉取最新正式 GitHub Release 的文件并扁平存放，只保留最新版；上传和同步由 CDN 侧完成，CI 不持有 CDN 凭据。同步时安装包与 blockmap 应先于元数据就绪，避免元数据指向缺失文件。
- Release 同时提供 `Dela-<版本>-win-x64.exe`、对应 `.exe.blockmap` 和渠道元数据。发布元数据统一为 `latest.yml`；预发布 Release 不进入 CDN 正式版目录，客户端固定 latest、拒绝预发布及降级。
- 开启 NSIS differentialPackage，Generic provider 使用单段 Range 请求。更新器优先使用本地旧安装包和 blockmap 缓存，缺少缓存、旧 blockmap 或差分失败时退回全量下载；SHA-512 校验由更新器完成，不保证每次都是差分下载。
- 主进程 `main/update/index.ts` 持有状态，检查与下载的 Promise 处理失败；进度和安装器异步启动错误通过事件接收。界面只读快照和派发动作，设置页关闭不会打断下载。发起安装后保持 installing，不把启动安装器当成安装成功。
- 每两小时后台检查一次，启动后 30 秒先查一次；仅打包运行且已有窗口时执行。开发模式不联网检查。缺少或不可读的 latest.yml 显示检查失败，不显示“已是最新”。
- `autoDownload=false`、`autoInstallOnAppQuit=false`：用户手动下载，下载完成后选择“现在安装”或“下次启动时提醒”。安装前保存笔记、聊天文字草稿、邮件草稿和工作台布局；运行中 Agent、未发送附件或保存失败会阻止安装。安装调用 `quitAndInstall(true, true)`，退出应用并在安装完成后重新启动；终端进程无法恢复。
- 推迟标记仍为 workspace_settings 的 `pending-install`。下次启动 5 秒后检查并复用下载缓存，准备到 ready 后再次提示，绝不自动安装。安装器启动失败提供手动下载安装包入口。
- 尚未配置 Authenticode 签名。SHA-512 只验证文件与元数据一致，不能替代发布者签名。下载源固定为 HTTPS，不随意关闭签名验证；未来启用签名时需保持发布者身份连续。
- 旧 NSIS 版本没有此更新客户端，需手动覆盖安装一次新版本；现有 appId `io.dela.desktop` 保持不变。
- **已验证（2026-10-13，本机）**：生产构建、lint、更新相关 102 个测试、Electron 与打包后启动冒烟；NSIS 1.0.1 的安装包、blockmap、latest.yml 与包内 app-update.yml 已生成。打包只包含 main / preload / renderer 三个入口产物，避免收进迁移前遗留的 out/native。
- **待验证**：线上 CDN latest.yml、Range / 差分流量、两版真实安装后的覆盖升级、UAC 与重启。本次按产品决定推迟线上 Range 验证；不能把单元测试或打包启动视为端到端升级通过。

## 7. 安全边界

诚实而非表演：给了 bash 就不设业务级守卫、无沙箱、无越权校验；skill 启停是引导层。保留进程级基本边界：renderer 隔离、凭据不进 renderer、preload 有限暴露。

- 数据保存在本机 SQLite，凭据经 Electron `safeStorage` 加密（`src/main/credentials.ts`）。
- renderer 不接触文件系统、数据库与凭据，一切经受控 IPC 通信。
- Agent 的 bash 与文件工具即本机权限，不设沙箱。
- Pi 的 auth / models / sessions / skills 放在 `userData/pi`，与用户自己的 `~/.pi` 隔离（只有 bin 例外，见 §2.1）；模型密钥只在主进程内注册给 Pi 的运行时，不写入 `auth.json`。
- 应用启动**不读取仓库 `.env`**，凭据只能在应用内配置。

## 8. 持久化

schema v4。迁移是逐段演进：v1→v2 只重建 `sessions`，删除 `runs` 与 `projects`（会话不迁移）；v2→v3 只加 `workspace_entries.remote_id` 并建 `remotes` 表（旧条目一律视为本地项目）；v3→v4 给 `sessions` 加 `cwd` 列。更早的旧世界库整库备份为 `dela-legacy-backup.db` 后重建，旧聊天与笔记记录不迁移。

表：`workspace_settings`、`workspace_entries`、`remotes`、`sessions`（索引，含 `cwd`、`message_count`），以及领域缓存（mail 三表、timetable 两表、`calendar_events`、canvas 两表、`shuiyuan_topics`、`todo_items`、notifications 两表）。笔记即磁盘文件。

## 9. 终端

与 Bash 同源：Git Bash + node-pty（ConPTY）+ xterm.js，实现参考 VS Code / Hyper；dela 桥函数同样注入项目终端。Git Bash 探测顺序：系统 Git for Windows → 随包 MinGit（`resources/mingit`）→ 应用自装的 MinGit 运行时（下段），都缺失时明确报错（`locateBash()`），**不回退 PowerShell**。随包副本由 `scripts/prepare-runtime.mjs` 在打包前按源码里写死的版本与 SHA256 下载校验（版本定义只在 `src/main/terminal/mingit.ts` 一处），仓库不提交这份约 40MB 的产物（`.build/` 已忽略）；随包已有运行时时，启动会顺手清掉旧版本自装进用户目录的 MinGit 副本。

系统没装 Git for Windows 时（开发模式或旧版升级前的兜底），终端页可一键安装固定版本的官方 MinGit（`src/main/terminal/mingit.ts`）：从 npmmirror 镜像下载 zip（大陆 CDN 直连快，GitHub Releases 兜底，两者与官方发布物逐字节一致），SHA256 与版本号写死在源码（换版本必须成对更新），由系统自带 tar 解压进 `%LOCALAPPDATA%\Dela\mingit\v<版本>`，全程无需管理员权限。MinGit 只以 `sh.exe` 名义带 bash 本体，安装时复制出 `bash.exe`——argv[0] 决定 bash 是否走完整模式，`--rcfile` 注入 dela 桥依赖它；装成后把 `cmd/` 前插进主进程 PATH（`prependRuntimePath()`），终端与 Agent 的 bash 内 git 随即可用。失败与取消都清理半成品，换绑新版本安装时顺手删除旧版本目录。

内核（pi）的 `grep` / `find` 不在进程内实现，而是 spawn 外部 `rg` / `fd`；用户机器通常没有，pi 自身兜底是从 GitHub 直连下载（大陆大概率失败），因此随包分发：`vendor/bin/` 里的 `rg.exe` / `fd.exe` 经 `extraResources` 进 `resources/bin`，启动时前插 PATH 即被 pi 的 PATH 探测命中，不再触发下载（来源与升级步骤见 [vendor/bin/README](../vendor/bin/README.md)）。

远程项目的终端是本地 `ssh -tt` 申请远端 PTY，远端不需要 node-pty；该终端不注入 dela 桥，但可以让 ssh 自己问密码与主机指纹。

## 10. 仓库组织

单仓库、单 `package.json`，三个进程分别构建：

- `src/main/` — 主进程，按业务域分目录（`mail/`、`canvas/`、`timetable/`、`workspace/`、`shuiyuan/`、`remotes/`、`vsjtu/`、`update/`、`settings/`、`todo/`、`terminal/`、`search/`、`notifications/`、`documents/`），每域一个入口：`canvas/`、`mail/`、`remotes/`、`shuiyuan/`、`timetable/`、`workspace/`、`vsjtu/` 的入口叫 `api.ts`，`settings/`、`agent/`、`update/`、`todo/`、`terminal/`、`search/`、`notifications/` 叫 `index.ts`；`ipc.ts` 只在其中 8 个域与入口并列存在（上面七个 `api.ts` 域再加 `settings/`），其余域的 `register*Ipc()` 写在入口内部；`documents/` 无入口与 IPC，由其他域直接 import。`agent/` 为 Agent 基座：`pi.ts`（Pi SDK 接线与模型注册）、`session.ts`（会话索引、事件投影与 ask）、`environment.ts`（追加提示、dela 桥、skills、MCP 与联网工具）、`commands.ts` + `domain/`（dela 命令）、`index.ts`（`capabilities:*` 与 `chat:*` 通道注册）、`providers.ts`、`skills.ts`、`mcp.ts`、`tools.ts`（内置能力开关）、`media.ts`、`chat-commands.ts`、`web-fetch.ts`、`web-search.ts`（自写工具）。根级只留不属于任何业务域的模块：入口 `index.ts`、`database.ts`、`credentials.ts`、`storage.ts`（路径与文件名）、`ipc.ts`（调用来源校验与右键菜单）、`resources.ts`（跨域资源解析）与 `modules.d.ts`。
- `src/preload/` — contextBridge：`index.ts` 聚合入口 + 分域文件，只暴露受控 API。
- `src/renderer/` — React 界面：`app/`（装配与视图路由）、`workbench/`（标签工作台与布局树）、`content/`（chat / note / preview / review / terminal 标签内容）、`navigation/`、`sessions/`、`workspace/`（镜像与草稿）、`features/`（mail / timetable / shuiyuan / todo / notifications / onboarding / search / settings / classroom 整页视图）、`lib/`、`styles/`；共享组件在 `components/ui/`，样式用 Tailwind v4 + 语义 token。
- `src/shared/` — 进程间共享的 IPC 契约与纯函数（`api.ts` 聚合 re-export）。
- `helper/` — 远端工具服务的 Go 模块，只依赖标准库。
- 测试与被测代码同层，但摆法按层不同：`src/main/` 多数域用 `test/` 子目录（`update/`、`vsjtu/` 直接贴在源码旁），`src/renderer/` 与 `src/shared/` 一般把 `*.test.ts` 与源码并排（`renderer/workbench/`、`renderer/workspace/` 仍用 `test/`）。`scripts/` 存放开发服务器与冒烟脚本。

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
- 运行时依赖 Git Bash 与搜索工具 rg/fd：内核 Bash 工具与内置终端统一使用 Git Bash，内核 grep/find 用 rg/fd，均已随包分发（见 §9），用户不必预装；终端页的一键安装保留给没有随包副本的场景。
- 首启引导只由 `userData/dela.db` 是否存在决定：首次跑完即不再重播，开发模式也一样。URL 加 `?smoke-test=1` 可短路引导；冒烟会另开临时 profile。
- 远端 helper 的静态二进制已入库在 `vendor/dela-helper/`，日常开发不需要 Go；改了 `helper/` 下的 Go 代码后执行 `pnpm build:helper --all` 重建 amd64 与 arm64 两个产物并一并提交——只重建 amd64 会让仓库里的 arm64 停在旧版（发布时 CI 会覆盖，但本地对 arm64 远端的测试用的是旧版）。

## 12. 常用命令

| 命令                                            | 用途                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                                      | 启动开发服务器和窗口，监听主进程 / preload 变更                    |
| `pnpm typecheck`                                | 三组 tsconfig 的类型检查                                           |
| `pnpm build`                                    | 类型检查 + main / preload / renderer 三入口生产构建                |
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
| `pnpm exec electron scripts/mingit-smoke.cjs`   | MinGit 一键安装回归：真实下载约 40MB，装进临时沙箱                 |
| `pnpm exec electron scripts/agent-smoke.cjs`    | Agent 基座回归：需 `DELA_SMOKE_BASE_URL/API_KEY/MODEL`，发真实请求 |
| `pnpm package:dir`                              | 生成未安装的可执行目录                                             |
| `pnpm package:dist`                             | 生成 Windows 安装包                                                |

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

## 14. CI

`.github/workflows/check.yaml` 在 PR 创建、更新、重新打开及 push 到 `main` 时运行，job 名 `Check win-x64`：

- 应用只构建 Windows x64（`windows-2022`），与发布一致的 runner 和固定 Node / pnpm 版本。
- helper 任务名即 `Check helper linux (amd64 + arm64)`，在 `ubuntu-24.04` 用 Go 1.27.2 执行 `go vet`（含交叉 `linux/arm64`）、`go test`、构建两个架构的静态产物并跑 `--version`（arm64 走 qemu 用户态仿真）。Windows 任务下载当次产物用于打包，并逐字节核对打包后的文件。
- 执行冻结锁文件安装、`pnpm format:check`、`pnpm lint`、`pnpm build`（含类型检查）、`pnpm test`、`pnpm smoke`、应用目录打包、包内 helper 核对及打包后冒烟。**CI 是分步执行这些命令，不是调用 `pnpm check`。**
- Go 测试只使用 runner 本机临时目录、inotify 与回环 HTTP，不连接 SSH。Windows 任务明确留空 `DELA_REMOTE_HOST`，真实 SSH 联调继续手动运行，不作为发布前置条件。
- 检查不生成安装包、不发布 Release，仅使用 `contents: read` 权限；同一 PR 或 main 分支的新提交会取消旧检查。

若要限制合并，需在 GitHub 的 main 分支规则中将 `Check win-x64` 设为必需检查——仅添加 workflow 不会自动启用分支保护。

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
- 安装包也会带上 helper（`extraResources` 拷到 `resources/dela-helper`）。CI 与发布从本次源码构建 Linux amd64 与 arm64 产物（`build-helper.mjs --all`），覆盖仓库中的预编译文件后打包，避免发布旧 helper。预编译文件仍保留供无 Go 的本地开发者使用；升级 helper 时同步 Go 与 TS 两端的版本常量。
- 安装包会带上搜索工具 `vendor/bin`（`extraResources` 拷到 `resources/bin`）。升级 rg/fd 时按该目录 [README](../vendor/bin/README.md) 的步骤做，并在打包目录里实跑一次 `resources\bin\rg.exe --version` 与 `resources\bin\fd.exe --version`。
- 安装包会带上 MinGit 运行时：`pnpm package:dir` / `pnpm package:dist` 与发布 CI 都先执行 `node scripts/prepare-runtime.mjs`（下载、SHA256 校验、解压到 `.build/mingit`，幂等），再由 `extraResources` 拷到 `resources/mingit`。仓库不提交该产物；换 MinGit 版本只改 `src/main/terminal/mingit.ts` 的成对常量（脚本从源码解析同一份定义），打包目录里实跑一次 `resources\mingit\usr\bin\bash.exe --version` 验证。

### 发布

`.github/workflows/release.yml` 在推送 `v*` tag 时构建并发布 GitHub Release：

1. 先提交版本号和代码，再执行 `git tag v0.1.0 && git push origin v0.1.0`；tag 必须等于 `v` + `package.json` 的版本。
2. Linux helper 任务测试并构建该 tag 对应的源码；Windows 任务下载其产物，执行锁文件安装、类型检查与生产构建、单元测试、Electron 冒烟、随包运行时准备（`prepare-runtime.mjs` 下载并校验 MinGit）、NSIS 构建、包内 helper 一致性与更新产物检查、打包目录启动检查。全部成功后创建 Release，上传 `.exe`、对应 `.exe.blockmap` 和渠道 `.yml`。正式版必须提供 `latest.yml`，包内必须有 `resources/app-update.yml`。
3. 含预发布后缀的版本（如 `0.2.0-beta.1`）自动标记为 prerelease。
4. 也可在 Actions → Release installers → Run workflow 中手动填入已有 tag 构建发布。

`prepare` 与 `release` 任务是 Ubuntu runner，只做校验与 `gh` 上传，不构建应用；发布 job 会把 release notes 作为 artifact 上传，供 `publish-public` 复用，后者同样跑在 `ubuntu-24.04`。release 工作流的 `concurrency` 设了 `cancel-in-progress: false`，与 CI 相反。

**重跑已有 tag**：现有流程仍用 `gh release upload --clobber` 覆盖同名产物。正式分发后不要覆盖重建安装包：CDN 缓存可能与新元数据不一致；程序变更应升版并发布新 tag。

**公开镜像**：私有 Release 发布成功后，同一工作流会把同一批安装包、blockmap、更新元数据和完全相同的 release notes 再发布到公开仓库 [Chang-Yo/Dela_releases](https://github.com/Chang-Yo/Dela_releases) 的同名 tag Release。公开仓库中的 tag 由 GitHub 自动创建在其默认分支最新提交上，仅作发布锚点，不对应源码。

首次使用前的准备：

1. 公开仓库已有初始提交（例如 README）。
2. 在本仓库 Settings → Secrets and variables → Actions 配置 `PUBLIC_RELEASE_TOKEN`：仅授权 `Chang-Yo/Dela_releases`、权限 Contents: Read and write 的 fine-grained PAT——内置 `GITHUB_TOKEN` 无法跨仓库发布。

## 16. 平台基线

| 平台    | 最低系统基线 | 架构 | 产物               | GitHub runner  |
| ------- | ------------ | ---- | ------------------ | -------------- |
| Windows | Windows 10   | x64  | NSIS `.exe` 安装包 | `windows-2022` |

- 以上是项目选择的构建基线，不代表最低系统实机兼容性已验收。GitHub runner 是构建环境，与最低运行系统不同。
- 安装包名包含版本、系统和架构，避免产物重名。私有发布任务使用内置 `GITHUB_TOKEN`（`contents: write`），公开发布任务使用 `PUBLIC_RELEASE_TOKEN`，token 权限只覆盖公开仓库。

## 17. 当前限制

- CDN 的线上更新文件、Range 和两版覆盖升级尚未验收，检查失败时可从下载页手动获取安装包。
- 未配置代码签名，安装时可能遇到 SmartScreen 提示。
- 工作流中的冒烟检查验证打包后程序及 SQLite / preload，不代替 NSIS 安装向导的实机验收。
- 远端项目内不支持新建 / 编辑笔记；远端 PPTX 不支持内嵌预览；打开的预览不自动跟随远端改动。
