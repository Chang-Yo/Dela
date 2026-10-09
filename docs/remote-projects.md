# 远程项目规划

日期：2026-10-09。状态：阶段 0–4 已实施，实机（Ubuntu 24.04 / x86_64 / root）跑通传输层与七个工具；阶段 5 未做。参考 `tech-1.md`（SSH 客户端体积）与 `tech-2.md`（远端运行时架构）。

## 结论

走「本地内核 + 远程执行」：Pi 内核、模型密钥、会话 JSONL、skills、系统提示留在本地，只有工具执行、终端与文件读写落到 SSH 远端。不把内核搬到远端（用户 2026-10-09 决定）。

传输层用一个端口隔离：优先使用系统 OpenSSH（`ssh.exe`/`sftp.exe`），自带 OpenSSH 二进制作为回退接进同一端口（用户 2026-10-09 决定）。工具、终端、目录树、@ 候选都只依赖这个端口，因此回退只是换一个可执行文件路径。本轮交付阶段 0–4；远程预览与远程笔记写回（阶段 5）另外评估。

依据（已核对 `@earendil-works/pi-coding-agent@1.1.0` 代码）：

- Pi 为每个内置工具提供 `operations` 注入点，注释即写明可委派给远程系统（例如 SSH）。read/write/edit/bash/ls/find 复用 Pi 的参数 schema、描述、截断与格式化，只换后端；grep 是例外（内部固定 spawn 本地 rg），需自写同名工具。
- `customTools` 中同名工具覆盖内置：`agent-session.js` 对 definition 与 tool 两个注册表都做无条件 `Map.set`。`excludeTools` 在合并之后过滤，因此远程会话**不能**把要覆盖的工具名放进 excludeTools。
- 会话 cwd 直接用远程 POSIX 路径：系统提示的 `<cwd>` 段是纯字符串（`cwd.replace(/\\/g, '/')`），无需改写；`SettingsManager.inMemory`（Dela 已在用）避免本地 mkdir 出镜像目录；`SessionManager.create(远程路径, userData/pi/sessions)` 只把 cwd 写进会话头，JSONL 仍落本地；`DefaultResourceLoader` 在 cwd 本地不存在时逐项降级、不抛错（读源码判断，实施首日需实跑确认）。

不照抄 tech-2 的远端 daemon：常驻服务、SEA/pkg 单文件分发、环形缓冲与断线续传、远端 MCP 宿主、远端会话存储，都需要新增构建与分发链路（本仓库打包只收 `out/**/*` 与包元数据，见 `electron-builder.yml`），服务的目标是「客户端关掉后 agent 继续跑」。本轮不做；若将来要做，走 Pi 已有的 RPC 模式（`pi --mode rpc` 与导出的 `RpcClient`），是独立工程。

## 已核对的事实

- 本机 OpenSSH 客户端存在：`C:\WINDOWS\System32\OpenSSH\ssh.exe`、`C:\Program Files\OpenSSH\ssh.exe`（`ssh -V` = OpenSSH_for_Windows_10.0p2），`sftp.exe` 同目录存在；已有 `~/.ssh/config` 与 `id_ed25519`。→ 默认路径下安装包体积增量为 0：Dela 只存目的地字符串（`gpu-box` 或 `user@10.0.0.5`），端口、密钥、跳板由 ssh 按 config 解析，不新增凭据存储。
- 同源参考：SDK 自带 `examples/extensions/ssh.ts`（read/write/edit/bash 委派）与 `examples/extensions/gondolin/index.ts`（七个工具全量委派，含自写 grep）。
- 聊天工具卡片按工具名、输入字段与输出 text 渲染（`renderer/content/chat/tool-views.tsx`），不读 `details`；同名远程工具 UI 零改动。
- `terminal.ts` 的 node-pty 管线可原样承载本地 `ssh -tt`：远端 PTY 由 ssh 申请，不需要在远端部署 node-pty。
- `workspaceEntryIdSchema` 已接受 `/` 开头的绝对路径条目；远程子条目 id 用「项目 id + 远端路径」（`shared/remotes.ts` 的 `remoteNodeId`），避免两台连接上的同路径目录共用同一个 id。

待验证（实施首日先做）：以远程 POSIX 路径作 `createAgentSession({cwd})` 是否全程不抛错；Windows OpenSSH 客户端不支持 ControlMaster 多路复用（若属实则每次调用都是一次握手与认证，长连接或自带回退的收益由实测延迟决定）。

## 实施结果（2026-10-09）

已实施并验证：

- `main/remotes/transport.ts`：唯一传输边界，全部走 `ssh <host> <script>`，不引入 SFTP（列目录用 `find -printf '%y\0%f\0%s\0%T@\0'` 的 NUL 分隔输出，读取写走临时文件加 `mv -f`）。系统 OpenSSH 优先，`vendor/openssh`（开发）/ `resources/openssh`（打包）作为回退——自带二进制已随包分发（Win32-OpenSSH 10.0.0.0p2 的 `ssh.exe` + `libcrypto.dll`，见 `vendor/openssh/README.md`），`electron-builder.yml` 用 `extraResources` 拷到 `resources/openssh`。
- `main/remotes/operations.ts`：六个 `operations` 复用 Pi 的工具定义，grep 保留 schema 与描述、自写 execute（远端无 rg 时退回 `grep -rnH`）。目录清单带 10 秒缓存，避免 `ls` 逐条 stat 变成十几次往返。
- 会话接线：`agent/environment.ts` 走远程分支（无 dela 桥、远程追加系统提示、`disabledTools` 里剔掉七个内置名），`agent/session.ts` 的 `sessionCwd` 对远程项目跳过本地存在性检查，`terminal.ts` 的 `terminal:create` 走 `ssh -tt`。
- 数据：`remotes(id,label,host,port,key_path,created_at)` + `workspace_entries.remote_id`（schema v3，只加列）。
- 实测延迟：每次 ssh 调用约 0.3–0.6 秒（Windows OpenSSH 无 ControlMaster）；`createAgentSession` 以远端 POSIX 路径作 cwd 正常，七个工具名下的生效定义确为 Dela 注入的远程版本（`getAllTools()` 的 `sourceInfo.source='sdk'`）。
- 实机用例（`DELA_REMOTE_HOST` 打开才跑）：传输层 6 项、七个工具 11 项、主进程链路 6 项（存连接与自检、从主目录浏览并能进能退、不存在目录的报错、登记项目并列一层目录与生成 @ 候选索引、重复登记去重、有项目在用连接时拒绝删除），另单独核对了远程终端命令 `ssh -tt <dest> "cd '<path>' && exec bash -li"` 在真实主机上确实进到项目目录并起交互登录 shell。
- 真实窗口验收：`pnpm smoke:remote`（`DELA_REMOTE_HOST`，可选 `DELA_REMOTE_KEY`；未设则跳过并退出 0）用真 preload、真 renderer、真主进程 IPC 与真 ssh 走一遍——新建项目 › 连接远程目录 › 新建连接 › 填目的地与私钥 › 连接（自检显示主机名·系统·架构）› 选目录（列主目录，点进夹具目录）› 添加为项目，然后断言：目录树有远端文件、云朵提示是 `<目的地>:<远端绝对路径>`、点目录才懒加载下一层、点远端文件只给「远程文件的打开与预览在下一阶段」且不新开标签、`remoteId` 已到渲染端、@ 候选索引返回相对路径、远程终端（真 node-pty 起 `ssh -tt`）落在项目目录并能执行命令（`echo MARK-$(pwd)` 的绝对路径同时出现在事件流与终端快照里），最后断言控制台无 warning/error。

与原规划的偏差：不用 SFTP；`remotes` 表按主机/端口/密钥文件三列存（不是 `destination`+`extra_args`，因为要显示与校验，跳板仍由 `~/.ssh/config` 承担）；没有实现「会话创建时采集远端环境拼进系统提示」；远端目录树的刷新是收起再展开重读一层（渲染端按需加载，不轮询）；@ 候选来自 `remoteReferences` 的一次索引（上限 3000 条，按项目缓存在本次运行内）。

未做：远端环境采集；阶段 5（远程文件预览与远程笔记写回）；密码与跳板认证（交互终端里 ssh 可以自己问密码，但工具调用只用密钥/BatchMode）。阶段 6（远端 Go helper、实时目录树与预览、远端 skills 进上下文）另见 `docs/remote-helper.md`（草案，未实施）。

## 数据模型

- 新表 `remotes(id, label, host, port, key_path, created_at)`：主机、端口、密钥文件分开存，跳板与默认端口留给 `~/.ssh/config`。
- `workspace_entries` 增列 `remote_id TEXT NULL`（schema v2→v3：加列并建表）。项目身份仍是条目 UUID，`local_path` 存远程绝对路径；`WorkspaceEntry` 增加可选的 `remoteId`，渲染端据此显示角标并把打开动作路由到远程 API。
- 唯一解析入口 `projectLocation(id)` 返回 `{kind:'local',path} | {kind:'remote',remoteId,path}`，并按已登记的远程项目根判断某个路径属于哪个远程项目。下列调用点必须先过它并显式处理远程分支，否则会拿远程 POSIX 路径调用本地 fs：`agent/session.ts` 的 `sessionCwd`、`terminal.ts` 的 `terminal:create`、`workspace/api.ts` 的 `projectDirectory`/`entry`/`fileEntry`/`createWorkspaceEntry`/`updateWorkspaceEntry`/`openProjectDirectory`/`linkProjectFolder`、`workspace/ipc.ts` 的 `watchWorkspace` 与 `open-local`。（`updateWorkspaceEntry` 对远程项目直接拒绝重命名与移动；`entry()` 拒绝远端绝对路径。）
- 尚有项目在用的远程连接不允许删除，提示先移除项目。

## 阶段与验收

**阶段 0 · 传输端口与连接管理**：`main/remotes/transport.ts` 定义端口（exec 流、读取、写入、列目录、stat、重命名），先实现系统 OpenSSH 后端（子进程 + `sftp -b -` 批量），再以自带 OpenSSH 二进制作为同一实现的回退（探测顺序：系统路径 → 自带目录）。设置页按现有语义加「远程」小节（状态点绿=可用灰=未连接，主操作用主色按钮）；连接测试 `ssh -o BatchMode=yes -o ConnectTimeout=8 <dest> true`。新增 `main/remotes/{api,ipc}.ts`、`shared/remotes.ts`、`preload/remotes.ts` 并注册。

**阶段 1 · 远程项目条目**：新建项目弹窗（`workspace/entry-dialogs.tsx`）加「连接远程目录…」，填目的地与远程路径，用 `test -d` 校验后登记条目；树里加角标。

**阶段 2 · 远程目录树与 @ 候选**（用户要求纳入本轮）：按需列目录（展开时拉一层，带缓存与失效），远程子条目 id 用远程绝对路径；窗口聚焦与每轮对话结束后刷新。@ 候选来自打开项目时的一次远程文件索引（`rg --files` 带上限采样，索引不可用时退化为按目录懒加载），候选源在现有 `useReferenceOptions` 基础上增加远程分支。

**阶段 3 · 远程终端**（收益大、改动小）：`terminal:create` 分支为 `spawn(sshExe, ['-tt', ...连接参数, "cd '<path>' && exec bash -l"], {cwd: 本地目录})`，写入、缩放、退出沿用现有管线；不注入 dela 桥，标题显示目的地。

**阶段 4 · 工具远程化**：`main/remotes/operations.ts` 基于传输端口实现六个 `operations`；grep 自写同名工具（`{ ...createGrepToolDefinition(cwd), execute }` 保留 schema 与描述，搜索走远端 `rg`，无 rg 时退 `grep -rn`）；`agent/environment.ts` 在远程会话把这七个 `customTools` 交给 Pi，并按用户已关闭的能力名单裁剪。写入走临时文件加 `mv`；bash 的 `onData` 直接喂现有流式工具卡片。会话创建时一次采集远端环境（`uname -a; nproc; free -g; nvidia-smi -L; git -C <path> status --short`）拼进追加系统提示（借鉴 tech-2 §4）。

**阶段 5 · 后续（本轮不做）· 文件读取、预览与远程笔记**：文档区打开远程文件（文本与代码只读、Markdown、图片与 PDF 走受限资源协议、改由传输端口供给）；远程项目内的新建笔记与编辑写回远端，需要把 `saveWorkspaceNote`/`editWorkspaceNote` 的本地 fs 路径改走端口并保留现有 revision 冲突语义。`code --remote ssh-remote+<dest> <path>` 作为外部打开入口。

验收：路径归一化与 operations 命令串的单元测试（注入假 exec，不需要真实主机）；`pnpm check`；`pnpm build` 与打包后启动；一台真实 Linux 主机上逐项跑七个工具、远程终端、目录树展开与 @ 候选，以及断线时的报错文案。

## 风险与降级

- **路径归一化（最高风险）**：工具在调用 operations 之前用宿主 `node:path` 解析参数。本机实测：`path.resolve('/home/u/proj','src/a.ts')` → `E:\home\u\proj\src\a.ts`；`path.resolve(cwd,'/home/u/x')` → `\home\u\x`。operations 必须先去盘符前缀、再把 `\` 换成 `/`、合并重复斜杠后才拼命令，并有单测覆盖这几组实测输出。这是唯一会静默改错文件的点。
- 远程会话里没有 dela 校园命令（本地 127.0.0.1 桥远端不可达）；后续可选 `ssh -R` 反向转发，先评估暴露面。
- 自带 OpenSSH 二进制实测：`ssh.exe` + `libcrypto.dll` 共 3.1MB（zip 5.4MB；NSIS 压缩后更小），导入表只依赖 Windows 自带 DLL，无 VC++ 运行库依赖；许可文本随包（`vendor/openssh/{LICENSE,NOTICE}.txt`）。只在系统缺少 `ssh.exe` 时启用。
- 无远程文件监听：以懒加载加聚焦刷新近似，缓存失效要明确（否则树与 @ 候选显示过期内容）。
- 连接是「一次调用一个 ssh 子进程」，没有多路复用。实测：短时间并发握手太多时主机会直接断开（`Connection closed by <host> port 22`），`pnpm vitest run src/main` 并行跑三个真机测试文件就会偶发；串行（`--fileParallelism=false`）稳定全过。App 侧一次工具调用只有一条连接，但若模型并发发起多个工具调用就可能撞上主机的 MaxStartups——是否加重试或限流待评估（重试要只针对握手层错误，不能掩盖认证失败）。
- 真机测试的跑法：`. ./scripts/use-local-tools.ps1; $env:DELA_REMOTE_HOST='root@…'; $env:DELA_REMOTE_KEY='…'; pnpm vitest run src/main/remotes --fileParallelism=false`。
- 远程条目 id 带项目身份（`<项目 UUID>:<远端路径>`），与本地「路径条目」共用同一命名空间；`entry()` 必须先判远程根，禁止把远程路径交给 `statSync`。裸远端路径只在唯一归属时可用，多个项目都装得下时 `remoteProjectOf` 直接报错。
- 连接断开即当前调用失败并给出明确错误，不做自动重连与续跑。

## 已定与待决

已定（2026-10-09）：本地内核 + 远程执行；系统 OpenSSH 优先、自带 OpenSSH 二进制回退；目录树与 @ 候选纳入本轮；本轮交付阶段 0–4。

待决：目标主机是否只用密钥与 ssh agent（当前结论：工具调用只支持密钥/BatchMode，密码可以在远程终端里交互输入）；阶段 5 的排期。
