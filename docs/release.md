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

## 通过 Partner Center 提交 MSIX

发布流水线在 NSIS 之后额外产出商店提交包，作为 Actions artifact `store-package-win-x64` 上传（`build` 任务末尾），不随 Release 发布。

1. 在 Partner Center 应用概览 → 产品管理 → View app identity details 抄下三项，填进 `electron-builder.yml` 的 `appx` 块：`identityName`（Package/Identity/Name）、`publisher`（Package/Identity/Publisher，形如 `CN=<GUID>`）、`publisherDisplayName`。三项必须逐字一致，大小写与标点都要对，否则商店拒收。
2. 推送 `v*` tag 或手动重跑工作流。`build` 任务最后执行 `pnpm exec electron-builder --win appx --x64 --prepackaged dist/win-unpacked`，产出 `Dela-<版本>-win-x64.appx`（复用的是上一步 NSIS 打包并冒烟过的 `dist/win-unpacked`，本地要复现需先跑一次 `pnpm exec electron-builder --dir --x64`）。
3. 从该次运行的 Artifacts 下载 `store-package-win-x64`。
4. 在 Partner Center 提交的 Packages 页上传该文件。

要点（2026-10 核实）：

- electron-builder 没有 `msix` 目标，商店包由 `appx` 目标产出，扩展名是 `.appx`；Windows 目标只有 `nsis`、`nsis-web`、`portable`、`appx`、`msi`、`msi-wrapped`、`squirrel`、`7z`、`zip`、`tar.*`、`dir`，传 `msix` 会报 `Unknown target: msix`（本仓库锁定的 electron-builder 26.15.3 的配置 schema 与 `winPackager` 源码）。
- Partner Center 的 Packages 页接受 `.msix`、`.msixupload`、`.msixbundle`、`.appx`、`.appxupload`、`.appxbundle`；官方建议 Windows 10 以上传 `.msixupload`／`.appxupload`，但单个 `.appx` 也可提交。见 [Upload MSIX app packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages)。
- 不需要自己签名：[App package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements?pivots=store-installer-msix) 说明 MSIX/AppX 提交商店无需 CA 信任链证书，商店会在认证通过后用微软证书重新签名并替换原有签名；[Sign your MSIX package](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide) 的对照表也把「Microsoft Store distribution」写作「Signed by the Store on submission」。
- `.msixupload`／`.appxupload` 是「包 + 符号文件」容器（同上文档），electron-builder 26.15.3 没有产出它的目标或选项。
- 未配置证书时 electron-builder 把 appx 当「Windows Store only build」构建，不签名（日志 `AppX is not signed`），并把 `appx.publisher` 原样写进清单 `Identity/@Publisher`。这一条来自读源码（`out/codeSign/windowsSignToolManager.js` 的 `computePublisherName`、`out/targets/AppxTarget.js`、`templates/appx/appxmanifest.xml`），非官方文档。

本地需要签名时（只为在本机安装测试，提交商店不需要）：

- 先生成自签名证书，证书 Subject 必须逐字等于 `appx.publisher`（含 `CN=`）：用微软文档里的 `New-SelfSignedCertificate -Subject "<appx.publisher 的值>"`，再把证书导出成 `.pfx`。electron-builder 自带的 `create-self-signed-cert --publisher` 只接受不含 `CN=` 的名字，别把配置里的值直接传进去。
- 自签名包只能装在信任该证书的机器上，测试机要先把证书导入 `LocalMachine\TrustedPeople`；步骤见 [Sign your MSIX package: end-to-end guide](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide)。
- 让 electron-builder 顺便签名：设 `WIN_CSC_LINK`（.pfx 路径、base64 或 https 地址）与 `WIN_CSC_KEY_PASSWORD`，再跑同一条 appx 命令；`.appx` 固定用 SHA-256 签名。

尚未验证（本仓库没有 Windows 打包环境，未实跑）：

- `.appx` 的真实构建、签名与安装；Partner Center 是否接受本流水线产出的包（须先替换占位身份）。
- 清单里 `appx.languages` 未设置，默认只有 `en-US`；提交前需按实际情况决定要声明哪些语言。

## 平台基线

| 平台    | 最低系统基线 | 架构 | 产物                                          | GitHub runner  |
| ------- | ------------ | ---- | --------------------------------------------- | -------------- |
| Windows | Windows 10   | x64  | NSIS `.exe` 安装包                            | `windows-2022` |
| Windows | Windows 10   | x64  | 商店包 `.appx`（未签名，仅 Actions artifact） | `windows-2022` |

- 以上是项目选择的构建基线，不代表最低系统实机兼容性已验收。GitHub runner 是构建环境，与最低运行系统不同。
- 安装包名包含版本、系统和架构，避免产物重名。私有发布任务使用内置 `GITHUB_TOKEN`（`contents: write`），公开发布任务使用 `PUBLIC_RELEASE_TOKEN`，token 权限只覆盖公开仓库。
- prepare 与 release 任务仍在 ubuntu runner 上运行，它们只做校验与 gh CLI 上传，不构建应用。

## 当前限制

- 未配置代码签名，安装时可能遇到 SmartScreen 提示。
- 工作流中的冒烟检查验证打包后程序及 SQLite/preload，不代替 NSIS 安装向导的实机验收。
- 自动更新元数据（`latest*.yml`、blockmap）暂不发布；`electron-updater` 等存在正式签名与更新渠道后再引入。
- 商店包（`.appx`）已随流水线产出但尚未签名、尚未提交商店，见「通过 Partner Center 提交 MSIX」；面向用户的安装包仍是 NSIS `.exe`。
