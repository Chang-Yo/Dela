# Dela 开发文档

本文只记读代码得不到的东西：外部平台的实测行为、看起来像 bug 的有意取舍、未验收的状态、流程里不显然的步骤。代码已经表达的内容不写在这里，想传递开发信息请放进 commit log。

架构、分层与编码规则见 [AGENTS.md](../AGENTS.md)；命令见 `package.json` 的 `scripts`。其他文档：[README.md](../README.md)、[CONTRIBUTING.md](../CONTRIBUTING.md)、[CHANGELOG.md](../CHANGELOG.md)、[helper/README.md](../helper/README.md)、[sjtu-apis.md](sjtu-apis.md)、[what-we-not-do.md](what-we-not-do.md)。

## 1. 产品边界

- 单用户、本地、无服务端。正式分发仅 Windows x64；macOS 只支持 Apple Silicon，不做 Intel 与 Universal。
- **jAccount 开放平台的 `client_id` 已停止申请**，凡需要官方 jAccount 授权的方案都不可行。现有能力走 Canvas Personal Token、邮箱 IMAP/SMTP、致远一号 API 与个人会话型接口。
- 远程项目不做：远端文件写回与编辑、远程会话里的 dela 校园命令、JS 扩展宿主、远端 MCP 端口转发。
- 第三方只经 Agent Skills 与 MCP 接入。会话关闭 Pi 的扩展、提示模板与主题，项目里的 `.pi/extensions`、`.pi/prompts` 一律不加载。

## 2. 外部事实与踩坑

**Pi 与搜索工具**

- rg/fd 落在 `~/.pi/agent/bin`，不是 `userData/pi/bin`：bin 只认 `PI_CODING_AGENT_DIR`，Dela 不设它。`userData/pi` 隔离 auth、models、sessions、skills，bin 是唯一例外。
- Pi 兜底是从 GitHub 直连下载 rg/fd，大陆大概率失败，所以随包分发并在启动时前插 PATH。

**Windows**

- 随包 MinGit 只以 `sh.exe` 带 bash，脚本要复制出 `bash.exe`：argv[0] 决定 bash 是否走完整模式。
- Agent 的 Git Bash 探测顺序是系统 Git for Windows、随包 MinGit；都缺失就报错，不回退 PowerShell。
- System32 那份 OpenSSH 可能是旧版（实测 9.5p2，Program Files 为 10.0p2），排障先确认实际生效的是哪一个。
- 没有开发者模式时复刻符号链接会 EPERM，所以「导出本机数据」一律跳过符号链接。

**macOS**

- node-pty 的 `spawn-helper` 包内无可执行位（0644），会导致 `posix_spawnp failed`；`postinstall` 的 `fix-native-permissions.ts` 只在 Darwin 补位，只改了该脚本时要显式重跑。

**Electron**

- 退出前等后台任务收尾要拦 `before-quit`，不能拦 `will-quit`：被拦下后 Electron 不再响应后续 `app.quit()`。

**课堂视频（实测行为）**

- 官方成功的空分页可能返回 `records: null`。只有第一页、`ok`/`dataOk` 为真、总数与页数均为数字 0 时才当空数组，其余继续报错；后续页不能用零总数清空已取结果。
- 课程先取本学期课表，只有课表成功解析为空列表时才补查官网「我的课程」；失败就报错，不用备用来源掩盖。
- 播放流中断后不支持无缝续接；下载任务只在内存，不跨重启续传。

**渲染与条款**

- 写条款避开 `。**你` 这类「加粗以中文标点收尾、紧跟汉字」：CommonMark 不把该 `**` 当闭合，会渲染出字面星号（GitHub 同样）。把标点移到加粗之外。
- `docs/terms.md` 与 `docs/privacy.md` 同时是官网 `/privacy`、`/terms` 的正文来源，`../Dela_Web` 手抄一份，两仓库互不 import。改这里要同步改那边，包括顶部「最后更新」日期。应用内条款页与引导条款页共用同一组件，三处不各抄一份。
- 沙箱 iframe（邮件正文、水源楼层、Canvas 网页）是独立文档，rem 不继承外层，由 `src/ui/hooks/root-font-size.ts` 注入根字号。

**打包**

- 安装包体积：`dependencies` 只放主进程运行时要加载的包（electron-builder 会连闭包原样收进 asar），渲染层依赖放 devDependencies；放错边等于把 npm 目录再装一遍。
- 打包白名单只含 `out/**/*`、`package.json` 与品牌图，文档、凭据与 `.tools/` 不进安装包。
- `better-sqlite3` 与 `node-pty` 用随包预编译产物，关闭源码重建（`allowBuilds`）。

## 3. 有意的取舍

这些看起来像缺陷，不要「好心修掉」。

- **Agent 不设沙箱**：给了 bash 就没有业务级守卫与越权校验，skill 启停只是引导层。不要描述成安全隔离。
- 应用启动不读仓库 `.env`，凭据只能在应用内配置。
- 会话 cwd 目录缺失时报错，**不静默换目录**。
- 子 Agent 全应用同时运行有上限，超出直接报错，不排队。
- 远程命令按任务运行、断线后按字节偏移续读；断线期间超出缓冲的输出接不回来，工具输出里补一行说明。取消必须显式调用，断开连接不终止任务。
- 远程项目内本地不碰远端路径：禁新建 / 重命名 / 移动，目录不进本地扫描也不 `fs.watch`。
- 远程路径归一化最容易静默改错文件：工具在调用 operations 前用宿主 `node:path` 解析参数，Windows 上会把远端 POSIX 路径改成带盘符形式，operations 只对 Windows 形态去盘符、转分隔符，原生 POSIX 路径不套用。
- ssh 一次调用一个子进程、不做多路复用，并发握手太多会被主机断开，所以 `pnpm test:remote` 必须串行。
- 轮次文件变化靠「轮前存基准、轮后比较」，不依赖 write/edit，因此并发修改（人工、其他会话）也会进结果，不保证归因为 Agent 独占。后台子 Agent 在两轮之间写的文件不进任何一轮，只在「未提交改动」里可见。缺失记录要展示为警告，不能伪装成「没有改动」。
- 文件格式只有一条判定规则（本地、远端、Agent 读取、聊天附件共用）：扩展名只挑专用查看器，其余看内容，**不维护文本扩展名白名单**；非 UTF-8 按二进制处理，防止读入再写回把文件写坏。
- 编辑器「不改原状」：不格式化，Markdown 不经 AST 往返，换行符跟随首个换行，BOM 保留，保存原地覆写以保住可执行位与链接；保存前比对内容哈希，外部改过就拒绝并保留草稿。
- 移除项目只删条目与名下会话，不动磁盘目录；项目上只有「归档会话」与「移除」，不设隐藏态。
- 条款门对所有人成立，只看有没有同意标记，否则「不同意并退出」再打开就绕过去了。
- 更新：安装用 `quitAndInstall`，终端任务会结束且不能恢复；进度 100% 只表示传输完成，仍要校验；更新内容弹窗以 `?raw` 内联 `CHANGELOG.md`，条目本身就是弹窗内容，所以 CHANGELOG 要保持简短。
- 协议（`core/protocol/agent.ts`）与移动端共用，只能新增，不兼容改动要升 `AGENT_PROTOCOL_VERSION`；`agent.schema.json` 随提交，更新方式见 `src/core/test/protocol-schema.test.ts` 顶部。
- 尚未配置 Windows Authenticode 发布签名（仅有手动触发的 SignPath 测试签名）。SHA-512 只验证文件与元数据一致，不能替代发布者签名。

## 4. 构建与工具链

- 版本以 `.node-version`、`package.json` 的 `packageManager` 与 `go.mod` 为准（Go 只在改 helper 时需要），CI 从这些文件读取。本机工具装在被 Git 忽略的 `.tools/`，用 `. ./scripts/use-local-tools.ps1` 启用。
- 依赖版本精确固定，升级交给 Renovate：每周一提 PR，非大版本合并成一个、大版本各自单独；npm 包发布满 3 天才提，避开被投毒后尚未撤下的版本。
- 写模块迁移：已发布的迁移不再修改；改了表就同时改 `tables` 里的建表语句，新库直接按它建表；迁移期间外键检查关闭，结束后才打开。
- 改了 `helper/` 下的 Go 代码后执行 `pnpm build:helper --all` 并一并提交，只重建 amd64 会让仓库里的 arm64 停在旧版。
- 提交前跑 `pnpm format:check`、`pnpm lint`、`pnpm build`、`pnpm test`。改远端（`src/core/remote/`、`src/modules/remotes/`、`helper/`）时另用 `pnpm test:remote` 对真机跑（先 `pnpm fetch:remote-rg`），默认套件与 CI 都跳过它。涉及构建、原生依赖或打包时另验证 `pnpm smoke` 与打包目录启动。
- 冒烟使用独立测试目录与脱敏数据，除标注联网的（`agent-smoke`）外不发送真实请求。启动应用的 smoke 必须把 home 指向临时目录。
- 升级 `extraResources` 时按各自 README 的步骤做并在打包目录里实跑：`vendor/openssh`（`ssh.exe -V` 与一次真实连接）、`vendor/bin`（rg、fd 的 `--version`）、MinGit（只改 `prepare-runtime.ts` 里成对的版本与 SHA256 常量）、远端 rg（版本与 SHA256 只在 `scripts/fetch-remote-rg.ts`，不入库）。helper 由发布与 CI 从当次源码重建。

## 5. CI

- `ci.yml` 做变更检测与编排，经 `workflow_call` 调用按职能拆分的 workflow。精确的路径分流规则以 `ci.yml` 的 filters 为准。
- **`CI required` 始终汇总**：被选中的必须成功，未选中的必须 skipped。入口不能用顶层路径过滤，否则文档 PR 的必需检查会一直 Pending。
- helper 被选中时平台任务必须等它成功并取当次产物，不能因为 helper 合理跳过就跳过平台任务。
- 路径分流可能遗漏隐含的平台依赖：新增运行时入口或资源目录时同步更新 filters。
- CI 去掉全部交大模块（`scripts/strip-sjtu.ts`）后再做类型检查、构建与冒烟。
- 真实 SSH 联调手动执行，不接入 CI。云端冒烟不能替代签名、公证与自动更新验收。

## 6. 发布

- 分支流程见[贡献指南](../CONTRIBUTING.md#分支与合并流程)。Rulesets 无法限制 PR 发起人或来源分支，维护者需确认指向 `main` 的 PR 由管理员发起且来自 `dev`。
- `pnpm version:*` 只改 `package.json` 的版本，不建 commit / tag；preload 构建时内联版本号，升版后需重新构建。
- 推 `v*` tag 触发 `release.yml`，Windows 与 Mac 都成功才上传并公开；任一平台失败或等待环境批准都会阻塞。`CI required` 会按路径跳过任务，不能替代全部发布检查。
- tag 必须等于 `v` + `package.json` 版本。
- 发版前把 `CHANGELOG.md` 的 `## Unreleased` 改成 `## <版本> - <发布日>`。更新内容弹窗只认 `## X.Y.Z - 日期`，留在 `Unreleased` 下的条目会被静默跳过。
- 正式版必须提供 `latest.yml`，包内必须有 `resources/app-update.yml`。
- 更新源是自有 CDN 的 Generic provider，由独立侧同步，**CI 不持有 CDN 凭据**；同步时安装包与 blockmap 必须先于元数据就绪。
- 重跑已有 tag 用 `--clobber` 覆盖同名产物，但正式分发后不要覆盖重建安装包：CDN 缓存可能与新元数据不一致，程序变更应升版发新 tag。
- Mac 签名需要在 Environments 建 `macos-release` 并配置 Developer ID 证书与 Apple 公证凭据。

## 7. 平台状态

Windows 基线为 Windows 10 x64，macOS 为 13.0 arm64；这是构建基线，不代表最低系统已实机验收。

- 终端用用户的登录 shell；Agent 在 Mac 用 `/bin/bash`、系统 SSH 与 Git，不执行登录 shell。只写在 Zsh 初始化里的 SDK 环境，终端可见、Agent 不一定可见。
- 路径归属按路径格式判断，不按宿主系统：Windows 盘符与 UNC 兼容大小写与两种分隔符，POSIX 逐字匹配并保留文件名里的反斜杠。
- 登录启动不使用 `openAsHidden`：Windows 传 `--hidden`，Mac 读 `wasOpenedAtLogin`。
- **未验收**：Mac 的实际登录启动、系统级键位冲突、多显示器与动画表现、Gatekeeper 首启与两版升级；Windows 实机、真实 SSH 与 VS Code Remote-SSH 链路。模拟的平台分支测试不能替代实机回归。
- macOS 本地验证不找签名身份、不发布：`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dist --mac --arm64 -c.electronDist=node_modules/electron/dist`，再用 `scripts/verify-macos-package.ts` 与 `--smoke-test` 检查 `.app`。这些检查不代表正式签名应用、全部账号业务或全部模型调用已验收。
