# 发布指南

面向维护者的 CI 检查、版本管理与安装包发布流程。

## CI 检查

`.github/workflows/check.yaml` 在 PR 创建、更新、重新打开及 push 到 `main` 时运行：

- 应用只构建 Windows x64（`windows-2022`），与发布一致的 runner 和固定 Node/pnpm 版本。
- helper 在 `ubuntu-24.04` 用 Go 1.27.2 执行本机测试、构建 Linux amd64 静态产物并运行 `--version`；Windows 任务下载当次产物用于打包，并逐字节核对打包后的文件。
- 执行冻结锁文件安装、`pnpm format:check`、`pnpm lint`、`pnpm build`（含类型检查）、`pnpm test`、`pnpm smoke`、应用目录打包及打包后冒烟。
- Go 测试只使用 runner 本机临时目录、inotify 与回环 HTTP，不连接 SSH。Windows 任务明确留空 `DELA_REMOTE_HOST`，真实 SSH 联调继续手动运行，不作为发布前置条件。
- 检查不生成安装包、不发布 Release，仅使用 `contents: read` 权限；同一 PR 或 main 分支的新提交会取消旧检查。

若要限制合并，需在 GitHub 的 main 分支规则中将 `Check win-x64` 设为必需检查——仅添加 workflow 不会自动启用分支保护。

## 升版

| 命令                                        | 示例（从 `0.1.0` 开始） |
| ------------------------------------------- | ----------------------- |
| `pnpm version:patch`                        | `0.1.1`                 |
| `pnpm version:minor`                        | `0.2.0`                 |
| `pnpm version:major`                        | `1.0.0`                 |
| `pnpm version:bump 0.2.0-beta.1`            | 指定预发布版本          |
| `pnpm version:bump prerelease --preid beta` | `0.1.1-beta.0`          |

- 命令只修改 `package.json` 版本（npm 负责 SemVer 校验），不自动创建 commit/tag，也不推送或发布。
- 单包 pnpm 锁文件不记录应用自身版本，升版无需修改锁文件。
- preload 在构建时从 `package.json` 内联版本号，设置页关于与冒烟检查随之同步；升版后需重新构建，开发模式需重启。
- 安装包会带上 `vendor/openssh` 里的 OpenSSH 客户端（`extraResources` 拷到 `resources/openssh`）。升级或更换它时按该目录 README 的步骤做，并在打包目录里实跑一次 `resources\openssh\ssh.exe -V` 与一次真实连接。
- 安装包也会带上 helper（`extraResources` 拷到 `resources/dela-helper`）。CI 与发布从本次源码构建 Linux amd64 与 arm64 产物（`build-helper.mjs --all`），覆盖仓库中的预编译文件后打包，避免发布旧 helper；arm64 产物在 CI 里用 qemu-aarch64 做 `--version` 冒烟。预编译文件仍保留供无 Go 的本地开发者使用；改了 `helper/` 后仍需用 `pnpm build:helper --all` 重建并提交，升级 helper 时同步 Go 与 TS 两端的版本常量。

## 发布

`.github/workflows/release.yml` 在推送 `v*` tag 时构建并发布 GitHub Release：

1. 先提交版本号和代码，再执行 `git tag v0.1.0 && git push origin v0.1.0`；tag 必须等于 `v` + `package.json` 的版本。
2. Linux helper 任务测试并构建该 tag 对应的源码；Windows 任务下载其产物，执行锁文件安装、类型检查与生产构建、单元测试、Electron 冒烟、NSIS 构建、包内 helper 一致性检查与打包目录启动检查。全部成功后创建 Release 并上传 `.exe`。
3. 含预发布后缀的版本（如 `0.2.0-beta.1`）自动标记为 prerelease。
4. 也可在 Actions → Release installers → Run workflow 中手动填入已有 tag 构建发布。

### 重跑已有 tag

重跑同一 tag 时，私有与公开仓库已存在的 Release 不会被重建，而是以 `gh release upload --clobber` 覆盖同名安装包后重新公开。因此为历史 tag 补发可直接重跑。

### 公开镜像

私有 Release 发布成功后，同一工作流会把同一批安装包和完全相同的 release notes 再发布到公开仓库 [Chang-Yo/Dela_releases](https://github.com/Chang-Yo/Dela_releases) 的同名 tag Release。公开仓库中的 tag 由 GitHub 自动创建在其默认分支最新提交上，仅作发布锚点，不对应源码。

首次使用前的准备：

1. 公开仓库已有初始提交（例如 README）。
2. 在本仓库 Settings → Secrets and variables → Actions 配置 `PUBLIC_RELEASE_TOKEN`：仅授权 `Chang-Yo/Dela_releases`、权限 Contents: Read and write 的 fine-grained PAT——内置 `GITHUB_TOKEN` 无法跨仓库发布。

## 平台基线

| 平台    | 最低系统基线 | 架构 | 产物               | GitHub runner  |
| ------- | ------------ | ---- | ------------------ | -------------- |
| Windows | Windows 10   | x64  | NSIS `.exe` 安装包 | `windows-2022` |

- 以上是项目选择的构建基线，不代表最低系统实机兼容性已验收。GitHub runner 是构建环境，与最低运行系统不同。
- 安装包名包含版本、系统和架构，避免产物重名。私有发布任务使用内置 `GITHUB_TOKEN`（`contents: write`），公开发布任务使用 `PUBLIC_RELEASE_TOKEN`，token 权限只覆盖公开仓库。
- prepare 与 release 任务仍在 ubuntu runner 上运行，它们只做校验与 gh CLI 上传，不构建应用。

## 当前限制

- 未配置代码签名，安装时可能遇到 SmartScreen 提示。
- 工作流中的冒烟检查验证打包后程序及 SQLite/preload，不代替 NSIS 安装向导的实机验收。
- 自动更新元数据（`latest*.yml`、blockmap）暂不发布；`electron-updater` 等存在正式签名与更新渠道后再引入。
- MSIX 打包与微软商店分发是后续计划，当前安装包为 NSIS `.exe`。
