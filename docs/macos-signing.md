# Mac 签名候选包

`release.yml` 的手动 Mac 选项构建所选分支或 tag 的确切提交，只上传 Actions artifact，不创建 GitHub Release、不上传 Windows CDN，也不启用 Mac 应用内更新。普通 `v*` tag 发布和未勾选 Mac 选项的手动发布仍只处理 Windows。

仅支持 Apple Silicon。复用 `electron-builder.yml` 的应用标识 `io.dela.desktop`、arm64 DMG/ZIP 和资源布局，使用 Developer ID Application、hardened runtime、安全时间戳及 Apple 公证。`rg`、`fd` 单独签名；`.pak` 语言数据不逐文件签名，仍由 Electron 框架的资源封印保护。这一设置已在本地公证包验证，避免签名工具沿框架链接重复处理语言数据。

## 一次性配置

Apple 开发者账号与签名身份由 aizyeee 长期维护。GitHub runner 无法读取本机钥匙串里的 `dela` 公证配置，需要独立配置 CI 凭据。

1. 在「钥匙串访问 → 我的证书」中选中 Developer ID Application 证书，确认展开后有私钥，导出为带密码的 `.p12`。只导出这一个签名身份，不导出整个钥匙串。文件保存在仓库外，密码单独保存；不要把文件或密码发到 issue、PR 或聊天。
2. 由仓库所有者在 **Settings → Environments** 创建 `macos-release`，限制为允许签名的分支或 tag。首次验证可仅允许 `codex/macos-signing-ci`；合并后改为 `main` 或发布 tag。若仓库套餐支持，可配置 required reviewers。
3. 在该环境的 **Environment secrets** 添加下表内容。环境的管理需要仓库所有者权限；这与普通仓库 Secrets 的 collaborator 权限不同。不要将签名私钥放入普通 PR 检查的配置。

| Secret                        | 内容                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `MAC_CSC_LINK`                | `.p12` 文件的 Base64 内容                                     |
| `MAC_CSC_KEY_PASSWORD`        | 导出 `.p12` 时设置的密码                                      |
| `APPLE_ID`                    | 持有 Developer ID 的 Apple 账号登录名                         |
| `APPLE_APP_SPECIFIC_PASSWORD` | 为 CI 单独生成的应用专用密码，保留连字符，不是 Apple 账号密码 |
| `APPLE_TEAM_ID`               | 签名证书所属的 10 位 Team ID；当前身份为 `569D8JTUQN`         |

仓库所有者可用以下命令直接上传证书 Base64，避免打印到终端或写入明文文件。替换文件路径后运行；其余 Secret 用 `gh secret set` 的交互提示填写，勿把密码写进命令参数：

```sh
base64 -i /absolute/path/Dela-Developer-ID.p12 | tr -d '\n' |
  gh secret set MAC_CSC_LINK --repo Chang-Yo/Dela --env macos-release
gh secret set MAC_CSC_KEY_PASSWORD --repo Chang-Yo/Dela --env macos-release
gh secret set APPLE_ID --repo Chang-Yo/Dela --env macos-release
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo Chang-Yo/Dela --env macos-release
gh secret set APPLE_TEAM_ID --repo Chang-Yo/Dela --env macos-release
```

无需为此创建 App Store Connect API key。electron-builder 已支持 Apple ID 与应用专用密码公证。证书私钥只在构建期间导入 runner 的临时钥匙串，构建结束由 electron-builder 清理；凭据不写入生成的打包配置，也不进入 artifact。

## 运行

在 **Actions → Release installers → Run workflow** 选择待验证的分支，勾选 **Build a signed Mac candidate…**，`tag` 留空。Mac 模式构建所选 ref 的提交，忽略 `tag` 输入；Windows 模式必须填写已有版本 tag。

也可通过 CLI 启动已推送分支上的工作流：

```sh
gh workflow run release.yml --repo Chang-Yo/Dela \
  --ref codex/macos-signing-ci -f macos_candidate=true
```

流程依次执行冻结依赖安装、完整检查与构建、重建两种 Linux helper、Electron 冒烟、签名与公证。随后校验目录包和 DMG/ZIP 中的应用：

- 应用标识、版本、arm64 架构、资源布局和工具可执行性。
- 应用与 rg/fd 的严格签名校验、Developer ID 类型、Team ID、安全时间戳与 hardened runtime。
- 公证票据和 Gatekeeper 策略；ZIP 解包、DMG 只读挂载后再次校验应用。
- 真实签名 `.app` 经 LaunchServices 启动的基本冒烟。

成功后下载 `macos-signed-candidate-<commit>` artifact，包含 DMG、ZIP、`SHA256SUMS` 和 `source-commit.txt`，保留 7 天。证书缺失、签名、公证或校验失败都会终止，不上传未通过的候选包。Apple 排队超过 90 分钟也会使任务失败，不能将超时当作公证通过。

普通开发构建继续禁用签名发现；本地已有签名包可只读复核：

```sh
APPLE_TEAM_ID=569D8JTUQN node scripts/verify-macos-package.ts /path/to/mac-arm64/Dela.app --signed
```

脚本按 `.app` 上两级目录定位同版本 DMG/ZIP；只有目录包时添加 `--dir`。不传 `--signed` 时仍走原有开发包校验。

## 验收边界

本地 Developer ID、公证、票据、Gatekeeper 策略和基本使用已通过，证据见 [macos-validation.md](macos-validation.md)。云端签名尚需配置上述 Secrets 后实际跑通。此流程不等于浏览器下载后首启、真实登录启动或两个版本之间的自动更新验收；Mac 更新源与自动更新保持关闭。

参考：[GitHub Secrets 权限与配置](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)、[Electron 公证认证方式](https://github.com/electron/notarize#usage-with-app-specific-password)。
