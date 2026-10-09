# dela-helper

Dela 在远端 Linux 主机上运行的常驻工具服务。Dela 把它上传到 `~/.dela/helper/<版本>-<sha8>/`，
以 `--port 0 --token-file …` 启动，再经 `ssh -L` 隧道访问；协议与设计见
[`docs/remote-helper.md`](../docs/remote-helper.md)。

它对 Dela 的价值只有三件事：复用一条连接（Windows OpenSSH 没有 ControlMaster，每次调用
都要重新握手）、提供 shell 命令给不了的能力（文件监听、片段读取、二进制传输、服务端哈希、
可取消的长任务）、抹平各发行版命令的差异。

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
并重新构建，旧版本目录由 Dela 侧清理。

## 协议一览

| 方法 | 路径                                | 用途                               |
| ---- | ----------------------------------- | ---------------------------------- |
| GET  | `/v1/hello`                         | 协议版本、helper 版本、能力清单    |
| POST | `/v1/heartbeat`                     | 客户端保活；5 分钟没有它就退出     |
| POST | `/v1/fs/list`                       | 列一层（带 stat）                  |
| POST | `/v1/fs/stat`                       | 批量状态                           |
| GET  | `/v1/fs/read?path=&offset=&length=` | 片段读取（二进制安全）             |
| PUT  | `/v1/fs/write?path=`                | 原子写（同目录临时文件 + rename）  |
| POST | `/v1/fs/hash`                       | 服务端 sha256                      |
| POST | `/v1/exec`                          | 起任务，SSE 流式回传 stdout/stderr |
| POST | `/v1/exec/{id}/cancel`              | 取消任务（终止整个进程组）         |
| GET  | `/v1/tasks`                         | 任务状态（保留最近 100 条）        |
