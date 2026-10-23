# dela-helper

Dela 在远端 Linux 主机上运行的常驻 runtime：远程项目的全部工具调用、目录树、预览与端口发现
都经它执行，没有一次性 ssh 的退路。Dela 把它上传到 `~/.dela/helper/<版本>-<sha8>/` 并启动，
再经 `ssh -L` 隧道访问；它在 Dela 整体架构里的位置与重连规则见
[`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) §4，协议表在本文下方。

- **不做沙箱**：权限就是启动它的 SSH 用户的权限，和 `ssh <host> <命令>` 一样。
- **只绑回环**：`127.0.0.1`，不对外监听；每个请求都要带 `Authorization: Bearer <token>`。
- **只用标准库**：不拉任何 Go 依赖。

## 生命周期

- **不随隧道**：隧道断开只结束那一条 HTTP 连接，任务照跑。Dela 重连后用同一个 token 回到同一个实例，
  按偏移接回任务输出。
- **复用实例**：启动脚本先看 `run.json`（端口、pid、版本）。pid 活着且 `/proc/<pid>/exe` 就是这个
  目录下的 `dela-helper`，就直接复用，token 从同目录的 `token`（0600）读回；否则写新 token 起新实例。
- **只起一个**：`--lock-file` 用 `flock` 独占加锁。两个 Dela 同时起时抢输的那个退出码 3，
  启动脚本转而等对方的 `run.json`。
- **空闲 1 小时退出**：连续 `--idle-timeout`（默认 1h）收不到**任何请求**就退出，并终止在跑的任务。
  Dela 开着时每 30 秒一次心跳，所以计时等于从最后一个客户端断开算起；在跑的任务不续命。
  Dela 退出时只停心跳，不发退出请求；要立刻收掉就 `kill` 它的 pid（SIGTERM 同样是优雅退出）。
- **安全面**：没有任何连接时它最多再活 1 小时，期间持有 token 的同一 SSH 用户的进程都能访问它。
  这与该用户本来就能 `ssh` 进来执行任意命令的权限相同。

## 构建

需要 Go 工具链（本仓库用 1.27.2 验证过，`go.mod` 要求 1.22 以上）。

```powershell
pnpm build:helper          # linux/amd64，产物在 vendor/dela-helper/
pnpm build:helper --all    # 同时出 linux/arm64
```

产物是静态二进制（`CGO_ENABLED=0`），glibc 与 musl 都能跑；升级 helper 时同时改 `helper/main.go`
的 `helperVersion` 与 `src/main/remotes/helper.ts` 的 `HELPER_VERSION` 并重新构建——两者不一致会在
握手时判为版本不匹配，这台服务器的远程项目不可用。远端按「版本-sha8」分目录放，
**旧版本目录不自动清理**（每版一个，便于回退）；旧版本的实例空闲 1 小时后自己退出，
跑在它上面的任务新版看不到。

## 协议一览

协议版本 2。路径、命令与搜索条件一律放在 JSON 正文里（远端路径可能有引号或中文），只有读写用 query。

| 方法   | 路径                                | 用途                                                            |
| ------ | ----------------------------------- | --------------------------------------------------------------- |
| GET    | `/v1/hello`                         | 协议版本与 helper 版本（只这两项）                              |
| POST   | `/v1/heartbeat`                     | 客户端保活                                                      |
| POST   | `/v1/fs/list`                       | 列一层（带 stat）；`locate: true` 时路径不是目录也回答 `kind`   |
| POST   | `/v1/fs/stat`                       | 批量状态（`exists`、`directory`、`readable`、size、mtime）      |
| GET    | `/v1/fs/read?path=&offset=&length=` | 片段读取（二进制安全）                                          |
| PUT    | `/v1/fs/write?path=&parents=1`      | 原子写（同目录临时文件 + rename）；`parents=1` 先建缺失的父目录 |
| POST   | `/v1/fs/glob`                       | 按 glob 找文件（相对路径）                                      |
| POST   | `/v1/fs/search`                     | 按正则或字面量搜内容，返回结构化的匹配与上下文行                |
| GET    | `/v1/ports`                         | 回环与通配地址上监听的 TCP 端口（helper 自身除外，带 pid/进程） |
| POST   | `/v1/watch`                         | 替换某个 id 的监视目录集合（不递归）                            |
| DELETE | `/v1/watch?id=`                     | 停掉某 id 的全部监视（幂等）                                    |
| GET    | `/v1/watch`                         | SSE：目录结构变化 / 需要重读；安静时每 30 秒一条 `: keep-alive` |
| POST   | `/v1/tasks`                         | 创建任务；同一个 `id` 再提交只返回已有任务（`created: false`）  |
| GET    | `/v1/tasks`                         | 列出任务（在跑的与最近结束的）                                  |
| GET    | `/v1/tasks/{id}`                    | 单个任务的快照                                                  |
| GET    | `/v1/tasks/{id}/stream?offset=`     | SSE：从绝对字节偏移起推输出，结束时推 `exit`；流断开不影响任务  |
| POST   | `/v1/tasks/{id}/cancel`             | 取消任务（终止整个进程组）                                      |

## tasks

`POST /v1/tasks` 的 `id` 由客户端生成：创建请求可能已经落地、响应却丢在半路，客户端重连后用同一个
`id` 再提交，helper 只返回已有任务，命令不会执行第二遍。命令用 `bash -lc` 跑（登录 shell，PATH 里有
nvm、conda），stdout 与 stderr 进同一根管道，交织顺序与终端里看到的一致。

- **流帧**：`output{offset, data}`（data 是 base64，offset 是这段数据起点的绝对偏移）、
  `gap{offset, bytes}`（这段已被覆盖，接不回来）、`exit{state, code, signal, durationMs, output}`。
  客户端记下 `offset + len(data)`，断线重连后从这里续读。
- **缓冲**：每个任务 8 MB。有流在读时它只是背压窗口：生产者不超过最慢的读者一个缓冲，连着的时候
  一个字节都不丢。断线期间没人读，写满后覆盖最旧的部分，续读时先收到一条 `gap`。
- **结束**：显式取消、任务自己的 `timeoutMs`、helper 退出时终止整个进程组（先 SIGTERM，5 秒后
  SIGKILL）。state 分别是 `cancelled`、`timeout`、`cancelled`；正常退出是 `exited`。
- **保留**：在跑的任务一直留着；已结束的最多留 100 条或 1 小时，先到先清。

## glob 与 search

有 ripgrep 就交给它（`rg --files`、`rg --json`），没有就在 Go 里遍历，两条路返回同一种结构。
差异：rg 额外遵守 `.gitignore`；Go 遍历只跳过 `.git` 与 `node_modules`，正则按 RE2 解析，
不支持反向引用与环视，写了会报错，不会静默返回空结果。单行文本截到 500 字节。

## watch

`POST /v1/watch` 的 `paths` 是远端绝对目录，语义是「替换该 id 的整套监视集合」（幂等）。
具体取舍：

- **只监视目录本身，不递归**：递归在大仓库上要几千个 watch，客户端只报当前展开的层。
- **只订结构变化**：`IN_CREATE | IN_DELETE | IN_MOVED_FROM | IN_MOVED_TO | IN_DELETE_SELF | IN_MOVE_SELF`；
  不订 `IN_MODIFY` / `IN_CLOSE_WRITE`，因为远端文件树只显示名字与类型，内容变化不需要刷新。
- **合并 200ms**：一个 id 在这个窗口里的路径去重后合成一条 `change`，单条最多 256 个路径，
  再多就改发 `reset(reason=too-many-changes)`——`npm install` 这类在几百毫秒里产生上万次事件的
  场景走的就是这条。另有一个独立的量：`POST /v1/watch` 单次 `paths` 最多 4096 个，超过整条请求
  被拒（400 `bad_request`），与 `skipped` 无关。
- **溢出**：内核 `IN_Q_OVERFLOW` → `reset(id="*", reason="overflow")` 并清空待发集合。
- **慢订阅者**：某个 SSE 订阅者队列满时丢它的事件、补一条
  `reset(id="*", reason="subscriber-slow")`，绝不阻塞发布方。
- **跳过的路径**（不存在、不是目录、inotify 额度不足 ENOSPC）只进响应的 `skipped`，不算请求错误，
  也不进集合，所以下次 POST 同一批路径会重试。
- **目录被删/移走**时内核自己摘掉 watch，该路径从该 id 的集合里移除；调用方重新 POST 会重新加上。
- **保活**：SSE 上安静时每 30 秒发一条注释帧（`: keep-alive`），让中间的网络路径不要把这条长连接判成死连接（客户端那边也顺着它确认流还活着）。
- **共享**：进程里只有一个 inotify fd，第一次 POST 时才创建；同一目录被多个 id 监视时只加一次
  内核 watch，按 id 引用计数，`DELETE` 或换集合时引用归零才摘掉。
