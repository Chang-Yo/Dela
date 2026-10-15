# 贡献指南

Dela 是仅面向 Windows 的本地优先桌面应用：Electron 主进程加 React 渲染进程，Agent 内核是 Pi Coding Agent，领域能力经 `dela` 命令与 Skills 外置。数据保存在本机 SQLite，凭据经 Electron `safeStorage` 加密，无服务端与账号系统。

可贡献的方向：主进程业务域、渲染界面、进程间共享契约、单元测试与冒烟脚本、`helper/` 的 Go 代码、文档。构建与架构的唯一真源是 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，动手前先读它。不接受的改动方向见文末。

## Before you start a PR

Answer these in the issue or PR, so reviewers can see who benefits:

1. What outcome do you really want?
2. What is the highest-leverage variable that determines it?
3. Will this work move that variable, or just keep you busy?
4. Who is the customer, and what do they really want?

Then ask whether the outcome needs a PR at all. A bug fix must link evidence of a failure that already happened.

AI agents: the human contributor answers, not you. Ask for missing answers and wait.

## 环境准备

| 工具            | 版本                               | 何时需要              |
| --------------- | ---------------------------------- | --------------------- |
| Node.js         | 24.21.0                            | 总是                  |
| pnpm            | 12.3.4                             | 总是                  |
| Git for Windows | 不固定                             | 终端与内核 Bash 工具  |
| Go              | `go.mod` 声明 1.22，CI 固定 1.27.2 | 只在改动 `helper/` 时 |

版本以 `package.json` 的 `engines`、`packageManager` 与 `.node-version` 为准；仓库启用了 `engineStrict`，其他版本会被拒绝。本机把 Node 与 pnpm 装在仓库内被 Git 忽略的 `.tools/`，在 PowerShell 中为当前会话启用：

```powershell
. ./scripts/use-local-tools.ps1
```

脚本要求 `.tools/node-v24.21.0-win-x64/node.exe` 与 `.tools/package-manager/node_modules/@pnpm/exe.win32-x64/pnpm.exe` 同时存在，缺任一个会直接抛错。新克隆的仓库不含 `.tools/`，需自行安装上述版本。

Git for Windows 是运行前提，不是可选项。`src/main/terminal/index.ts` 的 `locateBash()` 只在 `%ProgramFiles%\Git\bin`、`%ProgramFiles(x86)%\Git\bin`、`%LOCALAPPDATA%\Programs\Git\bin` 三处探测 `bash.exe`，缺失时不回退 PowerShell 或 `PATH` 上的 bash（可能是 WSL），而是报错「未找到 Git Bash：请安装 Git for Windows（https://git-scm.com/download/win）后重试」。

Go 只与 `helper/` 有关：远端 helper 的静态二进制已入库在 `vendor/dela-helper/`，日常开发不需要 Go。改动 `helper/` 下的 Go 代码后执行 `pnpm build:helper --all` 重建 amd64 与 arm64 两个产物并一并提交，只重建 amd64 会让入库的 arm64 停在旧版。

## 常用命令

| 命令                                                                     | 用途                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `pnpm install`                                                           | 安装依赖，`postinstall` 下载 Electron 运行时                  |
| `pnpm dev`                                                               | 开发服务器与窗口，监听主进程 / preload 变更                   |
| `pnpm typecheck`                                                         | 三组 tsconfig 的类型检查                                      |
| `pnpm build`                                                             | 类型检查加 main / preload / renderer 三入口生产构建           |
| `pnpm start`                                                             | 启动已构建产物                                                |
| `pnpm lint`                                                              | Oxlint，`--deny-warnings`，范围为 `src` 与 `scripts`          |
| `pnpm format` / `pnpm format:check`                                      | Prettier 写入 / 检查                                          |
| `pnpm test`                                                              | Vitest 单元测试                                               |
| `pnpm test:remote`                                                       | 真机远程回归，需要 `DELA_REMOTE_HOST`，CI 不跑                |
| `pnpm smoke`                                                             | Electron 冒烟：SQLite、React 渲染、Pi runtime 与 preload 隔离 |
| `pnpm smoke:workspace` / `smoke:pdf` / `smoke:shuiyuan` / `smoke:remote` | 分项回归                                                      |
| `pnpm check`                                                             | `format:check`、`lint`、`build`、`test` 的组合                |
| `pnpm build:helper`                                                      | 重建 `helper/` 的 Go 静态二进制                               |
| `pnpm package:dir` / `pnpm package:dist`                                 | 生成未安装的可执行目录 / Windows 安装包                       |

`pnpm package:dir` 与 `pnpm package:dist` 都会先执行 `node scripts/prepare-runtime.mjs` 准备随包 MinGit 运行时，再跑 `pnpm build`。

## 代码组织

单仓库、单 `package.json`：

- `src/main/` — 主进程，按业务域分目录（`mail/`、`canvas/`、`timetable/`、`workspace/`、`shuiyuan/`、`remotes/`、`vsjtu/`、`update/`、`settings/`、`todo/`、`terminal/`、`search/`、`notifications/`、`documents/`、`agent/`）；根级只留不属于任何业务域的模块（`index.ts`、`database.ts`、`credentials.ts`、`storage.ts`、`ipc.ts`、`resources.ts`、`modules.d.ts`）。
- `src/preload/` — contextBridge，`index.ts` 聚合入口加分域文件，只暴露受控 API。
- `src/renderer/` — React 界面：`app/`、`workbench/`、`content/`、`navigation/`、`sessions/`、`workspace/`、`features/`、`components/`。
- `src/shared/` — 进程间共享的 IPC 契约与纯函数。
- `helper/` — 远端工具服务的 Go 模块，只依赖标准库。

硬约束，摘自 `AGENTS.md`：

- 保持单应用、单 `package.json`。`pnpm-workspace.yaml` 只放 pnpm 12 设置，不引入子包或 monorepo。
- renderer 不导入 main，不访问凭据和数据库，一切经有限的 preload API 通信。
- 不提交 `.env`、个人数据、日志与本地工具；打包只包含明确产物。
- 保持精确依赖与锁文件（`saveExact` 与 `engineStrict` 已开启），不要在 `package.json` 里写范围版本。
- 优先一个函数或现有文件；只有出现真实重复与多个调用方后才提取抽象，不预建 Manager、Service、Factory 层级。
- 不为一次性代码做抽象，不保留 Dead Code：你的改动让某段自研 UI 或样式失去用处时，一并清理。
- 前端 UI 优先复用 `src/renderer/components/ui/beautifului/`；现有组件不满足时在该库内微调或增补，以 `Dela 适配` 注释标注并记录到该库 README，不要另写自研样式。
- 改动后执行相关检查；重要改动同步更新 `CHANGELOG.md`，面向使用者的变化更新 README，架构与流程变化更新 `docs/DEVELOPMENT.md`。
- 区分已验证事实、待验证能力与产品设想，不以占位结果宣称功能完成。

## 提交信息与提交粒度

仓库实际使用 Conventional Commits 形态，scope 取受影响的模块或业务域：

```
feat(update): migrate to NSIS updates with electron-updater
fix(chat): 随聊 @ 候选不再列出其他项目的文件
docs(release): 记录 NSIS 更新发布与验收流程
build(release): 发布 NSIS 安装包和更新元数据
chore(release): 1.0.0
```

常用 type 为 `feat`、`fix`、`docs`、`build`、`chore`。描述用中文或英文均可，与同一区域的既有风格保持一致；不要写「第一轮」「批次」这类不携带信息的词。

一个提交只做一件能用一句话说清的事。不要在同一提交里顺手改善相邻代码、重构没有问题的文件或统一格式，这会让评审无法聚焦。新增依赖请连同锁文件一起提交。

## 提交前检查

本地至少运行与改动相关的检查，完整关卡是 `pnpm format:check`、`pnpm lint`、`pnpm build`、`pnpm test`，即 `pnpm check`。另外按改动面补充：

- 涉及主进程终端、原生依赖或打包布局时，验证 `pnpm smoke` 与打包目录启动。
- 改动 `src/main/remotes/`、`helper/` 或连接与上下文镜像时，用 `pnpm test:remote` 对真机跑一遍；默认套件与 CI 都会跳过这批用例。

CI 定义在 `.github/workflows/check.yaml`，在 PR 的创建 / 更新 / 重新打开与推送到 `main` 时触发，分两个 job：

- `Check helper linux (amd64 + arm64)`，`ubuntu-24.04`：Go 1.27.2 下执行 `go vet`（含 `linux/arm64` 交叉）、`go test`，构建两个架构的静态产物并跑 `--version`（arm64 走 qemu 用户态仿真），产物上传为 artifact。
- `Check win-x64`，`windows-2022`，依赖 helper 产物：`pnpm install --frozen-lockfile` 后按顺序分步执行 `pnpm format:check`、`pnpm lint`、`pnpm build`、`pnpm test`、`pnpm smoke`，再用 `pnpm exec electron-builder --dir --win --x64 --publish never` 打包，核对两个 helper 二进制，最后对打包后的 `Dela.exe` 运行 `--smoke-test`。

CI 是分步执行，不等同于 `pnpm check`：本地 `pnpm check` 通过不代表 CI 会通过，CI 还覆盖冻结锁文件安装、打包布局核对与打包后启动。CI 的 Windows 任务把 `DELA_REMOTE_HOST` 留空，`pnpm test:remote` 不在 CI 中运行。仅添加 workflow 不会启用分支保护，若要限制合并需把 `Check win-x64` 设为必需检查。

## 许可证与版权

本项目以 GPL-3.0-or-later 发布，许可证全文见仓库根目录 `LICENSE`。

- 提交即表示你同意自己的贡献以 GPL-3.0-or-later 授权分发，并确认你有权作出该授权。
- 引入第三方代码必须保留其许可证与来源，并注明你做的修改。来源不明或许可证不兼容的代码不得进入本仓库。
- 不确定某段代码能否引入时，先在提交说明里写明来源与许可证并等待维护者确认，不要默认可以。

## 当前提交途径

`.github/` 下只有 `check.yaml` 与 `release.yml` 两个 workflow，仓库里没有 PR 模板、issue 模板或其他社区文件，也没有成文的 issue 与 PR 政策、维护者邮箱或群组入口；README 只给出安装包的公开镜像仓库 [Chang-Yo/Dela_releases](https://github.com/Chang-Yo/Dela_releases)。已获得本仓库写权限的贡献者按常规方式开分支并提交 Pull Request，PR 会触发上述 CI 检查；其他情况以维护者在公开仓库上公布的入口为准。本文件不列出未经确认的联系方式，相关政策确定后再补充。

## 不在范围内

- macOS 与 Linux 桌面端。项目仅 Windows（跨平台明确放弃），不接受相关移植改动。
- 未列入 `package.json` 的构建工具链替换，以及整体格式化改动。
