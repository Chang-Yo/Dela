# Dela 技术规划

日期：2026-10-08。状态：基座已切换到 Pi Coding Agent SDK，不向下兼容，旧数据不迁移；用户最新明确决定优先于本文。

## 产品

本地个人 Agent：内核是通用 agent，领域知识外置为 skills 与 dela 命令，工作台 GUI 是壳。单用户、单应用、单 package；仅 Windows（跨平台明确放弃）；安装包暂用 NSIS（exe），MSIX 与微软商店分发是后续计划；无服务端，检索 API 由用户自配。

## 分层架构（建设顺序＝依赖方向，自下而上）

**1. 内核＝Pi Coding Agent（冻结）**：`@earendil-works/pi-coding-agent` SDK 的 `createAgentSession` 就是 agent 内核。会话树（JSONL）、多轮工具上下文、自动压缩、重试、AGENTS.md 上下文文件、skills 发现与渐进加载都由 Pi 承担，Dela 不另写执行循环、上下文组装或压缩。

| 工具                       | 来源                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| read / write / edit / bash | Pi 内置，cwd＝会话所属项目目录；bash 用 Git Bash（与终端同源），不可关闭       |
| grep / find / ls           | Pi 内置；首次使用时 Pi 自动下载 rg/fd 到 `userData/pi/bin`（待验证离线体验）   |
| web_search / web_fetch     | Dela 自定义工具，默认关闭；搜索服务在「网络」域注册（Brave / Google / 自定义） |
| MCP 工具                   | Dela 连接 stdio 服务器后作为自定义工具注入                                     |

远程项目会话（见下）把这七个工具的执行端换成 SSH 远端，工具名、schema 与描述都不变。

`web_fetch` 的 HTML 转换使用纯 JS `@mdream/js`，保留 Markdown 结构、解析相对链接；仅过滤导航、页脚与非正文标签，不用 minimal 的正文隔离和 Tailwind 过滤。PDF、编码处理、2MB 上限与 offset 续读沿用现有实现；不执行网页 JavaScript。`web_search` 仍由用户提供搜索服务。

**2. dela 命令**：领域能力的 CLI 门面。应用生命周期内一个本机 HTTP 桥（127.0.0.1 随机端口 + Bearer token），经 Pi 的 `shellCommandPrefix` 注入 bash，终端同样可用；`dela help` 列命令与 JSON Schema。

**3. skills**：纯文档领域知识，Pi 按 Agent Skills 规范发现；Dela 把五个内置领域 skill 写进 `~/.dela/skills` 并作为附加 skill 目录交给 Pi，设置页的禁用名单经 `skillsOverride` 过滤。

**4. GUI**：标签工作台（聊天/笔记/预览/终端），经 IPC 消费同一套领域实现。UI 组件统一以 vendored beautiful-ui 为基座，被替代的自研 UI 必须清理。设置页语义约定：状态用颜色点表达（绿=连接/使用中，灰=未连接）；页面主操作用主色（default）按钮；常驻能力整组说明一次、行内用锁徽标替代禁用开关；Skills 行支持查看 SKILL.md 与打开所在位置（`capabilities:read-skill` / `reveal-skill`，主进程按名单独解析路径，渲染端不传路径）；隐私页按文档排版（限宽、13px 正文、枚举两列表）。瞬时动作失败的报错走应用内通知浮窗（`app/toasts.tsx` 的 `showToast`，内容区顶部居中滑入，error/success 变体，卡片为 beautifului `atoms/Toast.tsx`；error 8s / success 4s 自动消失，至多 4 条）；表单校验与持久态错误仍内联展示，不进浮窗。

## 会话与上下文

- 项目＝目录：项目是 `kind='project'` 的 workspace 条目，身份是条目 UUID，目录是其 `local_path`；目录可在工作区内新建，也可导入电脑上已有的文件夹（留在原处，重命名/移动按同一套语义真的动磁盘）；远程项目的 `local_path` 是远端 POSIX 路径，本地没有这份目录（见「远程项目」）。会话 cwd 恒为该目录（通用会话为工作区根）；目录缺失时报错，不静默换目录（远程项目跳过本地存在性检查）。
- 会话的完整记录是 Pi JSONL（`userData/pi/sessions`），SQLite `sessions` 只是索引（项目归属、标题、置顶、归档、文件路径）。renderer 看到的 `WorkspaceChat` 是 Pi 消息的投影（`main/agent/session.ts`）。
- 会话归属在创建时确定，ChatTab 从会话快照取 projectId/cwd，不取当前工作台。
- 上下文是 pull 模型：@ 引用是会话 cwd 下文件的绝对路径，模型自主 read；附件文本与图片随用户消息进入 Pi 会话。引用以「@相对路径」token 内联在 composer 文本里（发送前经 `content/chat/reference-tokens.ts` 解析回绝对路径，未命中的 @文本只是正文），因此引用无数量上限；拖入/粘贴附件维持在 composer 上方 chips、上限 5，与引用分开计数。
- 上下文占用：快照与流式事件携带 `contextUsage`（Pi `getContextUsage` 的投影，仅打开中的会话有）；composer 底部圆环按占用显示进度，悬浮面板只报总量（SDK 无分类明细），压缩后 tokens 未知时显示「—」。
- 系统提示＝Pi 默认提示 + Dela 追加段（dela 命令说明、项目名与目录、用户自定义指令）。
- 编辑重发在 Pi 会话树上分支，旧分支保留在 JSONL。
- 自定义 OpenAI 兼容网关的 API 根由模型列表端点探测决定（`{base}/v1/models` 应答则根为 `{base}/v1`，网关把控制台首页以 200 返回时不算命中）；检测回传校正地址，表单直接采用。密钥留空一律沿用已存值，改地址不要求重填。

## 远程项目

- 形态：内核、密钥、会话 JSONL、skills 与系统提示都在本地，只有工具执行、终端、目录读取与文件预览落到远端 SSH 主机（`main/remotes/`）；不在远端部署常驻 runtime，只放一个 Go 静态二进制（`~/.dela/helper/`，见 `docs/remote-helper.md`）。
- 传输：`transport.ts` 是一次性 ssh 的唯一边界，系统 OpenSSH 优先、`vendor/openssh` 兜底（自带 `ssh.exe` + `libcrypto.dll` 经 `extraResources` 进 `resources/openssh`）；一次调用一个 ssh 子进程，实测每次 0.3–0.6 秒。日常调用走 helper：`ssh -L` 隧道 + 远端 `127.0.0.1` 上的 HTTP，建好之后不再付握手钱（列目录实测 28 ms vs 310 ms）。
- 工具：read/write/edit/bash/ls/find 复用 Pi 的工具定义、只换 `operations`；grep 在 Pi 内部固定 spawn 本地 rg，故保留其 schema 与描述、自写 execute 在远端搜（rg 缺失时退回 grep -rnH）。同名自定义工具覆盖内置（`agent-session.js` 注册表后写覆盖，已按 1.1.0 产物核对），因此这七个名字不能进 `excludeTools`。
- 路径：会话 cwd 就是远端 POSIX 绝对路径；工具传来的路径先经 `remotePath` 还原（Windows 会把 `/root/x` 解析成 `\root\x`）。
- 本地不碰远端路径：`projectLocation` 分远程分支，`entry()` 拒绝远端路径，远程项目内禁新建/重命名/移动，目录不进本地扫描也不 fs.watch。远端条目 id 是「项目 id + 远端路径」（`shared/remotes.ts`），两台连接上的同路径目录不会混；裸远端路径只在唯一归属时解析。远端目录的变化由 helper 的 inotify 事件流推给目录树（只监视展开的那几层）。
- 认证：Dela 不存任何口令；密钥走 ssh 自身的 `~/.ssh/config` 与 agent，密码只在交互终端里由 ssh 询问。连接自检 `ssh -o BatchMode=yes -o ConnectTimeout=10 <dest> true`，主机指纹不自动接受。
- 阶段 6（远端工具服务 helper、实时目录树与预览、远端 skills 进上下文）：**6.0（远端文件身份）、6.1（最小 Go helper：上传校验、`ssh -L` 隧道、握手、心跳、片段读写、可取消的流式任务）、6.2（上下文镜像：远端 skills 与 `AGENTS.md` 进会话、镜像路径映射、设置页技能上传）与 6.3（目录清单走 helper 通道、远端工具改过文件后目录树自动重读；`/v1/watch` 的 inotify 事件流，Dela 之外改的远端文件也自动进树；远端文件只读预览、下载/上传与系统默认程序打开）已全部实施**，6.4（端口预览、JS 扩展宿主、arm64 与受限环境）不做，产品上覆盖大部分场景即可；见 `docs/remote-helper.md`（helper 定 Go 静态二进制，上下文先走逐项注入）。

## 课堂视频（试验）

- 侧栏「课堂视频」入口（水源上方）随试验开关显隐：试验功能为「总开关 + 子项」结构（设置 › 通用，两者都默认开启），「课堂视频」是当前唯一子项，任一关闭即隐藏入口（`renderer/features/settings/experimental` 为侧栏、设置区与页面共用的开关镜像）。`renderer/features/classroom` 为可折叠课程侧栏 + 播放器两栏（无页头；侧栏与资料面板同款：inset 底、紧凑头、可拖宽度、折叠态在播放器标题行给展开钮），支持选课选场次、在线播放、拖拽进度、音量与倍速、多画面切换及原始下载（下载默认目录在总开关与子项都开启时出现，写入 `video-download-directory` 键，空值即由系统保存对话框决定；`vsjtu:get/choose-download-directory` 同样过门禁）。主进程门禁检查两个开关的与：未开时拒绝新的登录、查询、播放与下载操作，已有下载仍可查询、取消或打开位置。总开关与子项的键缺失或损坏都视为开启。
- `main/vsjtu` 复用课表的加密校园会话，使用前探测身份；用户在官方窗口手动登录，会话在服务端有效期间复用。相同 API 的在途请求合并，短暂网络失败、超时与 408/500/502/503/504 延迟 250ms 后重试一次，登录失效或数据格式错误不重试。学期枚举兼容直接数组与 result 包装，列表逐页读取，课程按教学班去重。Cookie 与媒体签名留在 main。

| preload API                                             | 保留能力                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `vsjtu.connect()`                                       | 打开官方登录窗口，探测登录并保存会话                                   |
| `vsjtu.listCourses()`                                   | 查询本学期本人课程的编号、名称与课程代码                               |
| `vsjtu.listVideos(courseId)`                            | 查询课程录像编号、起止时间、节次与教室                                 |
| `vsjtu.streams(videoId)`                                | 返回画面编号、时长与代理播放地址（含本次运行有效的 token，非签名直链） |
| `vsjtu.download(videoId, view, name)`                   | 选择保存位置，重新获取签名地址并启动原始 MP4 下载                      |
| `vsjtu.downloads()` / `vsjtu.onDownload(listener)`      | 查询及订阅本次应用运行期间的下载进度和状态                             |
| `vsjtu.cancelDownload(id)` / `vsjtu.revealDownload(id)` | 取消任务或打开已完成文件的位置                                         |

- 在线播放走 `dela-resource://vsjtu/video/<videoId>/<view>?t=<token>` 主进程代理（`main/vsjtu/playback.ts`）：本次运行随机密钥按 videoId 签发 HMAC token，元数据缓存淘汰后旧播放地址仍可重新取源；同录像的并发取源与刷新合并。空画面列表不缓存，提示尚未就绪以允许页面重试。签名地址缓存 10 分钟，过期或上游 401/403 时刷新。Range/If-Range、HEAD 和 206/416 语义透传；上下游媒体缓存均禁用，媒体请求不携带校园 Cookie、不跟随重定向，响应只透传媒体头白名单。
- 媒体首包等待、下游需要数据时的读取等待均限 15 秒。首包前网络失败或临时服务错误延迟 250ms 后重试一次（与签名刷新共用两次媒体请求上限）；响应体被取消时显式中止上游。已开始传输的流若中断或读超时，结束响应交由页面重试，尚不支持无缝续接。CSP `media-src` 只放行 `dela-resource:`。
- 下载沿用 Electron DownloadItem，重复任务拒绝启动；区分用户取消与网络中断，中断后需重新下载。任务列表仅驻留内存，无跨重启续传。不合并、不转码、不依赖外部 FFmpeg，不调用观看上报、AI、字幕、PPT、直播或旁听接口。
- 真实联调已验证本学期 8 门课、计算理论 9 场录像与两路画面信息；2026-10-10 修复后，两路代理视频跳到第 10/27/50 分钟均就绪（200–461ms），连续快速跳转后播放继续且无媒体错误。该验证使用独立 video 元素调用同一代理，未验证整页交互和长时间弱网表现。此前一份 424,277,175 字节、3283.777 秒的原始录像下载完整，中段和结尾可解码；本次未重复完整下载。

## 安全

诚实而非表演：给了 bash 就不设业务级守卫、无沙箱、无越权校验；skill 启停是引导层。保留进程级基本边界：renderer 隔离、凭据不进 renderer、preload 有限暴露。Pi 的全局目录放在 `userData/pi`，与用户自己的 `~/.pi` 隔离；模型密钥只在主进程内注册给 Pi 的运行时，不写入 `auth.json`。

## 持久化

schema v3：v1→v2 只重建 `sessions`，删除 `runs` 与 `projects`（会话不迁移）；v2→v3 只加 `workspace_entries.remote_id` 并建 `remotes` 表（旧条目一律视为本地项目）；更早的旧世界库整库备份后重建。表：workspace_settings、workspace_entries、remotes、sessions（索引）、领域缓存（mail 三表、timetable 两表、calendar_events、canvas 两表、shuiyuan_topics、todo_items、notifications 两表）。笔记即磁盘文件。

## 终端

与 Bash 同源：Git Bash + node-pty（ConPTY）+ xterm.js，实现参考 VS Code / Hyper；dela 桥函数同样注入项目终端。本机须装 Git for Windows，缺失时明确报错，不回退 PowerShell。远程项目的终端是本地 `ssh -tt` 申请远端 PTY，远端不需要 node-pty；该终端不注入 dela 桥，但可以让 ssh 自己问密码与主机指纹。

## 工程与交付

Node 24.21.0、pnpm 12.3.4（先执行 `. ./scripts/use-local-tools.ps1` 等价前置）；其余版本以 package.json 与锁文件为准，精确依赖。检查链：format + lint + typecheck + test + build + smoke。应用 CI 仅 Windows；helper 在 Ubuntu 用固定 Go 1.27.2 测试并构建 Linux amd64 静态产物，再传给 Windows 打包并核对包内文件。Go 测试只访问 runner 本机，CI 不启用真实 SSH 联调；需要真机的远程用例集中在 `pnpm test:remote`（`DELA_REMOTE_HOST`），默认测试套件与 CI 都不收集它们。electron-builder 产出 NSIS 安装包；better-sqlite3 与 node-pty 必须在打包产物中实测加载。密钥、个人数据与本地工具不进 Git 与安装包。

## 本次删除清单（2026-10-08 基座重构）

自研执行循环（core/run、pi 流包装、预算与修剪）、上下文组装与压缩（context/）、九个自研内核工具（tools/kernel/，含 ReadSkills 与 Bash 长任务让出）、Run 状态表与 projects 档案表、session/manager。

## 文档

每篇 ≤2000 字：technical-plan（本文）、development、release、devlog（短条目）、background；必要时分文件，不写长文。
