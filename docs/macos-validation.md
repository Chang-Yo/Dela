# macOS 适配验证记录

记录自 2026-10-15 起在 `codex/macos-phase1` 分支进行的适配验证，基于 main 的 `55108ce`。各阶段的结果、失败与限制对应当时的代码状态；早期结论可能已被后续阶段取代。

当前架构、协作边界、跨平台取舍与开发命令以 [DEVELOPMENT.md §16](DEVELOPMENT.md#16-平台基线) 为准，版本变化见 [CHANGELOG.md](../CHANGELOG.md)。本文保留实验与验收证据，不作为当前实现规范。

## 第一阶段：依赖与路线验证

以下描述第一阶段结束时的状态；产品 Bash/SSH 定位与打包资源问题在第二阶段处理。

2026-10-15，在 `55108ce`（main）基础上的 `codex/macos-phase1` 分支验证。环境为 macOS 27.0.1 / Apple Silicon arm64，Node 24.21.0、pnpm 12.3.4、Electron 44.3.0。第一阶段未修改 `src/` 业务代码、依赖版本或锁文件。本阶段只修复安装后的原生程序权限并提供验证脚本；后续适配仍待实施。

### 实测结果与范围

| 项目                    | 结果         | 范围与限制                                                                                                                                                               |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 冻结锁文件安装          | 通过         | Electron 官方下载首次 `fetch failed`，临时使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 重试，仍由 Electron 包自带 checksums 校验；未将镜像写入仓库配置 |
| better-sqlite3 / canvas | 通过         | Node 24 与 Electron 44 中分别验证 SQLite 写入读取、canvas 生成 PNG；Electron 冒烟另检查像素值，无源码重建                                                                |
| node-pty / Bash         | 修复后通过   | 原包 `spawn-helper` 为 0644，实际启动失败；postinstall 改为 0755 后，`/bin/bash` 的输入、resize、输出与退出均通过；产品的 `locateBash()` 仍只找 Windows Git Bash         |
| 凭据                    | 部分通过     | Electron `safeStorage` 对合成字符串的加密/解密往返通过；未验证正式签名应用的首次授权、升级后解密或跨设备迁移                                                             |
| 系统工具                | 通过         | `/usr/bin/git`、`/usr/bin/ssh`、`/usr/bin/curl` 可执行；未做真实 SSH 连接，产品 SSH 定位仍待适配                                                                         |
| 格式 / lint / build     | 通过         | 构建仍有 PDF.js CJS `import.meta`、动态导入与大 chunk 警告，本阶段未处理                                                                                                 |
| 单元测试                | 781/789 通过 | 107/109 个文件通过；8 个失败集中于 `terminal.test.ts`（7）与 `commands.test.ts`（1）的 Windows Bash 路径/MinGit 假设，未跳过或掩盖失败                                   |
| 应用 / 工作区冒烟       | 通过         | `pnpm smoke`、`pnpm smoke:workspace` 均成功退出；控制台仍有 sandbox extension 提示，工作区冒烟还有 `session:create` 未注册提示，不能视为零警告                           |
| arm64 `.app`            | 通过基础验证 | 使用下面的实验命令打目录包，打包后 `--smoke-test` 通过；包内 SQLite / canvas / PTY 由开发 Electron 加载验证通过，`spawn-helper` 保留 0755                                |
| PPTX → PDF              | 候选路线通过 | Keynote 14.4 生成一页合成 PPTX，再重新导入并导出 PDF；中文/空格路径可用，PDF.js 确认一页及中英文文本。不是来自 PowerPoint 的真实课件，未验证排版保真度                   |

Intel Mac、最低 macOS 版本、真实账号业务、真实 SSH、正式签名/公证、安装与自动更新均未验收。本机没有 PowerPoint 或 LibreOffice，未实测这两条转换路线。Keynote 仅是候选方案，尚未接入产品；其安装依赖、自动化授权、超时清理及对已有文档的保护需要后续设计和验证。

### 复现

使用当时固定的 Node 24.21.0 与 pnpm 12.3.4。Apple Silicon 本机将校验后的官方 Node 压缩包解压到被忽略的 `.tools/node-v24.21.0-darwin-arm64` 后，可在当前 shell 启用：

```sh
export PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH"
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm smoke:macos
pnpm build
pnpm smoke
pnpm smoke:workspace
```

已安装依赖后若只更新了 postinstall 脚本，显式执行 `pnpm run postinstall`（增量 install 可能不重新运行）。本阶段曾将两个 helper 权限恢复成 0644，确认脚本的 Windows 分支不改文件，再经真实 Darwin postinstall 恢复 0755 并跑通 PTY。Windows 实机与 CI 尚未在此分支运行。

实验打包命令（复用本机 Electron，不寻找签名身份、不发布）：

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --arm64 --dir --publish never -c.electronDist=node_modules/electron/dist
dist/mac-arm64/Dela.app/Contents/MacOS/Dela --smoke-test
pnpm smoke:macos "$PWD/dist/mac-arm64/Dela.app/Contents/Resources/app.asar"
```

第一阶段的 `.app` **不是可分发的 macOS 版本**：当时的构建仍会拷入 Windows `ssh.exe`、`rg.exe`、`fd.exe`，缺少 `.build/mingit` 时会警告；`pnpm package:dir/dist` 仍调用 Windows 专用的 `prepare-runtime.ts`。正式 macOS 打包的资源划分、签名、公证和更新产物留到后续阶段。传入 `app.asar` 的原生冒烟只改变模块加载位置，Keychain 测试仍属于开发 Electron 身份。

安装 Keynote 后可复现转换实验；脚本只操作自己生成/打开的文档，不退出整个 Keynote 应用：

```sh
phase_pptx_dir=$(mktemp -d /tmp/dela-keynote-XXXXXX)
osascript scripts/macos-keynote-smoke.applescript "$phase_pptx_dir/fixture 测试.pptx" "$phase_pptx_dir/fixture 测试.pdf"
```

脚本只验证转换命令成功。此次另用 PDF.js 检查 PDF 页数与文本；检查时需将提取文本做 NFKC 归一化并合并空白，Keynote 输出会拆分部分字符。未据此声称视觉排版一致。

## 第二阶段：命令运行基础

以下描述第二阶段结束时的状态；原生窗口、菜单、快捷键与生命周期在第三阶段处理。

沿用 `codex/macos-phase1` 分支，完成平台 Bash、PTY 参数、PATH、搜索工具、SSH/SFTP 与 VS Code 项目打开的适配。变更位于原有函数/文件内，未拆分业务实现。Windows 的 Git Bash/MinGit 和 OpenSSH 回退顺序保留；终端创建失败时会清理本次 rcfile。

- Mac 的 VS Code 先查 PATH 中的 `code`，再查 `/Applications` 与 `~/Applications` 下标准应用包内的 CLI；完整路径以参数数组传递，本地与 Remote-SSH 入口共用，未安装时明确提示。
- `electron-builder.yml` 将 OpenSSH exe、MinGit、Windows 搜索工具限定在 Windows 资源中；Mac 只拷入对应架构的 rg/fd，共享其许可证和 Linux helper。`prepare-runtime.ts` 在 Mac 不下载 MinGit。暂未配置正式 macOS 发布目标、签名、公证或自动更新验收。
- `pnpm smoke:runtime` 使用临时 profile 与 Pi 缓存、合成文件、`PI_OFFLINE=1`，不调用模型或校园接口；直接执行 Pi Bash 中的 `dela help`、grep 与 find。Mac 上以仅含 `/usr/bin:/bin` 的 PATH 起步，验证 GUI 启动环境也能找到随包工具。
- 单元测试在两种平台分支下验证终端生命周期及 Windows 回退；这些模拟测试不能代替 Windows/Intel Mac 实机验收。真实 SSH 远端套件仍需另行提供测试主机。

开发与目录包复现命令（Apple Silicon，使用[开发文档 §11](DEVELOPMENT.md#11-工具链与启动)的固定工具链）：

```sh
pnpm smoke:runtime
pnpm build
pnpm exec electron scripts/terminal-smoke.cjs
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dir --mac --arm64 -c.electronDist=node_modules/electron/dist
dist/mac-arm64/Dela.app/Contents/MacOS/Dela --smoke-test
pnpm exec electron scripts/terminal-smoke.cjs "$PWD/dist/mac-arm64/Dela.app/Contents/Resources/app.asar"
```

2026-10-15 在同一台 Apple Silicon Mac 上完成验证：

| 检查                                      | 结果与范围                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 格式 / lint / build / 单元测试            | 通过；112 个测试文件、810 个测试全部通过，包括模拟的 Windows 分支；保留原有构建警告                                                       |
| `smoke` / `smoke:macos` / `smoke:runtime` | 通过；真实 Pi 工具与命令桥可用，不代表真实账号业务或模型调用已验收                                                                        |
| 开发版与包内终端                          | 通过；实际键盘输入、粘贴、选区复制、多会话、切换恢复与关闭清理；包内终端由开发 Electron 加载，并使用包内资源路径                          |
| arm64 目录包                              | `package:dir` 成功；实际 `.app --smoke-test` 通过；包内原生依赖冒烟通过，但 Keychain 测试仍属于开发 Electron 身份                         |
| 打包资源                                  | 只包含 arm64 的 rg/fd，内容与源文件一致、权限为 0755，许可证与 Linux helper 保留；无 Windows OpenSSH、MinGit、exe 搜索工具或 x64 搜索工具 |

实际 `.app` 启动仍输出 sandbox extension 提示，不能视为零警告。Windows/Intel Mac 实机、真实 SSH 与 VS Code 启动未验收；VS Code 入口目前由单元测试覆盖。PPTX 产品接入、Mac 原生窗口/菜单/快捷键/生命周期、正式签名与发布仍留待后续阶段。

## 第三阶段：桌面交互

本阶段继续在现有入口、共享键位表和组件中处理平台差异，不复制业务代码。Mac 使用原生标题栏、系统应用/编辑/窗口菜单，Dock 图标遵循已有图标偏好；Windows 保留现有窗口外观。退出保护覆盖笔记与邮件：取消退出后恢复正常的隐藏窗口行为，命令桥与终端延后到确认退出才关闭。

平台行为依据 [Electron 菜单角色](https://www.electronjs.org/docs/latest/tutorial/menus)、[应用生命周期与登录启动 API](https://www.electronjs.org/docs/latest/api/app) 和仓库固定 Electron 44.3.0 的类型定义核对。登录启动不使用已移除的 `openAsHidden`：Windows 仍传 `--hidden`，Mac 启动时读取 `wasOpenedAtLogin` 决定是否隐藏；开发与冒烟运行不注册系统启动项。

### 回归方式与边界

```sh
pnpm smoke:desktop
pnpm exec electron scripts/terminal-smoke.cjs
pnpm smoke:desktop "$PWD/dist/mac-arm64/Dela.app/Contents/Resources/app.asar"
```

桌面冒烟使用临时 profile 和合成项目，执行真实 `app.quit()` 并通过 `beforeunload` 取消，随后再次调用终端中的 `dela help`；邮件路径验证退出意图的 IPC 与取消后存活，不连接邮箱，也不代表真实邮件草稿保存已验收。包内冒烟使用开发 Electron 加载包内代码与资源，实际 `.app` 另执行 `--smoke-test`。终端回归增加 Mac ⌘C/⌘V 和 Ctrl+C 中断检查；共享键位与工作台测试同时覆盖 Mac 和 Windows 分支。

2026-10-15，Apple Silicon / macOS 27.0.1 上的最终结果：

- 格式、lint、构建与 114 个测试文件 / 823 个测试全部通过；Windows 分支由模拟测试覆盖，未做 Windows 实机回归。
- 开发版 `pnpm smoke`、桌面与终端回归通过；arm64 `package:dir` 成功，实际 `.app --smoke-test` 与包内桌面/终端回归通过。
- 原生窗口的系统控件可被辅助功能树识别，静态检查确认标题栏与导航栏分离；未用脚本评估动画。
- 保留既有 PDF.js / chunk / 打包依赖提示；运行中偶见 `sandbox_extension_issue_file` 和 `task_policy_set` 日志，检查成功退出不代表零警告。

实际登录启动、真实邮件草稿保存、系统级键位冲突、全屏/多显示器与动画表现仍需人工验收；Intel Mac、最低系统、签名/公证和自动更新依旧不在本阶段已验收范围内。

## 打包与持续检查

2026-10-15，沿用 Apple Silicon / macOS 27.0.1、Node 24.21.0、pnpm 12.3.4、Electron 44.3.0。按用户决定暂缓 PPTX 转换接入，改为推进开发分发产物、双架构 CI 与更新功能的平台边界；未推送、触发云端工作流或发布版本。

| 检查                | 结果与范围                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 单元测试            | 114 个文件、827 个测试通过；其中更新相关 78 项覆盖 Mac 开发版/打包版的禁用状态、各 IPC 入口、后台计时器、待安装标记与 Windows 原有更新行为                                                 |
| 格式 / lint / build | 通过；保留既有 PDF.js CJS `import.meta`、动态导入、大 chunk 和打包依赖提示                                                                                                                 |
| 开发版冒烟          | `smoke`、`smoke:macos`、`smoke:runtime`、桌面与终端冒烟通过；不调用真实模型或校园账号                                                                                                      |
| arm64 分发产物      | 生成 `Dela-1.1.0-mac-arm64.dmg`（约 252.1 MiB）与 `.zip`（约 250.8 MiB）；`hdiutil verify` 与 `unzip -tq` 通过                                                                             |
| 包内资源            | 应用标识、版本、分类与 arm64 架构正确；rg/fd 可执行且与源文件逐字节一致，许可证与两个 Linux helper 保留；不含 Windows OpenSSH、MinGit、其他架构搜索工具或 `app-update.yml`                 |
| 打包后运行          | 实际 `.app --smoke-test`、包内原生依赖、桌面与终端冒烟通过；桌面冒烟另确认 Mac 更新 API 返回不可用，不进入检查流程                                                                         |
| DMG / ZIP 解包启动  | DMG 以只读方式挂载，复制到含中文与空格的独立临时目录后卸载镜像；ZIP 单独解压。两份应用的 `app.asar` 与目录包一致，分别执行 `--smoke-test` 通过；临时副本与挂载均已清理                     |
| CI 配置             | YAML 解析与 runner/架构/产物路径核对通过；Windows 发布源仅归属 `win.publish`，Mac 发布配置为空。`macos-15` 与 `macos-15-intel` 任务尚未在 GitHub 执行，不能宣称云端检查或 Intel 兼容性通过 |

当前复现命令见 [DEVELOPMENT.md §16.3](DEVELOPMENT.md#163-macos-本地验证)。产物检查脚本仅检查完整性与资源，不安装应用；包内原生依赖冒烟仍使用开发 Electron，Keychain 往返结果不等于正式签名应用的身份与升级验证。

本次未安装到系统 Applications，也未测试浏览器下载后带 quarantine 属性的首次启动。签名、公证、Gatekeeper、Intel/最低 macOS 实机、真实登录启动、账号业务与两版自动升级仍待验收；PPTX 的 Mac 转换器保持暂缓。

## 共享路径与辅助窗口

2026-10-16，继续在同一分支、Apple Silicon / macOS 27.0.1 与固定工具链上验证。PPTX 转换仍暂缓，业务代码继续共用。

- 聊天文件引用不再把 POSIX 路径一律转小写或改写反斜杠；Windows 盘符与 UNC 路径仍兼容大小写及混合分隔符。新增测试先复现项目候选遗漏和文件名误改，再验证修复。
- 远端上下文镜像及命令正文同样按路径格式匹配，保留 POSIX 文件名中的反斜杠，修正前缀相似兄弟目录的误映射。新增离线回归和一项待执行的真实 SSH 文件读写用例。
- Mac 原生关闭菜单使用 Electron 传入的窗口：辅助窗口关闭、主窗口隐藏，无窗口时不操作，且不占用 ⌘W。项目打开入口显示 Finder，共用原有 IPC。

| 检查           | 结果与范围                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静态与单元测试 | 格式、lint、类型检查和构建通过；114 个文件 / 836 个测试通过，比上一阶段增加 9 项离线路径回归                                                                                                                                     |
| 开发版冒烟     | `smoke`、`smoke:runtime`、`smoke:desktop`、`smoke:workspace` 通过；覆盖合成文件导入、笔记冲突保护、移动恢复、预览 Range 读取、资料同步桩及邮件附件草稿，不访问真实账号                                                           |
| 原生菜单       | 将真实辅助窗口传给应用菜单回调，验证只关闭目标窗口；主窗口关闭、Dock 恢复及取消退出后终端/命令桥存活通过。初版用系统焦点判定时后台窗口无法稳定获焦，最终测试按 Electron 的窗口参数契约验证，不把它当作人工菜单点击或真实登录验收 |
| arm64 产物     | 重建 DMG（264343300 字节）与 ZIP（262957550 字节）；应用标识、架构、工具/许可证资源和压缩包完整性检查通过                                                                                                                        |
| 打包后启动     | 实际 `.app --smoke-test` 与包内桌面冒烟通过；本阶段未重复上一阶段的 DMG 挂载复制及 ZIP 解包启动                                                                                                                                  |
| 真实 SSH       | 已尝试 `pnpm test:remote`，因缺少 `DELA_REMOTE_HOST` 在全局前置检查退出 1，未执行远程用例；不能算通过                                                                                                                            |

路径大小写与反斜杠边界由合成路径单测验证，未创建大小写敏感卷进行实机测试。新建文件名继续遵守两端共用的命名限制，避免共享到 Windows 后无法使用；本次修复针对已有路径的识别，不引入第二套业务实现。

2026-10-16，用户确认暂时没有可用的专用 Linux SSH 测试主机，先记录真机验收待完成。保留现有离线回归结果，待测试环境可用后再执行真实 SSH 套件。

构建仍有既有 PDF.js CJS `import.meta`、动态导入与大 chunk 提示；工作区冒烟还会输出其桩中未注册 `session:create` 的日志，脚本最终通过不代表零警告。Windows/Intel Mac、SSH 真机、真实账号、系统登录启动、动画及签名/公证验收仍待完成，未提交、推送或发布。

## 未支持能力提示与系统启动

2026-10-16，继续使用同一 Apple Silicon Mac、分支与固定工具链，按用户决定暂缓 Mac PPTX 转换器和 SSH 真机验收。

- 修复 Mac 上仍显示 PPTX 导出按钮并尝试调用 Windows PowerShell 的问题。界面说明外部打开或导入 PDF 的替代方式；主进程在下载源文件、创建导出目录或写入关联前拒绝转换。已有 PDF 的阅读与过期提醒保留，Windows 继续使用原有转换流程。
- 新增回归先复现 Mac 的界面与主进程问题，再验证修复；Windows 用模拟转换进程检查调用参数、进度、PDF 关联与原文件保留，不能据此宣称真实 PowerPoint 转换通过。
- 新增 `scripts/macos-launch-smoke.ts` 并接入 Mac CI：经 `/usr/bin/open` 启动真实 `.app`，工作目录位于仓库外，PATH 限为系统目录，并要求应用自身报告冒烟通过。使用隔离 profile，不注册登录项；云端工作流尚未执行。
- 隐藏应用后恢复窗口的本机状态检查未复现异常，因此未修改通知逻辑；未进行动画自动化检测。

| 检查               | 结果与范围                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元测试与静态检查 | 116 个文件 / 845 个测试通过；lint、类型检查通过；本次新增 9 项 PPTX 平台边界回归                                                                                |
| 构建与分发产物     | `package:dist` 内的生产构建通过；重建 arm64 DMG（264343680 字节）与 ZIP（262957932 字节），资源、架构、许可证及压缩包完整性检查通过                             |
| 系统启动           | LaunchServices 启动实际 `.app` 后，SQLite、renderer、preload 隔离与 Agent ESM 运行时冒烟通过；未安装到 Applications，不代表下载后 Gatekeeper 或真实首启引导验收 |
| 开发版与包内桌面   | `pnpm smoke`、开发版与包内 `smoke:desktop` 通过；真实 IPC 拒绝 Mac PPTX 转换且工作区状态不变，关闭/恢复窗口、取消退出后 PTY 与命令桥存活检查通过                |

桌面冒烟会输出刻意触发的「当前平台暂不支持 PPTX 转 PDF」IPC 错误，这是被断言的拒绝路径；构建保留既有 PDF.js、chunk 与打包依赖提示。包内桌面冒烟由开发 Electron 加载，实际应用启动另由 LaunchServices 检查，未重复 DMG 挂载复制与 ZIP 解包启动。

仍待验收：Windows 与 Intel Mac 实机、最低 macOS、真实账号与模型、系统登录启动、系统键位冲突、全屏/多显示器、动画、签名/公证和两版升级。PPTX 转换器与 SSH 真机验收保持暂缓；未提交、推送或发布。

## 同步 main 1.2.0 与协作决定

2026-10-16，拉取 `main` 的 24 个新提交，从 `55108ce` 快进到 `a67538c`（`chore(release): prepare v1.2.0`）。本地 `main` 与 `codex/macos-phase1` 均以该提交为基线，适配改动恢复在后者的工作区；同步前的 tracked/untracked 文件保留在 stash `8e8dd4b`，没有创建适配提交或推送。

- PPTX 决定更新为 Mac 只提供系统默认应用打开，不接入 Keynote 或其他 PDF 转换器。复用上游 `openResourceFile` 与 `shell.openPath`，合并两端的 UI 回归；Mac 显示外部打开按钮，Windows 继续并排显示转换与外部打开。已有 PDF 阅读与过期提醒、主进程转换拒绝保护保留。
- 用户转述合作者已有 SSH 测试稳定，决定本次聚焦 Mac 编译与适配，不再以 SSH 真机回归为阻塞项。该结论作为协作反馈记录；本机未运行真实 SSH 链路，不能宣称 Mac 客户端到远端已验收。
- 保留上游条款、备份、缓存和启动失败处理，合并 Mac 窗口生命周期，消除双方都增加 `window:quit` 导致的重复注册。新增的三个 Node `.mjs` 脚本迁移为 `.ts` 并纳入类型检查，跟随上游现有脚本重命名；锁文件保持上游版本。
- 上游移除了主进程原生 canvas 依赖，Mac 冒烟同步删除该过时检查；SQLite、Keychain 与 PTY 检查保留。根 README 按上游新增的人工维护约定保持原样，先前适配说明仍可从同步前恢复点取回。
- 新发现的能力缺口：上游将 Agent 的 Office/PDF 正文读取迁到可选 `document-reading` 组件，其安装器目前明确限制 Windows x64。Mac 的该组件、文档附件与网页 PDF 读取尚未适配，与 GUI 阅读器及 PPTX 默认应用打开是不同的能力；本次未新增 Mac Python/uv 安装方案。

固定工具链下，冻结锁文件安装、类型检查、lint、格式与冲突标记检查通过；完整单元测试为 131 个文件 / 951 个测试全部通过，包含合并后的 PPTX、聊天引用、邮件编辑与更新回归。

| 检查       | 结果与范围                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 构建与打包 | `package:dist` 内的生产构建通过，生成 `Dela-1.2.0-mac-arm64.dmg`（251654455 字节）与 ZIP（250257499 字节）；未签名、未发布                                                                                          |
| 开发版回归 | `smoke`、`smoke:macos`、`smoke:runtime`、`smoke:desktop`、`smoke:workspace` 通过；使用隔离数据，无真实模型或校园账号请求                                                                                            |
| 产物检查   | 应用标识、arm64 架构、工具/许可证/helper 资源及 DMG/ZIP 完整性检查通过。首次执行包内 `rg --version` 超过 5 秒；单独复查 rg/fd 分别约 0.012/0.009 秒，按原脚本与原超时重跑完整检查通过，未修改超时阈值，原因尚未确定 |
| 打包后启动 | LaunchServices 在仓库外、系统 PATH 下启动实际 `.app` 通过；包内原生依赖与桌面回归通过。包内依赖/桌面检查仍由开发 Electron 承载，不代表正式签名身份验收                                                              |

构建保留既有动态导入、大 chunk 与打包可选依赖提示；桌面冒烟输出被断言的 PPTX 拒绝日志，工作区冒烟仍有未注册 `session:create` 的桩日志。未自动化检查动画，未执行真实 PPTX 默认应用交互、SSH、Windows/Intel Mac、云端 CI、签名/公证及真实账号业务；这些范围与“本机 Mac 编译和打包启动通过”分别记录。

## 文档读取组件与 Apple Silicon 范围

2026-10-16，在 `codex/macos-phase1`（基线 `5a8bb79`）、Apple Silicon / macOS 27.0.1 上先完成隔离调查。用户随后明确：**macOS 只需要支持 Apple Silicon，不适配 Intel Mac**。因此移除早期 Intel CI 任务及 `vendor/bin/darwin-x64` 资源，DMG/ZIP 目标固定 arm64；前文双架构计划与 Intel 待验收项仅保留为历史记录。Windows x64 和 Linux 远端 helper 的两种架构不受此决定影响。

### 隔离验证

没有修改 `read.py` 或依赖版本、wheel hashes；仅在锁文件标题补充 macOS arm64。测试下载、缓存、合成文档与详细输出位于被忽略的 `.tools/macos-document-eval/`，不读取个人文档，不写系统 Python 或用户组件目录。

| 项目     | 结果与范围                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Python   | Astral python-build-standalone 3.12.10 / 20250529，arm64 `install_only_stripped`；SHA256 `2579c9ffcbb0a745f1de3d645612c7466269eb9a23316a54ece49d50c1c9122f`，与 uv 0.11.1 固定目录一致，下载后校验通过 |
| uv       | 0.11.1 arm64；SHA256 `f7815f739ed5d0e4202e6292acedb8659b9ae7de663d07188d8c6cbd7f96303f`，与 GitHub Release digest 一致，下载后校验通过                                                                 |
| 依赖     | 原 42 项精确依赖全部按 `--only-binary :all: --no-deps --require-hashes` 安装成功；未源码构建或放宽哈希。产品同款自检通过，`uv pip check` 检查 43 个已安装包通过（多出的一个是 standalone 自带 pip）    |
| 读取     | 12 个用例通过；移动整个解释器到含中文与空格的新路径后再跑同一组，另 12 个通过。每次是独立 Python `-I` 子进程，cwd 在仓库外，PATH 仅 `/usr/bin:/bin`                                                    |
| 原生库   | 检查 108 个解释器、动态库与扩展文件的 Mach-O 加载命令，没有指向系统目录以外的绝对依赖路径；动态库自身的 install name 不当作外部依赖。此检查不替代最低 macOS 实机验证                                   |
| 体积     | 本机实际选择的 42 个 wheels 共 98088164 字节，加 Python/uv 压缩包共约 127.95 MiB 下载；安装后的普通文件合计约 356.34 MiB（含 pip 与测试生成的字节码），不是最终分发包体积                              |
| 系统下限 | 官方 wheel 元数据存在 macOS 13 可用的完整 arm64 集合；当前主机选择了部分更新系统专用 wheel。未在 macOS 13 运行，不能宣称最低系统验收通过                                                               |

12 个用例分别覆盖：带图片与表格的中文 DOCX、改名为 `.bin` 的 DOCX、多工作表 XLSX、重排页序且带备注和图片的 PPTX、中英文文本 PDF、PDF 选页与去重、7 页扫描 PDF 的首 6 页回退与剩余页提示、第 7 页续读、越界页码、对 Office 使用页码、缺失文件、损坏 PDF。扫描页图片另作静态目视确认；`needs_visual_read` 和图片未解读提示保持原样，没有增加 OCR。XLSX 未缓存公式不因跨平台验证而变成可计算结果。测试最初修正了合成 PDF 字体描述与 Markdown 转义断言，最终两组用例均通过；正式读取脚本没有改动。

原脚本 SHA256：`79c914a4fa9f46c10f2a764914fbe92ceb854e3780b0dbbdb4130e03e3e14524`。

安装复现参数（`PYTHON`、`SITE_PACKAGES` 均指向隔离目录）：

```sh
uv --no-config pip install --python "$PYTHON" --target "$SITE_PACKAGES" \
  --only-binary :all: --no-deps --require-hashes --no-cache \
  --default-index https://pypi.org/simple -r src/main/documents/skill/requirements.lock
uv --no-config pip check --python "$PYTHON"
"$PYTHON" -I src/main/documents/skill/scripts/read.py "$INPUT" --output "$OUTPUT"
```

### 调查发现与已确认取舍

- Intel 最初只有 41/42 项匹配 wheel：`cryptography==50.0.2` 缺失。官方[更新记录](https://cryptography.io/en/latest/changelog/#v49-0-0)明确从 49.0.0 移除 macOS x86_64；uv 在 Intel 目标预检查中拒绝安装。仅把实验副本的 cryptography 换成 48.0.1 后预检查可解析 42 项，但 [PyPI 元数据](https://pypi.org/pypi/cryptography/48.0.1/json)列有已知安全公告；未将旧版安装或写入产品锁文件，也未断言这些公告均可在 Dela 文档路径触发。用户决定不支持 Intel 后，不再推进此路线。
- Python/uv 的平台包和目录不同，读取脚本、文档任务、Skills API 与依赖版本共用，不形成第二套核心功能。PPTX 正文提取与 GUI 转 PDF 是不同能力；Mac GUI 仍只用系统默认应用打开 PPTX。
- 补充许可证文本从对应版本源码或匹配的 Python full archive 获取，包含来源与原文摘要；保留已下载文件自带的许可证。Python full archive SHA256 为 `7b3698a64577aae9b6c32f31891dc367618714e0df3393fd7f1bb0d351c99200`；其元数据引用但未附带的 zlib-ng 文本从对应 2.2.4 源码补齐。Cobble 上游只在 README 声明 BSD-2-Clause，补充文件保留这一事实与作者来源，没有虚构版权年份。

来源：[uv 固定 Python 目录](https://github.com/astral-sh/uv/blob/0.11.1/crates/uv-python/download-metadata.json)、[uv 0.11.1](https://github.com/astral-sh/uv/releases/tag/0.11.1)、[Python standalone 20250529](https://github.com/astral-sh/python-build-standalone/releases/tag/20250529)。原始来源信息与许可证正文保存在 `src/main/documents/runtime-licenses.txt`，由安装器写入组件目录；实验工具、下载包与日志不进入提交。

### 接入后的回归

Apple Silicon 安装路径已接入现有 `src/main/documents/runtime.ts`，没有增加另一套解析器或修改依赖版本。Windows 保留 embeddable Python、`python312._pth` 和 `uv.exe` 路径，Mac 使用 standalone 目录与 `/usr/bin/tar`。补充许可证进入主进程产物，安装时写入组件目录；打包检查确认 `.tools` 实验文件未进入 `app.asar`。

| 检查           | 结果与范围                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元测试       | 132 个文件 / 960 项通过；新增 9 项覆盖 Mac/Windows 安装参数、成功后发布 ready、重复调用复用、两次下载的哈希失败、取消清理及重试、缺失文件、初次/已有组件自检失败与不支持的平台                                               |
| 静态检查       | 类型检查、lint、格式检查通过；新增联网冒烟纳入 TypeScript 项目。首次补充检查发现旧冒烟模式使用的 `app.setAppPath` 不在 Electron 公共类型中，删除该不必要调用后检查与真实安装复测通过                                         |
| 真实组件流程   | `pnpm smoke:documents` 在开发 Electron 中使用真实安装器、官方源、原 Skills API 和资源任务 API；DOCX/XLSX/PPTX 正文及扫描 PDF 图片回退通过，临时任务与 profile 清理通过。不是模拟安装成功，也不是实际模型调用或手工点击设置页 |
| 构建与产物     | `package:dist` 中的 `pnpm build` 通过；生成 arm64 DMG（251648583 字节）与 ZIP（250275516 字节），包内安装器 URL、哈希、许可证文本均存在，未混入本地实验工具                                                                  |
| 启动与原生依赖 | 开发版 `pnpm smoke`、实际 `.app` 的 LaunchServices 启动（仓库外 cwd / 系统 PATH）、包内 SQLite/Keychain/PTY 冒烟通过；包内原生检查由开发 Electron 加载，正式签名身份尚未验证                                                 |
| CI 与打包配置  | YAML 解析及目标断言通过：Mac 仅 arm64，Windows 保持 x64；未推送或触发 GitHub 工作流，不宣称云端检查通过                                                                                                                      |

产物检查首次运行包内 `rg --version` 再次超过原有 5 秒阈值；之后 rg/fd 单独运行约 0.01/0.00 秒，按原脚本与原阈值重跑完整资源及 DMG/ZIP 完整性检查通过。该进程有一条 `syspolicyd` 来源跟踪日志，但不足以确定超时原因；未修改超时阈值，也未将其归结为已确认的 Gatekeeper 故障。此首次运行波动继续作为待排查项。

本次未重复 DMG 挂载复制、ZIP 解包启动、桌面动画或真实账号/模型业务；未完成 Windows 实机、最低 macOS 实机、签名、公证、下载后首启和自动更新验收。README 与工具目录 README 均遵循人工维护约定，需由维护者同步 Apple Silicon 支持范围及可选组件说明。本地验证完成，改动按构建范围与文档组件两个主题分别提交，未推送。
