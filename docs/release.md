# 发布指南

面向维护者的 CI 检查、版本管理与安装包发布流程。

## CI 检查

`.github/workflows/check.yaml` 在 PR 创建、更新、重新打开及 push 到 `main` 时运行：

- 应用只构建 Windows x64（`windows-2022`），与发布一致的 runner 和固定 Node/pnpm 版本。
- helper 在 `ubuntu-24.04` 用 Go 1.27.2 执行本机测试、构建 Linux amd64 静态产物并运行 `--version`；Windows 任务下载当次产物用于打包，并逐字节核对打包后的文件。
- 执行冻结锁文件安装、`pnpm format:check`、`pnpm lint`、`pnpm build`（含类型检查）、`pnpm test`、`pnpm smoke`、`pnpm build:native`、应用目录打包、包内原生模块检查及打包后冒烟。
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
2. Linux helper 任务测试并构建该 tag 对应的源码；Windows 任务下载其产物，执行锁文件安装、类型检查与生产构建、原生模块构建、单元测试、Electron 冒烟、NSIS 构建、包内 helper 一致性与原生模块存在性检查、打包目录启动检查。全部成功后创建 Release 并上传 `.exe`。
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

1. `electron-builder.yml` 的 `appx` 块已按 Partner Center 应用概览 → 产品管理 → View app identity details 填好三项：`identityName`（Package/Identity/Name）、`publisher`（Package/Identity/Publisher，形如 `CN=<GUID>`）、`publisherDisplayName`（Package/Properties/PublisherDisplayName）。三项必须逐字一致，大小写与标点都要对，否则商店拒收；在 Partner Center 改名后要同步这里。
2. 推送 `v*` tag 或手动重跑工作流。`build` 任务最后执行 `pnpm exec electron-builder --win appx --x64 --prepackaged dist/win-unpacked`，产出 `Dela-<版本>-win-x64.appx`（复用的是上一步 NSIS 打包并冒烟过的 `dist/win-unpacked`，本地要复现需先跑一次 `pnpm exec electron-builder --dir --x64`）。
3. 从该次运行的 Artifacts 下载 `store-package-win-x64`。
4. 在 Partner Center 提交的 Packages 页上传该文件。

### 提交前必须做

- **三个身份值已在位，改动前先对 Partner Center。** `appx.identityName`、`appx.publisher`、`appx.publisherDisplayName` 取自 Partner Center「Product identity」页的 Package/Identity/Name、Package/Identity/Publisher、Package/Properties/PublisherDisplayName，当前值（`MADFilm.Dela`、`CN=57320C20-35BA-45E0-8AB9-95D7D30D80AC`、`麦德映画 (MAD Film)`）就是 Dela 的真实产品标识，已实测原样写进产物清单的 `Identity`／`PublisherDisplayName`。官方要求「Values in the manifest are case-sensitive. Spaces and other punctuation must also match.」，所以在 Partner Center 改名后必须逐字同步，否则商店拒收。见 [View product identity details](https://learn.microsoft.com/en-us/windows/apps/publish/view-app-identity-details) 与 [App package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)。
- **版本号第一段不能为 0（已满足）。** 清单 `Identity/@Version` 由 `package.json` 版本补成四段（实测 `1.0.0` → `1.0.0.0`）。官方版本号规则为：最后一段必须为 0，其余各段取 0–65535，例外是「the first section, which cannot be 0」，且该规则对 `.msix`／`.appx` 同样适用（见上一段链接的 App package requirements → Package version numbering）。仓库现为 `1.0.0`（tag `v1.0.0`），该条已满足；版本若回落到 `0.x` 会重新触发限制。Partner Center 对这条的执行严格程度属待验证。
- **包内图标用 Dela 自己的。** `build/appx/` 下的文件按文件名逐字被采用：`StoreLogo.png`、`Square44x44Logo.png`、`Square150x150Logo.png`、`Wide310x150Logo.png` 是模板清单引用的四个槽位（electron-builder 按文件名子串替换自带的微软示例图 `SampleAppx.*`，那批图带 Sample 水印）；该目录不存在或为空时会退回示例图。当前已放入这四个基尺寸，另加 `Square44x44Logo`／`Square150x150Logo` 的 `.scale-200`／`.scale-400` 与 `StoreLogo`／`Wide310x150Logo` 的 `.scale-200`。宽图 310×150 是把方形图居中合成到 `appx.backgroundColor`（当前 `#464646`）上，不是缩放方形图；带 `.scale-` 的文件名会让 electron-builder 额外跑 `makepri.exe` 生成 `resources.pri`。
- **不需要自己签名。** 未配置证书时产物不含 `AppxSignature.p7x`，商店收包后用自己的证书重新签名（见下「不需要自己签名」）。
- **应用内更新要等商店里真的有新版才生效。** 设置页「通用」的检查更新走 `StoreContext`，它只认商店已发布的包：包没上架或商店还没发布更高版本时，检查失败或报「已是最新」。判据是 `process.windowsStore`（由 Electron 按进程有无包标识给出），所以只有商店安装版会走到这条路径；NSIS 安装版与开发运行在界面上只得到「前往商店」。发布新版本的流程见下「升版」。

要点（2026-10 核实）：

- electron-builder 没有 `msix` 目标，商店包由 `appx` 目标产出，扩展名是 `.appx`；Windows 目标只有 `nsis`、`nsis-web`、`portable`、`appx`、`msi`、`msi-wrapped`、`squirrel`、`7z`、`zip`、`tar.*`、`dir`，传 `msix` 会报 `Unknown target: msix`（本仓库锁定的 electron-builder 26.15.3 的配置 schema 与 `winPackager` 源码）。
- 可选，非推荐：确实需要 `.msix` 文件名时，只能设 `appx.artifactName`（例如 `${productName}-${version}-${os}-${arch}.msix`），因为该配置被逐字用作输出路径，而 `--win msix` 这类目标名不存在。扩展名只是文件名：实测同一支 makeappx（electron-builder 自带的 10.0.17763.1）用 `/p a.appx` 与 `/p b.msix` 产出的文件逐字节相同，设 `appx.artifactName` 得到的 `.msix` 与默认 `.appx` 的容器结构、清单完全一致，并非另一种格式，商店也接受 `.appx`。副作用：electron-builder 的签名分支按 `path.endsWith(".appx")` 判定，只有 `.appx` 强制 SHA-256，`.msix` 会落到默认的 `sha1`+`sha256`；当前未签名无影响，自己签名时才需留意。
- Partner Center 的 Packages 页接受 `.msix`、`.msixupload`、`.msixbundle`、`.appx`、`.appxupload`、`.appxbundle`；官方建议 Windows 10 以上传 `.msixupload`／`.appxupload`，但单个 `.appx` 也可提交。见 [Upload MSIX app packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages)。
- 不需要自己签名：[App package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements?pivots=store-installer-msix) 说明 MSIX/AppX 提交商店无需 CA 信任链证书，商店会在认证通过后用微软证书重新签名并替换原有签名；[Sign your MSIX package](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide) 的对照表也把「Microsoft Store distribution」写作「Signed by the Store on submission」。
- `.msixupload`／`.appxupload` 是「包 + 符号文件」容器（同上文档），electron-builder 26.15.3 没有产出它的目标或选项。
- 未配置证书时 electron-builder 把 appx 当「Windows Store only build」构建，不签名（日志 `AppX is not signed`），并把 `appx.publisher` 原样写进清单 `Identity/@Publisher`。这一条来自读源码（`out/codeSign/windowsSignToolManager.js` 的 `computePublisherName`、`out/targets/AppxTarget.js`、`templates/appx/appxmanifest.xml`），非官方文档。

本地需要签名时（只为在本机安装测试，提交商店不需要）：

- 先生成自签名证书，证书 Subject 必须逐字等于 `appx.publisher`（含 `CN=`）：用微软文档里的 `New-SelfSignedCertificate -Subject "<appx.publisher 的值>"`，再把证书导出成 `.pfx`。electron-builder 自带的 `create-self-signed-cert --publisher` 只接受不含 `CN=` 的名字，别把配置里的值直接传进去。
- 自签名包只能装在信任该证书的机器上，测试机要先把证书导入 `LocalMachine\TrustedPeople`；步骤见 [Sign your MSIX package: end-to-end guide](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide)。
- 让 electron-builder 顺便签名：设 `WIN_CSC_LINK`（.pfx 路径、base64 或 https 地址）与 `WIN_CSC_KEY_PASSWORD`，再跑同一条 appx 命令；`.appx` 固定用 SHA-256 签名。

已验证（2026-10，本机 Windows 10.0.26100 实跑）：

- **`.appx` 构建已实证**：`pnpm exec electron-builder --win --x64 --dir --publish never` 与 `pnpm exec electron-builder --win appx --x64 --prepackaged dist/win-unpacked --publish never` 均退出码 0，产出 `dist/Dela-1.0.0-win-x64.appx`，308,746,767 字节，sha256 `6631217B4360B37AE93C1A9DC8FED0EF6D1614F10C8DA4F97F8A5E0BEFFE089E`（比接入应用内更新前的 308,630,293 字节多出原生模块）。它是 zip 容器（548 个条目，根含 `AppxManifest.xml`、`AppxBlockMap.xml`、`[Content_Types].xml`），**未签名**：不含 `AppxSignature.p7x`，与日志 `AppX is not signed reason=Windows Store only build` 一致。包内 `assets/` 是 Dela 自己的 10 张图（四个基尺寸加各档 `.scale-*`），无微软示例图；`.scale-` 文件名触发了 `makepri.exe`，根下另有 `resources.pri`、`resources.scale-200.pri`、`resources.scale-400.pri`。
- 清单中这些字段实测合格：根命名空间为 `http://schemas.microsoft.com/appx/manifest/foundation/windows10`（Windows 10，非 2010）；`<TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />`（由 `appx.minVersion`／`appx.maxVersionTested` 指定，不配置时 electron-builder 写死 `10.0.14316.0`）；`<Application Id="Dela" Executable="app\Dela.exe" EntryPoint="Windows.FullTrustApplication">`；`<Capabilities>` 含 `<rescap:Capability Name="runFullTrust"/>`。
- 包内 `app/resources/app.asar.unpacked/out/native/store_update.node`（233,472 字节）是应用内更新用的原生模块，说明 `asarUnpack` 对 appx 目标同样生效，且商店包的进程有包标识时能 `dlopen` 到它。
- 清单语言已设为 `zh-CN`：`appx.languages: ['zh-CN']`，产物清单里是 `<Resource Language="zh-CN" />`，默认的 `en-US` 已移除（未设置时 electron-builder 写 `en-US`）。
- 工具链解压告警只在首次下载时出现：本机首次解 `winCodeSign-2.6.0.7z` 时报 `Cannot create symbolic link : A required privilege is not held by the client`（`darwin\10.12\lib\libcrypto.dylib`、`libssl.dylib`），electron-builder 容忍并继续，最终退出码 0。CI 两次运行（v0.11.0、v1.0.0）都下载了同一压缩包，日志里没有任何 `symbolic link` 行（`gh run view <id> --log` 检索），即 CI 未复现该告警。

尚未验证：

- **签名与安装**：本机未签名、未安装、未做实机验收；Partner Center 是否接受本流水线产出的包也未验证（身份与版本已就位，仍须真实提交一次才知结果）。
- Partner Center 是否接受当前 `MinVersion=10.0.19041.0`：官方只要求包针对商店支持的 Windows 版本，未给出具体下限。这个值是为应用内更新取的——`StoreContext` 的更新 API 要在 1607（14393）以上，静默下载与下载进度回调要在 1803（17134）以上——与 ChatGPT 桌面版的清单取齐。
- 商店对声明语言与实际资源的匹配要求。

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
- 自动更新元数据（`latest*.yml`、blockmap）不发布：走微软商店的应用内更新不需要它们，`electron-updater` 要等自建分发有正式签名与更新渠道后再谈。
- 商店包（`.appx`）已随流水线产出但尚未签名、尚未提交商店，见「通过 Partner Center 提交 MSIX」；面向用户的安装包仍是 NSIS `.exe`。应用内更新的原生模块已随包构建与检查，但整条路径要等商店上架并有更高版本后才能实机验收。
