# 远端工具服务（helper）：规划与 v1 实施记录

日期：2026-10-09 起。状态：**6.0–6.3 已实施并实机验证**（2026-10-09/10）；6.4 的 arm64 支持、受限环境检测与文案、端口预览已实施（2026-10-10），JS 扩展宿主仍不做。前置：`docs/remote-projects.md`（阶段 0–4 已实施并实机验证）。第二轮修订：吸收一份外部审阅意见（见文末「审阅意见处理」）。

## 结论（已定）

- helper 用 **Go** 写，纯静态二进制（`CGO_ENABLED=0`），一个架构一个文件。
- 只有**两种执行方式**：helper 通道（主）与现有的一次性 ssh（引导 + 降级）。**不做**常驻 shell 协议档。
- **不在远端跑 Agent**：内核、模型密钥、会话 JSONL、系统提示仍在本机。
- 远端项目内**不支持新建笔记**（用户已接受）；**文件预览已做**（6.3）。
- 实施顺序：6.0 远端文件身份 → 6.1 最小 helper → 6.2 上下文与 skills → 6.3 目录树刷新、watch、预览与传输，**均已完成**；6.4 里做了 **arm64 随包支持、受限环境检测与文案、端口预览**（2026-10-10），JS 扩展宿主仍不做，产品上够用即可。

## 审阅意见处理

| 审阅意见                                                    | 处理         | 依据                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 删除 A 档常驻 shell 协议                                    | 采纳         | 三套行为无法维护；帧边界、并发、取消、二进制输出等于再写一个 helper                                                                                                   |
| 6.1 用一次性 ssh 却要求延迟下降（自相矛盾）                 | 采纳         | 该阶段改为「最小 Go helper」                                                                                                                                          |
| 「任何失败都自动降级」需限定范围                            | 采纳         | 见「引导与恢复」：通道恢复与操作重试分开，结果未知时不重放有副作用的操作                                                                                              |
| 五分钟退出应依据客户端心跳                                  | 采纳         | 见「心跳与生命周期」；并更正「通道干净关闭即退出」的说法（`setsid` 后 helper 感知不到通道）                                                                           |
| skills 逐项注入没有解决路径问题，需撤回「不动现有路径处理」 | 采纳         | 已核对 SDK：系统提示与展开块都用 `skill.filePath`（`skills.js` 的 `<location>`），`/skill:name` 用 `readFileSync(skill.filePath)` 本地直读（`agent-session.js:1675`） |
| `AGENTS.md` 可用 `agentsFilesOverride`                      | 采纳         | 已核对 `resource-loader.d.ts`：`agentsFilesOverride?(base:{agentsFiles:{path,content}[]})`                                                                            |
| 长任务、取消、输出限制进第一版                              | 采纳         | 见「任务模型」；现有实现只 `child.kill()` 本地 ssh，不保证远端进程树停止                                                                                              |
| 先修远端文件身份                                            | 采纳         | 见「远端文件身份」；现有实现以纯路径作缓存键与条目 id，跨连接会串                                                                                                     |
| `MaxStartups` 只是推断、缺服务端证据                        | **部分推翻** | `sshd -T` 显示默认 `maxstartups 10:30:100`，但实测 12 条与 30 条并发握手**全部成功**；因此不再把它当作 helper 的理由，先前那几次偶发失败**原因未定位**                |
| 「只换底层 exec」不够                                       | 采纳         | helper 的收益要落到 `fs.list`/`fs.stat` 批量/`fs.read` 分段等接口上才成立                                                                                             |
| 实时目录树需要事件丢失后的重扫                              | 采纳         | `fsnotify` 不递归、NFS/FUSE 事件不保证、队列会溢出                                                                                                                    |
| 「一次性 SSH 功能齐全、只是慢」不成立                       | 采纳         | 见「降级后不可用的能力」                                                                                                                                              |
| Node SEA 不要求服务器预装 Node                              | 采纳更正     | C 档的成本是每平台 50–100 MB 与构建矩阵，不是「远端必须装 Node」；选 Go 的理由改为体积、矩阵与构建简单                                                                |

## 为什么需要 helper（实测依据）

| 事实                       | 证据                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 客户端没有连接复用 | `ssh -o ControlMaster=auto -o ControlPath=…` → `getsockname failed: Not a socket`；`ssh -O check` 同样失败                                                     |
| 每次调用都要新握手         | 实测同一主机：常规 0.3–0.6 秒/次，冷启动 4.2 秒/次。30 条并发握手 6 秒内全部成功                                                                               |
| 能力缺口（跟握手无关）     | 无文件监听、无法只取文件片段、二进制要 base64、`ls` 逐条 stat 只能靠 10 秒缓存、长任务无法取消                                                                 |
| shell 行为差异             | 列目录依赖 GNU `find -printf`（无 GNU find 时退 `ls -A1p`）；远端普遍没有 `rg`；命令输出的编码/截断全在本机处理                                                |
| 远端环境（采样一台）       | Ubuntu 24.04.5 / x86_64 / glibc 2.39 / root；`node v24.21.0`、`npm`、`python3`、`gcc`、`curl`、`tar`、`sha256sum`、`setsid`、`nohup` 均在；无 `rg`、无 `socat` |
| 回环 + 隧道可行            | 远端 `127.0.0.1:19999` 监听成功；本地 `ssh -L` 转发**补测通过**（见 6.1 实测证据）                                                                             |

**结论**：helper 的理由是**握手延迟 + 能力缺口 + 命令语义差异**，不是「主机拒绝并发」。既然 Windows 侧拿不到连接复用，远端常驻进程是唯一能同时解决这三条的路。

## 目标与非目标

**目标（让远程项目像本地项目一样）**：目录树实时、文件预览可用、仓库自己的规矩（`AGENTS.md`）与技能进上下文、可上传本地 skill 到远端、长任务稳定可控、可选预览远端端口。

**非目标**：远端跑 Agent、远端会话存储、断线续跑；远端项目内新建笔记；远端 `dela` 校园命令；helper 内实现 PTY（终端继续 `ssh -tt`）；v1 只支持 Linux 远端（Windows 远端待决）。

## 两种模式与降级边界

| 模式        | 用途        | 说明                                                                                                                                   |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| helper 通道 | 日常执行    | 上传校验、启动、`ssh -L` 隧道、握手、常驻；**已接**工具、目录树清单（6.3）、目录 watch（6.3）、预览与传输（6.3）；@ 索引仍走一次性 ssh |
| 一次性 ssh  | 引导 + 降级 | 上传与启动 helper 的手段；helper 不可用时承接全部远程能力                                                                              |

**当前实施状态**：`read`/`write`/`edit`/`bash` 与自写的 `grep`（内部用 `bash`）走通道；目录树的清单从 6.3 起也走通道（`/v1/fs/list`，约 11× 快），`ls`/`find` 里的列目录与 glob 仍是一次性 ssh（它们本来就只花一次往返）；预览的片段读取（`/v1/fs/read?offset&length`）与上传（`/v1/fs/write`）同样通道优先。

**降级后不可用的能力**（必须在 UI 明说，不能含糊成「只是慢」）：大文件按需片段读取（退化为整文件读取）、二进制上传下载（退化为一次性 ssh 的 base64 往返，慢且占内存）、服务端哈希、`ls` 的精确 stat（退化为 10 秒缓存）、长任务的取消与状态查询（只能杀本地 ssh，远端进程可能继续跑）、**Dela 之外改动远端文件后的实时刷新**（`/v1/watch` 挂在通道上，没有 helper 就没有它）、**端口预览**（清单走 `/v1/ports`，不为一次性 ssh 解析 ss/netstat 的方言再造一套）。降级时目录树顶部会显示一条带原因的提示（见「受限环境检测与文案」）。**仍然可用**：七个工具、终端、@ 候选（一次性索引）、读写与编辑、目录树与按需预览、上传下载（走降级通道）、系统默认程序打开（先整篇下到临时目录）。**注意**：降级路径确实存在但**没有真机验证过**——本机唯一测过的远端环境有 OpenSSH 且 helper 能跑，所以「没有 helper 的世界」目前只有代码路径与离线单测，没有端到端证据。

## 协议（v1 已实施）

**通道**：`ssh -L 127.0.0.1:<本地端口>:127.0.0.1:<helper端口>`；helper 只绑回环；请求 HTTP/JSON，流式用 SSE。**鉴权**：随机 token 写在远端 `0600` 文件里（不从命令行传，命令行会出现在 `ps` 里），每请求带 `Authorization: Bearer`。

下表的「状态」列区分**已实施**与**草案**，不要把草案当能力读。已实施部分的协议在 `helper/README.md` 有一份同样的表。

| 状态   | 方法   | 路径                                | 用途                                                         | 相对草案的偏差                                                                                               |
| ------ | ------ | ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 已实施 | GET    | `/v1/hello`                         | 协议与版本协商（只回这两个字段）                             | 不回 features/pid/platform/home：唯一调用方只查版本                                                          |
| 已实施 | POST   | `/v1/heartbeat`                     | 客户端心跳                                                   | 无 `clientId`                                                                                                |
| 已实施 | POST   | `/v1/fs/list`                       | 列一层（lstat 语义，符号链接算文件）                         | 只回 `{name,path,directory,size,modifiedAt}`，不回 mode                                                      |
| 已实施 | POST   | `/v1/fs/stat`                       | 批量状态（不存在的路径也回一条）；远端预览取 size/mtime 走它 | 无                                                                                                           |
| 已实施 | GET    | `/v1/fs/read?path=&offset=&length=` | 片段读取，字节流                                             | 改 GET + 查询串（片段读天然是 GET 语义，curl 也好验）                                                        |
| 已实施 | PUT    | `/v1/fs/write?path=`                | 原子写（同目录临时文件 + rename）                            | 父目录必须先存在，建目录由调用方负责（与 Pi 的 mkdir 调用对齐）                                              |
| 已实施 | POST   | `/v1/exec`                          | 起任务，SSE 流式输出                                         | 事件类型固定为 `start`/`stdout`/`stderr`/`exit`，`data` 一律 base64                                          |
| 已实施 | POST   | `/v1/exec/:id/cancel`               | 取消任务（终止整个进程组）                                   | 无                                                                                                           |
| 已实施 | POST   | `/v1/watch`                         | 替换某个 id 的目录监视集合                                   | 幂等；只订结构变化（不进 `IN_MODIFY`）；返回 `watching` 与 `skipped[]`                                       |
| 已实施 | DELETE | `/v1/watch?id=`                     | 取消某个 id 的监视                                           | id 不存在也算成功                                                                                            |
| 已实施 | GET    | `/v1/watch`                         | 目录事件（SSE）                                              | `data:` 里直接是 JSON（exec 那条是 base64）；事件 `change`/`reset`；安静时每 30 秒一条 `: keep-alive` 注释帧 |
| 已实施 | GET    | `/v1/ports`                         | 远端监听端口（回环与通配，helper 自身除外）                  | 6.4 做，已实施（2026-10-10）                                                                                 |
| 已删   | POST   | `/v1/shutdown`                      | 显式停止                                                     | Dela 不发退出请求（用户 2026-10-09 定），SIGTERM 已足够                                                      |
| 已删   | POST   | `/v1/fs/hash`                       | 服务端 sha256                                                | 没有调用方：上传复核走一次性 ssh 的 `sha256sum`（2026-10-10 删）                                             |
| 已删   | GET    | `/v1/tasks`                         | 任务状态                                                     | 没有调用方：取消走 `/v1/exec/:id/cancel`，状态在 SSE 的 `exit` 里（2026-10-10 删）                           |

**任务模型（已实施）**

- 任务有 `taskId`；状态机：`running → exited | cancelled | timeout`。**没有 `lost`**：通道断了由客户端判「结果未知」，helper 侧只按取消处理。
- **执行语义**：命令用 `bash -lc` 跑（带 `cwd` 与过滤后的 `PI_*` 环境变量），与一次性 ssh 的 `cd … && cmd` 保持同一套语义，所以同一段命令在两条路上行为一致；`bash` 不存在时直接失败，不静默换 shell。
- **进程组**：`Setpgid` 起新进程组，取消/超时对**整组**发 `SIGTERM`，5 秒宽限后 `SIGKILL`。实测：`sleep 300 & sleep 300 & wait` 取消后远端 `sleep` 进程数为 0。
- **超时**：由 helper 裁定；超时的任务 `state=timeout`，退出码不再覆盖状态（`code` 可能是 0，客户端按 state 判）。客户端再把 `timeout` 映射成 Pi 认的 `timeout:<秒>`。实测 `timeoutMs=1000` 时 `durationMs≈1001`，无残余进程。
- **客户端失联**：不靠心跳，靠**请求上下文断开**——SSE 连接一断，helper 立刻终止该任务的进程组。实测 kill 掉 curl 后远端进程 2 秒内消失。
- **输出**：按字节传（base64），stdout 与 stderr **共用** 8 MB 额度，超出部分丢弃并计数，`exit` 事件带 `discarded`；Dela 侧补一条「已丢弃 N 字节」说明。实测 12 MB 输出下 `discarded=3769287`。
- **结果区分**：`exitCode`（跑完了）／传输错误（通道断了）／结果未知（通道在任务中途断）三者分开；未知时不自动重放。

**心跳与生命周期（已实施）**

- heartbeat 是**独立信号**，与是否有工具调用无关：Dela 每 30 秒对当前通道发一次；helper 连续 **5 分钟**收不到任何请求即退出，并终止在跑的任务。实测：用 `--idle-timeout 5s` 起一个实例，12 秒后进程自行消失且 `run.json` 被清理。
- **Dela 退出不发退出请求**（用户 2026-10-09 定）：本地只停心跳、杀掉 `ssh -L` 隧道；远端 helper 最多再活 5 分钟自退。理由：少一次远端往返，也少一类「请求发不出去」的半开状态。要立刻收掉就 `kill <pid>`，SIGTERM 走的是同一条优雅停止路径。
- **helper 属于连接，不属于项目**：Dela 同一时刻只保一条通道，切到别的连接就放掉旧的（`closeHelper`）。**没有 `clientId` 与多窗口引用计数**：Dela 是单窗口应用，多窗口场景出现前不加。
- **更正上一稿**：`setsid nohup` 之后 ssh 通道关闭 helper 感知不到，所以「干净关闭 → 立即退出」不存在；退出只有两条路——空闲超时、SIGTERM。
- `--port 0` 由系统分配端口，真实端口与 pid 写进 `--run-file` 指定的 JSON（`0600`，用于排查残留进程），启动时也往 stdout 打一行给人看。**没有 `--stop`**（`kill` 就够），**旧版本目录不自动清理**（每版一个目录，便于回退）。

## 引导与恢复

| 步骤     | 做法                                                                              | 失败时                                         |
| -------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1 探测   | 复用现有 `probeRemote` 的形态：`uname -s` / `uname -m` 决定用哪个架构的产物       | 非 Linux、非 x86_64/arm64 → 降级               |
| 2 查缓存 | 远端 `~/.dela/helper/<版本>-<sha8>/dela-helper` 存在且 sha256 一致就跳过上传      | 不一致 → 重传                                  |
| 3 上传   | 二进制转 base64 走 `ssh` 的 stdin（不过 shell 解析），落盘后 `sha256sum` 复核     | 复核不符／磁盘满 → 抛错并降级                  |
| 4 启动   | 一条 ssh：写 `0600` token、`setsid nohup … --port 0 --run-file …`、读回端口与 pid | 起不来／`noexec`／SELinux → 带上日志尾部并降级 |
| 5 转发   | `ssh -L`（`ExitOnForwardFailure=yes`，连接参数与其它调用同源）                    | 绑定失败／超时 → 降级                          |
| 6 握手   | `GET /v1/hello` 校验协议号与 helper 版本                                          | 不匹配 → 抛错并降级（远端跑的不是这一版产物）  |
| 7 常驻   | 工具（read/write/edit/bash/grep）与目录清单、目录 watch、预览与传输都接在通道上   | 通道不可用 → 这些调用退回一次性 ssh            |

**没接到通道上的**：@ 索引仍走一次性 `ssh`（一次调用，正确性没问题）。这在代码里是明写的，不是遗漏。

**向导的「连接」这一步会真的走一遍引导（2026-10-10 起）**：填好连接点「连接」时，Dela 先做一次自检，再把 helper 上传、校验、启动、建隧道并握手，过程以窗口事件 `remotes:setup-progress` 逐行推到向导的日志区（探测 → 上传 → 校验 → 启动 → 隧道 → 握手 → 就绪）。这样做是为了让「项目加进来了但又慢又不刷新」在添加项目之前就暴露出来，而不是等第一次调工具才失败。**helper 起不来不阻断流程**：那只是降级回一次性 ssh（同上表的第 7 行），界面给一条警告行并允许继续；只有自检失败才停下让人回去改目的地。

**通道恢复与操作重试是两件事**：

- **可自动重试**：建立通道、握手、只读查询（`fs.list`/`fs.stat`/`fs.read`）与 `write`（同内容重复写结果相同）。
- **不可自动重放**：`exec`。通道在任务中途断掉时远端**可能已经执行**，自动再跑一次可能重复提交、重复部署。**已实施的行为**：`bash` 走通道失败时直接报错并丢掉通道（下次调用重新建立），绝不退回一次性 ssh 重跑；读与写才允许回退。
- helper 用非 2xx 回的业务错误（路径不存在、参数越界）**不算通道故障**：原样抛给调用方，不拆通道也不重跑（`HelperHttpError`）。

## 远端文件身份（已实施 2026-10-09）

**当时的现状（已修）**：

- `renderer/navigation/remote-tree.ts` 用**纯远端路径**作目录清单缓存键、展开键与行 id（`listings[path]`、`id: child.path`），跨连接无区分。
- `main/workspace/api.ts#remoteProjectOf` 按路径前缀在**所有**远程项目里找第一个匹配。
- 两台服务器上都有 `/home/user/app`（或一台的 `/home` 与另一台的 `/home/user/app`）时会串：清单被覆盖、条目归属错、@ 候选混、行提示显示错连接。

**实际改法**：

- 远端条目身份 = **项目 id + 远端路径**：`shared/remotes.ts` 的 `remoteNodeId(projectId, path)` 生成、`parseRemoteNodeId` 解析（项目 id 是 UUID，与盘符冒号不会混淆）。
- `remote-tree.ts` 的清单缓存键、展开键、失败记录与行 id 全部换成该复合身份，并且**每个项目只从自己的根往下走**（归属不再依赖对远端路径的再次解释）。
- `remoteProjectOf` 先用项目 id 精确解析；裸远端路径只在唯一匹配时归属，多个项目都装得下时抛「同时属于多个项目，无法确定归属」，不猜。
- 远端子条目不进数据库（只活在组件状态与本次运行的索引里），**没有持久化迁移负担**。

**验收结果**：新增「同路径两台连接不串」的渲染端用例与两条主进程用例（改前 4 条失败）；全量单测 71 文件 538 通过；真机串行 8 文件 47 通过；`pnpm smoke:remote` 真窗口通过（@ 候选与远程终端照旧）。

**未做**：@ 候选的索引键仍是 `remoteJoin(项目根, 相对路径)`，只在同一项目内使用，暂无跨连接歧义；等预览阶段需要跨项目引用时再统一。

## 上下文与 skills

**撤回上一稿的承诺**：不再假设「不动现有路径处理」。已核对 SDK 的三处行为：

1. 技能列表进系统提示时用 `<location>${skill.filePath}</location>`，并告知模型「相对路径按 skill 目录解析，命令里用绝对路径」（`dist/core/skills.js`）。
2. `/skill:name` 展开时 `readFileSync(skill.filePath)` **本地直读**，展开块里同样带 `location` 与 `baseDir`（`dist/core/agent-session.js:1675`、`:1677`）。
3. 技能发现本身用本地 `readFileSync` 读 `SKILL.md`。

所以镜像到 Windows 后：**发现与展开能用**（本地有真实文件），但**模型看到的路径会被交给已被替换成远端读取的工具** —— 必须有一条路径映射。

**方案：上下文镜像 + 路径映射**

- 每个远程项目一个镜像根：`<userData>/remote-context/<remoteId>/<projectId>/`，同步 `AGENTS.md` 与三处 skills 的文本文件（不做全量镜像）。
- **映射规则**：所有远端工具入口先把「落在镜像根下的路径」前缀翻译成对应远端路径，再做现有的归一化（`remotePath`）；`read`/`write`/`edit`/`bash`/`grep`/`find`/`ls` 全部走同一函数。这样模型拿 `<location>` 里的镜像路径去读、去跑，落到远端仍是正确文件。
- **位置三分**要写清：本地镜像（发现用）、模型可见位置（`<location>`/`baseDir`，指向镜像，靠映射翻译）、脚本执行位置（远端真实路径）。
- `AGENTS.md`：用 SDK 的 `agentsFilesOverride` 注入远端内容（`path` 写远端路径），不需要镜像，也不依赖本地存在该文件。
- **校园 skills 在远程会话要摘掉**：改前远程分支仍传 `skillPaths: [builtinSkillsDirectory()]`，而内置技能正文教的是 `dela` 命令——远端没有。现在远程会话只加载镜像里的仓库/服务器技能。
- 刷新：会话开始时读一次；有 helper 时由 `watch` 事件刷新；无 helper 时在打开项目/手动刷新/每轮对话结束时读；**接 watch 这件事还没做**（6.3 已把通道做好了）。

**三处远端 skill 位置与优先级**：`<仓库>/.agents/skills`（Pi 原生）＞ `<仓库>/.dela/skills`（Dela 专属，随仓库进 git）＞ 服务器 `~/.dela/skills`（同服务器所有项目共享）。

**上传（本地 → 远端）**：设置页技能列表加「上传到远端项目…」；目标 `<仓库>/.dela/skills/<名字>/`，含 `SKILL.md` 与附属文件；同名需确认覆盖；上传后立即刷新镜像。技能里的脚本在远端执行（用远端自己的 Node/Python），与 helper 语言无关。

**验收**：远端 `AGENTS.md` 的暗号能被远程会话引用；`/skill:name` 展开内容与远端文件一致；三处位置的技能都出现在列表并可触发；上传后远端文件逐字节一致且进 `git status`；映射单测覆盖「镜像路径 → 远端路径」与「普通远端路径不受影响」。

## 预览与传输

- **已实施（6.3 第三批）**：`fs.read` 的 `offset`/`length` 做片段读取；文本/代码只读预览、Markdown、图片、PDF、docx/xlsx 复用本地预览组件；远端文件点击不再是「下一阶段」提示。上限：文本/Markdown 头部 4 MB（超出在文末说明）、图片 32 MB（超出明确报错）、PDF/Office 走 Range 分块（每块 1 MB），都不会整篇进内存。
- **已实施**：上传下载走 `fs.write` + `fs.read`（helper 侧临时文件 + rename，失败不留半个文件）；「用系统默认程序打开」= 下载到 `%TEMP%/dela-remote-open` 后 `shell.openPath`，退出清理。上传一次 `PUT`（整篇进内存，未分块），下载按 1 MB 分块。
- 远端 pptx 内嵌预览未做（需要本地文件路径喂 PowerPoint 导出）；远端文件的编辑器内保存未做（远端条目只读，写路径只有整体上传与工具）。
- **watch（已实施，见 6.3）**：`fsnotify` 不递归，需逐层建立监听；NFS/FUSE 不保证事件；事件队列会溢出。因此配了「溢出/丢事件 → 报 reset 让调用方整块重读」；没有做「窗口聚焦/每轮结束 → 轻量对账」（收起再展开即可重读，先不加）。**只监视展开的目录、且 Dela 同时只盯一条通道对着的那个目标**，所以它是「常用路径的实时性」，不是「全量文件系统监控」。

## 与现有代码的接缝

| 文件                                                | 改动                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `main/remotes/transport.ts`                         | 抽出「通道」概念；保留一次性 ssh 作为引导与降级；补「远端进程组终止」语义                                 |
| 新增 `main/remotes/helper.ts`                       | 探测、上传、校验、启动、转发、握手、心跳、显式停止、重连、降级                                            |
| 新增 `main/remotes/context.ts`                      | 上下文镜像与路径映射（含远端 skills 扫描）                                                                |
| `main/remotes/operations.ts`                        | 注入点不变，内部改成**通道优先**：`fs.list`/`fs.stat`/`fs.read`/`fs.write`/`exec`，拿不到再退回一次性 ssh |
| `main/agent/environment.ts`                         | 远程分支：镜像 `skillPaths`、去掉校园 skills、`agentsFilesOverride` 注入 `AGENTS.md`                      |
| `main/agent/pi.ts`                                  | 透传 `agentsFilesOverride`                                                                                |
| `renderer/navigation/remote-tree.ts`                | 复合身份（清单键、展开键、条目 id）——6.0 已实施                                                           |
| `main/workspace/api.ts`                             | `remoteProjectOf` 按复合身份解析；`remoteRoots` 不变——6.0 已实施                                          |
| `main/terminal.ts`                                  | 不改（继续 `ssh -tt`）                                                                                    |
| `main/remotes/documents.ts`、`workspace/preview.ts` | 远端预览：格式判定与本地共用、`dela-resource://remote`（Range 分块）与 `remote-raw`（Markdown 相对图片）  |
| `main/remotes/transfer.ts`                          | 下载（分块 + `.part` 改名）、上传（一次 PUT）、系统默认程序打开（临时目录 + 退出清理）                    |
| `main/remotes/ports.ts`                             | 端口预览：`/v1/ports` 清单、按「目标 + 端口」的 `ssh -L` 隧道注册表（独立于 helper 通道，退出清理）       |
| `workspace/ipc.ts`、`preload/*`、`shared/*`         | 预览、上传下载、远端技能相关通道                                                                          |

不改与远程无关的核心代码；替换前必须先有等价实现。

## 实施顺序与验收

**6.0 · 远端文件身份（已实施 2026-10-09）**
见「远端文件身份」一节：复合身份改造 + 同路径两连接的用例。
验收结果：改前 4 条用例失败、改后全绿；全量单测 71 文件 538 通过；真机 47 通过；真窗口冒烟通过。

**6.1 · 最小 Go helper（linux/amd64）— 已实施 2026-10-09**

代码：`helper/`（Go 模块，只用标准库；`build-helper.mjs` 用 `-trimpath -ldflags '-s -w' CGO_ENABLED=0` 出静态产物 —— **产物必须由 `pnpm build:helper` 生成**，裸 `go build` 会带上调试符号、体积从 6.9 MB 涨到 10.2 MB，而这份二进制要随包分发并上传到远端）、`scripts/build-helper.mjs`（`pnpm build:helper`）、
`src/main/remotes/helper.ts`（探测/校验/上传/启动/隧道/握手/心跳）、`src/main/remotes/operations.ts`（工具接线 + 回退规则）。
工具层改动的三个要点：`bash` 走通道失败**不回退**；`read`/`write` 可回退；`write` 先经通道跑一次 `mkdir -p` 以对齐 Pi 的 mkdir 调用。

**实测证据（真机 `root@47.117.158.218`，2026-10-09）**

- `ssh -L` 转发补测通过：本地 19997 → 远端 19998 的 HTTP 请求拿到 200（helper 路线上唯一没验证过的假设）。
- helper 独立验证（真机 curl 直打回环）：401（无 token／错 token）、400（相对路径、坏 cwd、空命令）、416（offset 越界）、
  1 MB 随机字节往返逐字节相同、含空格与中文的文件名可读写、`exit 7` 退出码正确。上传产物与本地 `sha256` 一致由上传步骤用一次性 ssh 的 `sha256sum` 复核（helper 没有哈希接口）。
- 取消／超时／失联：`sleep 300 & sleep 300 & wait` 取消后进程数 2 → 0；`timeoutMs=1000` 时 `state=timeout`、`durationMs≈1001`、无残余；
  kill 掉客户端 curl 后远端进程 2 秒内消失；输出上限触发 `discarded=3769287`；三个并发任务全部正常结束。
- 空闲自退：`--idle-timeout 5s` 的实例 12 秒后自行退出并清理 `run.json`。
- 延迟对照（8 轮，最小/中位/最大）：一次性 `ssh`（工具真实形态 `bash -lc`）292/300/335 ms；通道 59/62/77 ms；
  通道冷启动（探测+校验+启动+隧道+握手，每条连接一次）3211 ms。
- 自动化：`src/main/remotes/test/helper.test.ts` 10 条（含上传校验、二进制往返、超时、取消不留残余、放掉通道只关本地隧道、重建通道）；
  `operations.test.ts` 新增三条——**工具调用确实走通道**、超时映射成 `timeout:1`、输出被丢弃时补说明。
  真机串行 9 文件 57 条全绿；全量单测 71 文件 541 条通过；`pnpm build` + `pnpm smoke:remote` 真窗口通过。

**顺带修的真问题：SSH 保活**。一次 10 分钟无输出的远端命令会让会话被对端 reset（`clientaliveinterval 0` + 客户端不发保活，
中间的 NAT/防火墙丢连接）；`sshBaseArguments` 现在统一带 `ServerAliveInterval=15`、`ServerAliveCountMax=3`。
带保活后同样的 10 分钟静默没再复现。这也顺带解释了 6.0 之前那几次「并行真机测试偶发 connection closed」，先前只记作偶发，
现在有了可复现的解释与修法。**心跳同时是隧道的保活包**：30 秒一次的心跳让隧道不会长时间静默。

**6.2 · 上下文与 skills —— 已实施**

代码：`src/main/remotes/context.ts`（镜像同步 + 上传）、`operations.ts`（镜像→远端映射 + 命令正文翻译）、
`agent/pi.ts`（`agentsFilesOverride` 透传）、`agent/environment.ts`（远程分支接线）、`agent/skills.ts`（`skillDirectory`）、
`agent/index.ts` + `shared/capabilities.ts` + `preload/capabilities.ts`（`capabilities:upload-skill-to-remote`）、设置页技能列表的上传入口。

实现要点：

- **一次 ssh 取回全部上下文**：一个远端脚本用 NUL 分隔的「路径 + base64 正文」记录输出三处 skills 与祖先目录的
  `AGENTS.override.md`/`AGENTS.md`/`AGENTS.MD`/`CLAUDE.md`/`CLAUDE.MD`（每个目录取第一个命中的），`$HOME` 也在同一次里回传，
  所以不额外付一次 `probeRemote`。软链接不跟随，单文件上限 1 MiB。
- **镜像根**：`<userData>/remote-context/<remoteId>/<projectId>/`（项目 id 里的 `/`、`:` 等换成 `_`）；仓库内容进 `repo/`、主目录内容进 `home/`，
  两条路由让镜像路径能一对一翻回远端。
- **映射是唯一收口**：`remotePath()` 先翻镜像前缀再做原有归一化，七个工具（含 grep）的全部路径入口自动生效；
  `bash` 的命令正文另有一段翻译（换掉前缀后，同一段路径里剩下的 `\` 也要转成 `/`，否则 bash 会把 `\` 当转义吃掉）。
- **AGENTS.md 不落盘**：内容经 `agentsFilesOverride` 追加在本地全局上下文之后，`path` 写远端路径。
- **远程会话不再挂本地校园 skills**：`skillPaths` 只给镜像里真实存在的那几处；Pi 自带的默认位置（本机 `~/.agents/skills`）仍会被发现——那是用户自己的技能，本阶段不动。
- **上传**：目标 `<仓库>/.dela/skills/<名字>/`，逐文件 `mkdir -p` + 临时文件 + `mv`；已存在且未确认覆盖时抛「远端已存在：…」，由设置页弹二次确认；上传后让空闲会话按新配置重建。

**实测证据（真机 `root@47.117.158.218`，2026-10-09）**

- 三处远端技能（`<仓库>/.agents/skills`、`<仓库>/.dela/skills`、服务器 `~/.dela/skills`）取回本地**逐字节一致**；祖先目录的 `CLAUDE.md` 排在 cwd 的 `AGENTS.md` 之前（与 Pi 的注入顺序一致）。
- 镜像路径翻回远端真身：`…/repo/.agents/skills/alpha/SKILL.md` → `<仓库>/.agents/skills/alpha/SKILL.md`；`…/home/…` → `<主目录>/…`；`/etc/hosts` 这类远端绝对路径不受影响。
- 命令正文翻译端到端可用：`bash.exec('cat <镜像路径>')` 在远端读到正确内容（退出码 0）——证明模型从技能 `<location>` 抄下来的路径在 bash 里也能用。
- 上传：2 个文件（含子目录）逐字节一致，`git status --porcelain -uall` 里出现 `.dela/skills/lint/SKILL.md`；同名再传被 `远端已存在：` 拦下，覆盖后再传正文已换。
- 自动化：`test/context.test.ts` 4 条（1 条脱机验证 Pi 真的收下镜像 skills 与 AGENTS.md，3 条真机）、`test/session-options.test.ts` 新增 2 条（只挂镜像技能、远端 AGENTS.md 注入且本地全局上下文不丢）、`operations.test.ts` 的 `remotePath` 新增 3 条（镜像映射、最长前缀、撤销后复原）。真机串行 4 条全绿；全量单测 548 条通过。

**未做与新的风险**

- 只摘掉了 Dela 的校园 skills；Pi 默认位置里**本机 `~/.agents/skills` 仍会进远程会话**（脱机测试里观察到 14 个本机技能随之进来）。要不要一并摘掉取决于产品判断，见「未决」。
- 镜像**只在会话开始时同步一次**；上传或远端改动要等空闲会话重建/下次打开才生效。目录树的刷新已单独做好（工具动作走 `write`/`bash` 的直接通知，Dela 之外的变化走 6.3 的 watch）；镜像自己按 watch 事件重读这一条**还没接**。
- 上传路径不做远端回读校验（逐字节一致由真机测试保证，不在产品路径上重复读一遍）。
- 模型若在 bash 里写含空格的镜像路径又不加引号，翻译会吃掉整段路径——这是命令本身的写法问题，与不加翻译时的失败方式相同。

**6.3 · watch、预览与传输 —— 全部已实施（目录树刷新与延迟、目录 watch、只读预览与二进制传输）**
草案：事件式刷新（含溢出重扫）、只读预览标签、二进制上传下载、系统默认程序打开。
验收：**已验证**——点远端文件开只读预览（文本/Markdown/图片/PDF/Word/Excel）、二进制上传下载逐字节一致、大文件分块拉不整篇进内存、目录树随远端变化自动刷新、watch 撤销后不再推事件。**未验证**——「8 MB PDF 只取片段就渲染出首页」没有单独测过（测的是 3 MB 二进制跨 1 MB 分块的往返与 Range 请求），「watch 溢出后能自愈」只有纯逻辑单测（内核 `IN_Q_OVERFLOW` 造不出来），helper 缺席时的整条降级路径也没有真机证据。

已实施的第一批（用户提出的两个问题：目录树更新慢、AI 建的文件不显示）：

- **目录清单走 helper 通道**：`/v1/fs/list` 提到 `HelperSession.list`，`operations.listRemoteDirectory` 通道优先、拿不到退回一次性 ssh，`workspace:list-remote`（目录树唯一的清单入口）改走它。真机实测同一个目录连列 5 次取平均：**通道 28 ms / ssh 310 ms（约 11×）**；清单内容（名字、类型、大小、毫秒时间戳）与 ssh 完全一致——`modifiedAt` 两边都是毫秒，因为有测试逐条比对。
- **远端变化广播**：`remotes/events.ts` 进程内广播，`write.writeFile` 推「写入所在目录」、`bash.exec` 推「命令的 cwd」（`mkdir`/`git clone`/`npm install` 都走 bash，只读命令多付一次很便宜的清单请求）。`registerRemoteIpc()` 把广播转成窗口事件 `workspace:remote-change`，preload 暴露 `onRemoteChange`，目录树收到后丢掉受影响的清单（变化目录本身与它下面的缓存层：新条目要现出来），缺清单的展开目录自动重拉；300 ms 合并窗口，一次工具调用连写多个文件只重读一次。
- 这是本地项目早就有的东西的远端对应物：本地项目目录由主进程的 `watch(root, { recursive: true })` → `workspace:changed`（200 ms 合并）刷新，远端路径在本地不存在，只能由工具自己报。

证据：真机单测 `helper.test.ts`「目录清单走通道」逐条比对内容并测延迟；`operations.test.ts` 新增「目录清单按远端原样返回，顺带把变化通知发出去」；渲染端 `ProjectFileTree.test.tsx`「refreshes a remote directory after the tools changed it」（无关目录不重读、子目录写入只重读那层、cwd 变化重读根与已展开子树）；`scripts/remote-smoke.ts` 第 7 步在真窗口里用主进程写一个远端文件，断言树里**自动出现** `fresh.txt`——主进程广播 → preload → 树重读 → DOM 整条链路真跑。

补测试时顺带发现并修掉两件真问题：**（1）** 冒烟入口是 `electron .tools/remote-smoke.cjs`，`app.getAppPath()` 因此是 `.tools` 而不是仓库根，`vendor/` 下的 helper 与随包 ssh **都找不到**，于是冒烟里所有远端调用一直静默退回一次性 ssh —— 也就是说 6.1 起冒烟从未真正经过 helper 通道（真机 vitest 套件是经过的）。冒烟里把 `getAppPath` 对齐成仓库根后，新增的断言「列一层之后远端 helper 进程数必须变多」才可能失败，现在能守住这条接线。**（2）** `workspace:list-remote`（目录树唯一的清单入口）第一版忘记改成走 `listRemoteDirectory`，文档却已按「改走它」写 —— 是补上面那条断言时被抓出来的，现已接上：`src/main/workspace/ipc.ts` 调 `listRemoteDirectory`，该函数的通道优先行为有真机单测守着。

尚未做（6.3 之外）：远端文件的编辑器内保存、远端 pptx 内嵌预览（见第三批的「已知边界」）。

**6.3 · 第二批（Dela 之外的远端变化：目录 watch）已实施**

已实施：

- **helper 侧 `/v1/watch`**：POST 换某个 id 的监视集合（幂等），DELETE 取消，GET 是事件流（SSE，`data:` 里直接是 JSON）。进程内一个 inotify 实例、**惰性创建**（没人看就不占内核资源），按**路径**做引用计数（多个 id 看同一目录只加一次内核 watch，否则重复 watch 先把额度耗光、删除时也没法对账）。stdlib `syscall` 直连（`InotifyInit1`/`InotifyAddWatch`/`epoll` + 非阻塞 `read`），没有引入 `fsnotify`，`go.mod` 仍然零外部依赖。
- **只订结构变化**：`IN_CREATE|IN_DELETE|IN_MOVED_FROM|IN_MOVED_TO|IN_DELETE_SELF|IN_MOVE_SELF`。目录树只显示名字与类型，构建工具写文件产生的 `IN_MODIFY`/`IN_CLOSE_WRITE` 订了只会把事件量放大几个数量级；`IN_DELETE_SELF`/`IN_MOVE_SELF` 必须报，否则树里会留着已经不存在的目录。
- **事件语义**：200 ms 合并窗口，一个 id 一轮最多一条事件；`change` 带「要重读的目录层」，`reset` 带理由（`overflow` 内核队列溢出／`pending-overflow` 单 id 待发集合到顶／`too-many-changes` 单批超过 256 层／`subscriber-slow` 订阅者落后）。任何「丢过事件」的情况一律换成 reset，因为「丢的是哪几条」算不出来；发布**绝不阻塞**，订阅者队列满只丢它自己的事件并补一条 reset。
- **Dela 侧**：渲染端上报「当前展开的远端目录」（150 ms 合并、序列化后没变就不重报、卸载与收起时取消），`workspace:watch-remote` → `remotes/watch.ts` → `HelperSession.setWatch`；事件回来仍走同一条 `notifyRemoteChange`，所以目录树那条重读路径一行没改。`reset` 折成「按项目根报一次」，树会重读根以下所有已缓存层。
- **谁被监视**：Dela 全局只有一条 helper 通道，所以同时只服务一个目标，切换由「通道实际在用谁」驱动（`operations.withHelper` 每次用工通道都顺带喊一声），集合按目标留着，切回来立刻恢复；重连退避 1 s → 30 s。helper 不可用时整条 watch 缺席（回报 `watching=0`），工具动作触发的刷新照常。
- **不递归、只盯展开的目录**：递归要几千个 inotify watch，而折叠着的目录变了也看不见。代价是「展开之后」才有实时性，折叠着的目录里发生的变化要展开时才读。

**机制边界（没用 NFS/FUSE 等特殊文件系统验证过）**：inotify 在 NFS/FUSE/sshfs 上可能不给事件；helper 只监视真实存在的目录，`skipped[]` 里会列出没挂上的（不存在、不是目录、inotify 额度满），Dela 记为一条 warn —— 这也是用户排查「为什么这个目录不自动刷新」的唯一入口。

**实测证据（真机 `root@47.117.158.218`，2026-10-10）**

- `helper.test.ts`「watch：远端自己改的目录会推事件，撤销后不再推」：用**一次性 ssh**（完全不经过工具路径）在被监视目录里 `touch`，收到 `change{paths:["/tmp/dela-watch-test"]}`；在**未监视**的子目录里 `touch`，1.2 秒内**一个事件都没有**（不递归这个前提因此不是纸上结论）；`DELETE /v1/watch?id=` 之后再改，仍然没有事件。
- 全套真机套件 11 文件 / 75 用例通过；离线 `watch.test.ts` 覆盖「集合替换 / 事件到 `notifyRemoteChange` 的映射 / reset 到项目根 / 撤销 / 换目标后只服务一个目标 / helper 缺席时不报错」。
- helper 自己的 Go 套件（WSL Ubuntu 24.04 + Go 1.27.2，真内核 inotify）：`GOOS=linux go vet ./...` exit 0（amd64/arm64 都试过）；`go test -count=1 ./...` 12/12 PASS（`TestWatchHubRealInotify` 走 `hub.set()` + 真 inotify，`TestWatchHTTPStream` 走真 HTTP + 真 SSE + 客户端断开后订阅者清理）；`go test -race ./...` 无 data race。**Windows 上这个包编不过**（`syscall.IN_CREATE`/`Kill`/`Setpgid` 都只在 Linux 有），所以本机只能 `GOOS=linux` 交叉 vet/构建，真跑测试要在 Linux 里。
- 真窗口冒烟（`pnpm smoke:remote`）第 8 步：在真实窗口里用一次性 ssh 建 `outside-watch.txt`，断言它**自己**出现在目录树里，结果 `"watch": true`。

**真机测试抓出来的两个真 bug（都已修）**

- **nil map panic**：watch 的第一版产物在**第一条 inotify 事件**上就 panic —— `assignment to entry in nil map`（`watchBatch.note`），helper 进程直接死、SSE 变 ECONNRESET。根因不在并发：`note()` 里造 `watchPending` 时没给内层 `paths` 分配 map，先读 nil map（合法）再写就成了 panic，所以**任何 id 的第一条真实结构事件都会崩**。离线单测喂的是 `watchBatch` 本身、没有「真实事件 + 合并窗口」那条路，所以是接了真机才炸出来的；修完补了 `TestWatchHubRealInotify`（修之前它就在同一个栈上 panic）。
- **SSE 响应头没 Flush**：`watchStream` 写完 200 之后没有 `Flush`，net/http 懒发送 → 客户端在第一条事件之前拿不到响应头，「流已建立」和「第一条变化」分不开（Dela 侧能收到事件，是因为第一条 change 顺手把响应头带了出去）。修法是 `WriteHeader(200)` 后立刻 `flusher.Flush()`。
- 另有一条**测试自身的错**（我这边）：`waitFor` 只看「历史上是否出现过某类事件」，于是 `mkdir` 那一步立刻被前一条事件满足、把时间窗口记早了，看起来像「未监视子目录也推事件」——改成只统计**新增**事件后复现消失。watch 这种「事件 + 合并窗口」的行为，断言必须对着「新增」而不是「曾经」。

**没有运行证据的分支（已知）**：内核 `IN_Q_OVERFLOW`（没法可靠地人为造）与 HTTP 层「订阅者落后」都只有代码评审 + 纯逻辑单测，没有端到端；另外 inotify 有一个已知老坑没处理 —— 显式 `InotifyRmWatch` 之后内核仍会投递一条 `IN_IGNORED`，如果内核在读走它之前把同一个 wd 复用到新 watch 上，我们可能误删新 watch 的记账（该目录静默失联到下一次 POST）。概率极低，修法要额外维护「预期中的 IN_IGNORED」集合，判断收益不抵复杂度，所以**明确留着**。

**6.3 · 第三批（只读预览与二进制传输）已实施（2026-10-10）**

做法：**预览不新开一条数据通路，而是复用本地那套**。远端文件在条目树里本来就有身份（`项目 id + 远端绝对路径`，即 `remoteNodeId`），于是：

- 预览标签的 key 直接就是 `preview:<remoteNodeId>`（`preview:<uuid>:/abs/path`）。`parsePreviewTabId` 不用改，`entry-dialogs.titleOf` 多一条「远端身份 → 取路径最后一段」的分支，标签标题就是文件名。
- `ContentLoader.loadDocument` 多一条远端分支：`workspace:read-remote-document` 回 `DocumentContent`，与本地条目同一个类型，所以文本/代码、Markdown、图片、PDF、docx/xlsx 全部落到已有的预览组件上，没有为远端写第二套渲染。
- 格式判定上移到 `shared/documents.ts` 的 `documentFormatOf(name)`（纯字符串实现，渲染端也能用），本地 `readWorkspaceEntry` 与远端共用同一套规则，不会两边漂移。
- **不整篇进内存**：文本/Markdown 只读头部一段（4 MB，超出在文末说明「只读了前 4 MB」）；图片直传字节（上限 32 MB，超过明确报错而不是硬撑）；PDF/Office 只给 `dela-resource://remote/<项目 id>?path=<远端路径>&v=<mtime-size>`，字节由协议按 Range **分块拉**（每块 1 MB，`ReadableStream` 的 `pull` 天然背压，PDF 阅读器跳页取消流就停）。这个协议分支和本地 `dela-resource://workspace` 共用一份 Range 解析与响应头。
- Markdown 里的相对图片走 `dela-resource://remote-raw/...`（`remoteAssetUrl` 按 Markdown 所在目录解析，越界/带协议的地址原样返回，主进程再校验一次「必须在项目根目录内」）。
- **传输**：下载按块拉到本地（先写 `.part` 再改名，失败不留半个文件），保存路径由系统保存对话框决定，下完 `showItemInFolder` 定位到文件（应用里没有 toast，这就是反馈）；上传是本地读全文后一次 `PUT`（helper 侧同目录临时文件 + rename），入口有两个——远端目录的右键「上传本地文件」和把本地文件拖到远端目录行上；「用系统默认程序打开」= 下载到 `%TEMP%/dela-remote-open`（按连接 + 路径哈希命名）后交给 `shell.openPath`，退出时清理。

**实测证据（真机 `root@47.117.158.218`，2026-10-10）**

- 真窗口冒烟（`pnpm smoke:remote`）：点远端文件后**新增一个预览标签**，标签里就是远端那份文件的内容（`section[aria-label="文档：a b.txt"]` 里能读到 `hello`）；远端文件的操作菜单给出「下载到本地 / 用系统默认程序打开」、目录给出「上传本地文件」，而本地的重命名/移动/新建文件夹一个都不出现。结果 `"preview": true`。
- 离线单测 `src/main/remotes/test/documents.test.ts` 5 条：文本小文件全文 / 大文件截断说明 / Markdown 与代码扩展名判定 / PDF 与 Office 只给地址且**不拉字节**（`readRemoteRange` 一次都没被调用）/ 图片直传与超限报错；另有 `remoteAssetUrl` 的相对解析与越界放行。
- 真机 `src/main/remotes/test/transfer.test.ts` 两条：3 MB + 10 字节的随机二进制（带 NUL 与非 UTF-8）**上传再下载，sha256 与长度都对得上**，跨过 1 MB 分块边界（顺带验证末尾 3 字节的片段读取不越界）；「系统默认程序打开」的落点是 `dela-remote-open/` 下带哈希前缀的原名、字节正确，`closeRemoteOpens()` 之后文件消失——这一条里 `shell.openPath` 是替身，不会真的弹程序。
- 真机 `operations.test.ts` 新增一条：预览用的 `statRemoteFile`（从目录清单拿 size/mtime，目录与不存在的路径分别报错）与 `readRemoteRange`（只回请求的那一段）。

**已知边界（明说，不含糊）**

- **远端 pptx 不支持内嵌预览**：pptx 的预览靠 PowerPoint 导出成 PDF，而导出要本地文件路径（`ResourceRef` 只有 workspace/canvas 两种）。远端 pptx 因此按 `unsupported` 处理，提示下载后用系统程序打开；没有为它临时造一个「远端资源引用」。
- **上传不分块**：整篇读进主进程内存后一次 `PUT`。几百 MB 的文件会占等量内存，这是当前实现的上限；helper 侧落盘本身是原子的（临时文件 + rename），失败不留半个文件。
- 打开着的远端预览**不会自动跟随远端改动**：目录树会随 watch 刷新，标签内容要重开（本地文件的「窗口聚焦重读」不适用于远端，远端也没有客户端订阅这一份文件的机制）。
- 编辑器/保存远端文件仍**没有**：远端条目只读，写路径目前只有「上传」（整文件覆盖）与工具（`write`/`edit`）。

**6.4 · arm64 随包支持（已实施 2026-10-10）**

- `vendor/dela-helper/dela-helper-linux-arm64` 入库。代码侧本来就不缺：`helperArch()` 早已识别 `aarch64`，`electron-builder.yml` 的 `extraResources` 按 `dela-helper-*` 整目录拷贝——所以这步只动了产物、CI 与文档，TS/Go 零改动。arm64 远端从「静默降级」变为完整通道。
- **CI 同步跟上**（check.yaml 与 release.yml 的 helper job）：加 `GOOS=linux GOARCH=arm64 go vet`；构建改 `node scripts/build-helper.mjs --all`；arm64 产物用 `qemu-aarch64-static --version` 冒烟（runner 自带 qemu-user-static，缺了就现装）；arm64 artifact 单独上传下载，打包后与 amd64 一起 `cmp` 校验进包。此前 CI 只构建 amd64——就算 arm64 入库，helper 源码更新后它也会永久停在旧版（握手版本校验失败 → 静默降级），这个坑一起补上。

**arm64 验证证据（qemu 用户态仿真，非真机，2026-10-10）**

环境：WSL Ubuntu 24.04（x86_64 内核）+ qemu-aarch64 8.2.2。用户态仿真只翻译 ARM 指令，系统调用直达真内核，所以 inotify、epoll、进程组信号都是真行为。对入库产物本身做协议冒烟，8 项全过：

1. 无 token 401；`/v1/hello` 回 `{"helperVersion":"0.2.0","protocol":1}`。
2. `/v1/fs/list` 正常返回条目（名字、类型、大小、毫秒时间戳）。
3. 1 MB 随机二进制 `PUT /v1/fs/write` → `GET /v1/fs/read` 往返 sha256 一致。
4. `/v1/exec`：stdout base64 解码正确，`exit 7` 退出码正确，`state=exited`。
5. `/v1/watch`：POST 订阅返回 `{"skipped":[],"watching":1}`，目录外 `touch` 后 SSE 收到 `change`——inotify 在 arm64 构建上可用。
6. 取消：`sleep 300 & sleep 300 & wait` 的任务经 `/v1/exec/:id/cancel` 后远端 sleep 进程 2 → 0，`state=cancelled`。
7. SIGTERM 优雅退出，run.json 清理，无残留进程。

**仍欠真机证据**：qemu 不反映真实硬件与时序；等一台 arm64 Linux 机器跑一次 `pnpm smoke:remote` 即可升级为真机验证。helper 若起不来会按既有路径降级回一次性 ssh，风险有界。

**6.4 · 受限环境检测与文案（已实施 2026-10-10）**

- **检测**：`startHelper` 失败后用一次性 ssh 跑一段只读诊断（`findmnt` 的挂载选项、目录可写性、`getenforce`、直接执行 `--version` 的退出码），`classifyEnvironment` 分类成一句人话——noexec／只读挂载／目录不可写／SELinux Enforcing 且执行被拒／通用执行被拒。分类不出就让原始错误自己说话。诊断失败不影响原有错误路径。
- **文案两处**：向导「启动」失败的日志行带上 `（诊断：…）`（顺着既有 `fail('start')` 流出去，向导组件零改动）；目录树顶部常驻一条降级提示——主进程记降级状态（目的地 + 原因），通道建立失败推送、恢复时撤回，渲染端按目的地对准项目显示 `<目的地> 的 helper 通道不可用，已退回一次性 ssh：<原因>`，别的服务器降级不打扰这棵树。
- 离线测试：`test/environment.test.ts` 6 条分类规则（含「执行没被拦时不硬编 SELinux」）；`ipc-contract.test.ts` 纳入 `remotes:helper-state`；渲染端 `ProjectFileTree.test.tsx` 新增「按目的地对准显示/撤下提示」。
- **仍欠**：诊断代码没有在真 noexec／SELinux 机器上跑过（分类规则的输入格式靠约定），文案的端到端表现待第一台受限环境的真机验证。

**6.4 · 端口预览（已实施 2026-10-10）**

- **helper 侧 `/v1/ports`**（`ports.go`）：读 `/proc/net/tcp[6]` 取 LISTEN（`st=0A`）里回环与通配地址的端口（绑在特定外网地址上的不报——`ssh -L 127.0.0.1` 够不着它们，报了是误导），再把 socket inode 对回 `/proc/<pid>/fd` 拿 pid 与 `comm`；别的用户的进程读不到 fd，归属自然缺省，端口仍可见（`/proc/net/tcp` 全局可读）。helper 自己的监听端口不报。只读 /proc，`go.mod` 仍然零依赖。
- **Dela 侧**：`session.listPorts()`；`main/remotes/ports.ts` 管隧道——按「目标 + 远端端口」一条（重复打开复用），`openPortTunnel` 用与主通道同源的 `ssh -L` 参数起**独立** ssh 进程，不挂在 helper 通道上（切连接、放掉通道都不影响已开的隧道），生命周期 = 显式停止或应用退出；打开时 `shell.openExternal(http://127.0.0.1:<本地端口>)`。
- **入口**：远端目录右键「预览远端端口…」→ 面板列出「进程 :端口」，打开后行内显示 `→ 127.0.0.1:<本地端口>` 并给「停止」；进程退出后隧道变成「端口 N（进程已退出）」行，仍可停止（不然它就永远不可见也停不掉了）。helper 不可用时面板报「端口预览需要 helper 通道」。
- 离线测试：Go `ports_test.go` 2 条（发现自己的监听、排除自身端口）；渲染端 `remote-ports-dialog.test.tsx` 2 条（快照渲染与打开/停止走通道、helper 缺席报错行）；真机 `helper.test.ts` 新增「远端 python3 起的监听出现在清单里，进程结束就消失」。

**6.4 · 仍后置**
JS 扩展宿主（可选加速器，见「未决」）。

## 风险与未决

- **Go 工具链进入贡献者门槛**：缓解是预编译产物入库（`vendor/dela-helper/`），只有改 helper 才需要 Go；`pnpm build:helper` 一键重建，`docs/development.md` 记了版本要求。
- **受限环境**：`noexec`、SELinux、只读 `$HOME`、磁盘满 —— 代码路径都会降级（返回 null 退回一次性 ssh），但**只在本机做过路径遮罩式的验证，没有真在 noexec 机器上跑过**。2026-10-10 起启动失败会自动分类原因（noexec／只读挂载／SELinux），向导日志与目录树都显示人话文案；诊断规则的输入格式靠约定，还没在真受限机器上验证过。
- **并发断连**：已定位为静默期连接被网络路径丢弃（见 6.1 的「顺带修的真问题」），保活已修；`sshd -T` 的 `maxstartups 10:30:100` 与那次失败无关。
- **长任务语义**：进程组终止、输出上限、结果未知三件事现在都有真机测试覆盖。
- **路径映射是新的静默风险点**（6.2）：映射错会把远端命令指到错误文件。已按 `remotePath` 同级补单测（镜像路径、最长前缀、撤销后复原、普通远端路径不受影响），另有真机端到端用例覆盖「命令正文里的镜像路径」；**含空格路径需要模型自己加引号**这类写法边界仍在。
- **arm64 只有仿真验证**：产物已入库并随包分发（2026-10-10，见 6.4），qemu 用户态仿真下协议冒烟全过，但真 arm64 机器上的上传与启动还没跑过；等有机器补一次 `pnpm smoke:remote`。helper 起不来会按既有路径降级回一次性 ssh，风险有界。
- **快速反复重启会在远端留几个「过期」helper**：Dela 退出不发退出请求，旧实例带着过期 token 最多再活 5 分钟；同一时刻只有一条通道可用，所以它们只是占位进程（实测一个 vitest 套件跑完留 8 个，5 分钟内全部按点自退）。
- **helper 资源占用未实测**：常驻一个 Go 进程（约 10 MB 内存量级），未做压测。
- **未决**：是否做 JS 扩展宿主；Windows 远端是否支持；远端 MCP 端口转发是否纳入；`fsnotify` 之外是否需要自建轮询兜底。
