# dela-helper

Dela 在远端 Linux 主机上运行的常驻工具服务。Dela 把它上传到 `~/.dela/helper/<版本>-<sha8>/`，
以 `--port 0 --token-file …` 启动，再经 `ssh -L` 隧道访问；协议与设计见
[`docs/remote-helper.md`](../docs/remote-helper.md)。

它对 Dela 的价值只有三件事：复用一条连接（Windows OpenSSH 没有 ControlMaster，每次调用
都要重新握手）、提供 shell 命令给不了的能力（文件监听、片段读取、批量 stat、可取消的长任务）、
抹平各发行版命令的差异。

- **不做沙箱**：权限就是启动它的 SSH 用户的权限，和一次性的 `ssh <host> <命令>` 一样。
- **只绑回环**：`127.0.0.1`，不对外监听；每个请求都要带 `Authorization: Bearer <token>`。
- **不装服务**：没有 systemd 单元、没有开机自启；连续 5 分钟收不到心跳就自己退出（顺带终止在跑的任务）。Dela 退出时只停心跳、不向远端发退出请求 —— 少一次远端往返，也少一类"请求发不出去"的失败；要立刻收掉就 `kill` 它的 pid（SIGTERM 同样是优雅退出）。
- **只用标准库**：不拉任何 Go 依赖。

## 构建

需要 Go 工具链（本仓库用 1.27 验证过，`go.mod` 要求 1.22 以上）。

```powershell
pnpm build:helper          # linux/amd64，产物在 vendor/dela-helper/
pnpm build:helper --all    # 同时出 linux/arm64
```

产物是静态二进制（`CGO_ENABLED=0`），glibc 与 musl 都能跑；升级 helper 时改 `helperVersion`
并重新构建。远端按「版本-sha8」分目录放，**旧版本目录不自动清理**（每版一个，便于回退）。

## 协议一览

| 方法   | 路径                                | 用途                                                            |
| ------ | ----------------------------------- | --------------------------------------------------------------- |
| GET    | `/v1/hello`                         | 协议版本与 helper 版本（只这两项）                              |
| POST   | `/v1/heartbeat`                     | 客户端保活；5 分钟没有它就退出                                  |
| POST   | `/v1/fs/list`                       | 列一层（带 stat）                                               |
| POST   | `/v1/fs/stat`                       | 批量状态（远端预览取 size/mtime）                               |
| GET    | `/v1/fs/read?path=&offset=&length=` | 片段读取（二进制安全）                                          |
| PUT    | `/v1/fs/write?path=`                | 原子写（同目录临时文件 + rename）                               |
| POST   | `/v1/watch`                         | 替换某个 id 的监视目录集合（不递归）                            |
| DELETE | `/v1/watch?id=`                     | 停掉某 id 的全部监视（幂等）                                    |
| GET    | `/v1/watch`                         | SSE：目录结构变化 / 需要重读；安静时每 30 秒一条 `: keep-alive` |
| POST   | `/v1/exec`                          | 起任务，SSE 流式回传 stdout/stderr                              |
| POST   | `/v1/exec/{id}/cancel`              | 取消任务（终止整个进程组）                                      |

## watch

`POST /v1/watch` 的 `paths` 是远端绝对目录，语义是「替换该 id 的整套监视集合」（幂等）。
具体取舍：

- **只监视目录本身，不递归**：递归在大仓库上要几千个 watch，客户端只报当前展开的层。
- **只订结构变化**：`IN_CREATE | IN_DELETE | IN_MOVED_FROM | IN_MOVED_TO | IN_DELETE_SELF | IN_MOVE_SELF`；
  不订 `IN_MODIFY` / `IN_CLOSE_WRITE`，因为远端文件树只显示名字与类型，内容变化不需要刷新。
- **合并 200ms**：一个 id 在这个窗口里的路径去重后合成一条 `change`，单条最多 256 个路径，
  再多就改发 `reset(reason=too-many-changes)`；待发集合本身受单 id 的 4096 条监视上限约束
  （`npm install` 这类会在几百毫秒里产生上万次事件，超过上限的路径进 `skipped`）。
- **溢出**：内核 `IN_Q_OVERFLOW` → `reset(id="*", reason="overflow")` 并清空待发集合。
- **慢订阅者**：某个 SSE 订阅者队列满时丢它的事件、补一条
  `reset(id="*", reason="subscriber-slow")`，绝不阻塞发布方。
- **跳过的路径**（不存在、不是目录、inotify 额度不足 ENOSPC）只进响应的 `skipped`，不算请求错误，
  也不进集合，所以下次 POST 同一批路径会重试。
- **目录被删/移走**时内核自己摘掉 watch，该路径从该 id 的集合里移除；调用方重新 POST 会重新加上。
- **保活**：SSE 上安静时每 30 秒发一条注释帧（`: keep-alive`），让中间的网络路径不要把这条长连接判成死连接（客户端那边也顺着它确认流还活着）。
- **共享**：进程里只有一个 inotify fd，第一次 POST 时才创建；同一目录被多个 id 监视时只加一次
  内核 watch，按 id 引用计数，`DELETE` 或换集合时引用归零才摘掉。
