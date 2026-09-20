# 发布指南

面向维护者的 CI 检查、版本管理与安装包发布流程。

## CI 检查

`.github/workflows/check.yaml` 在 PR 创建、更新、重新打开及 push 到 `main` 时运行：

- 矩阵覆盖 Windows x64、macOS x64/arm64、Ubuntu x64，使用与发布一致的 runner 和固定 Node/pnpm 版本。
- 每个任务执行冻结锁文件安装、`pnpm build`（含类型检查）、`pnpm test`、`pnpm smoke`、应用目录打包及打包后冒烟；`pnpm format:check` 仅在 Ubuntu 任务执行一次。
- 检查不生成安装包、不发布 Release，仅使用 `contents: read` 权限；同一 PR 或 main 分支的新提交会取消旧检查。

若要限制合并，需在 GitHub 的 main 分支规则中将 `Check win-x64`、`Check mac-x64`、`Check mac-arm64`、`Check linux-x64` 设为必需检查——仅添加 workflow 不会自动启用分支保护。

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

## 发布

`.github/workflows/release.yml` 在推送 `v*` tag 时构建并发布 GitHub Release：

1. 先提交版本号和代码，再执行 `git tag v0.1.0 && git push origin v0.1.0`；tag 必须等于 `v` + `package.json` 的版本。
2. 四个平台任务均执行锁文件安装、类型检查与生产构建、单元测试、Electron 冒烟及打包目录启动检查，全部成功后统一创建 Release 并上传安装包。
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

| 平台    | 最低系统基线     | 架构                   | 产物                            | GitHub runner                |
| ------- | ---------------- | ---------------------- | ------------------------------- | ---------------------------- |
| Windows | Windows 10       | x64                    | NSIS `.exe` 安装包              | `windows-2022`               |
| macOS   | macOS 13 Ventura | x64、arm64（分别构建） | `.dmg`                          | `macos-15-intel`、`macos-15` |
| Ubuntu  | Ubuntu 24.04 LTS | x64                    | `.AppImage`（需 `libfuse2t64`） | `ubuntu-24.04`               |

- 以上是项目选择的构建基线，不代表最低系统实机兼容性已验收；[Electron 44 要求 macOS 13 或以上](https://www.electronjs.org/blog/electron-44-0)，该下限也写入 electron-builder 配置。GitHub runner 是构建环境，与最低运行系统不同。
- Linux 冒烟通过 Xvfb 运行，并仅在临时 runner 中放开 AppArmor 对用户命名空间的限制以运行 Electron sandbox。
- 安装包名包含版本、系统和架构，避免产物重名。私有发布任务使用内置 `GITHUB_TOKEN`（`contents: write`），公开发布任务使用 `PUBLIC_RELEASE_TOKEN`，token 权限只覆盖公开仓库。

## 当前限制

- 未配置 Windows 签名、Apple Developer ID 签名或公证，安装时可能遇到 SmartScreen / Gatekeeper 提示。
- 工作流中的冒烟检查验证打包后程序及 SQLite/preload，不代替 NSIS 安装向导或 DMG/AppImage 的最低系统实机验收。
- 自动更新元数据（`latest*.yml`、blockmap）暂不发布；`electron-updater` 等存在正式签名与更新渠道后再引入。
