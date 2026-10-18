# macOS 适配验证记录

2026-10-15 至 2026-10-17，在 `codex/macos-phase1` 分支完成 Apple Silicon macOS 第一阶段适配。验证基线从 main `55108ce` 开始，期间同步至 `b3c5a70`。本文汇总验证结论、限制与复现方式；架构、平台约定与完整命令以 [DEVELOPMENT.md §16](DEVELOPMENT.md#16-平台基线) 为准。

**当前结论**：开发运行、arm64 打包与解包启动、主要桌面交互、文档读取和核心校园业务已在本机通过。Developer ID 签名、公证、Gatekeeper 首启、自动更新、真实登录启动与 Windows 实机回归尚未完成；当前 macOS 产物仅供开发验证，不是正式发行版。

## 范围

| 项目      | 当前状态                                                       |
| --------- | -------------------------------------------------------------- |
| 平台      | 仅 Apple Silicon arm64；不适配 Intel Mac；不支持 Linux 桌面端  |
| 正式分发  | 仅 Windows x64；macOS 提供 arm64 DMG/ZIP 开发产物              |
| 更新      | Mac 应用内更新默认关闭；签名候选与更新开关已准备，未接入线上源 |
| 签名/公证 | 未执行；截至 2026-10-17，Apple Developer Program 申请审核中    |
| 记录边界  | 本机抽样验证，不代表云端 CI、Windows 实机或全部账号/文件格式   |

## 环境

- 主机：macOS 27.0.1，Apple Silicon arm64。
- 工具链：Node 24.21.0、pnpm 12.3.4、Electron 44.3.0，冻结锁文件。
- 原生依赖：better-sqlite3 与 node-pty 使用随包预编译产物；Darwin 下由 `postinstall` 修正 node-pty `spawn-helper` 权限。
- 固定工具链的启用方式见 [DEVELOPMENT.md §11](DEVELOPMENT.md#11-工具链与启动)。

## 已验证能力

| 领域             | 结果                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装与检查       | 冻结锁文件安装、格式、lint、类型检查与生产构建通过；最近完整测试为 138 个文件 / 1098 项。保留已知动态导入、大 chunk 提示与工作区 `session:create` 桩日志，不视为零警告。                                                                                                   |
| 运行时与终端     | `smoke:runtime` 在 `PI_OFFLINE=1` 下执行真实 Pi Bash 的 `dela help`、grep 与 find；以仅含系统目录的 PATH 起步仍能找到随包 rg/fd。终端输入、粘贴、选区复制、多会话、切换恢复与关闭清理通过。                                                                                |
| 系统命令与打开   | 系统 `/usr/bin/ssh`、本机 Git 与 VS Code CLI 定位完成；Finder 与 VS Code 打开项目实测通过。真实 SSH 连接与 Remote-SSH 未验收。                                                                                                                                             |
| 桌面交互         | Mac 原生红黄绿按钮与导航合并为单行；原生菜单、⌘ 快捷键、关闭隐藏、⌘Q 退出、辅助窗口关闭及取消退出后终端/命令桥存活通过。笔记在两种编辑模式下 ⌘W 关标签、自动保存与重新打开内容一致。标题栏在多组窗口宽度、缩放与字号下通过布局回归。动画、多显示器与系统级键位冲突未验收。 |
| 登录启动         | 设置页复核系统状态并处理 `requires-approval`、静默失败与调用异常；开发与冒烟运行不注册登录项。真实系统批准后的登录隐藏启动未验收。                                                                                                                                         |
| 打包与启动       | arm64 `.app`、DMG、ZIP 生成并通过架构、资源、许可证与压缩包完整性检查；LaunchServices 从仓库外目录和系统 PATH 启动、DMG 挂载复制与 ZIP 解包启动通过。包内冒烟由开发 Electron 加载，Keychain 结果不等于签名应用身份；下载 quarantine/Gatekeeper 首启未验收。                |
| 文档读取         | Apple Silicon 运行时安装接入现有组件；真实安装后读取中文 DOCX、XLSX、PPTX、PDF 选页/续读与扫描 PDF 页面回退通过。扫描件不提供 OCR；`smoke:documents` 需联网，首次组件下载约 128 MiB。                                                                                      |
| 校园服务         | 水源浏览、课表同步、课堂视频空列表与点播课程回退在本机真实账号抽样通过；课堂视频显示本学期 6 门课与 20 场录像，两路播放及单场下载通过。水源、课表、课堂视频登录窗口均有原生关闭按钮，支持 Esc/⌘W、取消与重试。                                                             |
| 模型、邮件与课件 | 真实模型调用 Bash 工具并返回结果；合成邮件草稿保存、退出重启后保留；Canvas PDF 预览、翻页与下载副本 SHA-256 一致。上述为抽样验证，不代表所有模型、邮箱与文件格式。                                                                                                         |
| 路径与资料       | 聊天与课件引用的 POSIX 路径、反斜杠文件名、移动后的标签/草稿边界、学期时间排序与后台资料同步通过自动回归和本机应用检查。大小写敏感卷与 Windows 实机未验收。                                                                                                                |

## 未验收与限制

- **发布链路**：Developer ID 签名、公证、Gatekeeper 下载后首启、稳定 Keychain 身份、Mac 更新源，以及同一签名身份的两版升级。签名候选工作流已准备但未执行；Mac 自动更新在正式验证完成前保持关闭。
- **系统行为**：系统批准后的真实登录启动、系统保留快捷键与自定义键位的冲突、多显示器与动画表现。全屏仅复核静态布局。
- **环境覆盖**：Windows 实机回归、最低 macOS 13、Intel Mac 与 GitHub Actions 云端 macOS 任务。Intel 不在支持范围；云端结果需在 GitHub 上另行确认。
- **业务覆盖**：真实 SSH/Remote-SSH、完整首启向导与条款接受、全部账号/课程/文件格式。真实 SSH 按既定决定不作为本次适配的阻塞项。
- **能力边界**：PPTX 仅交给系统默认应用打开，不接入 Keynote 或 PDF 转换器；扫描 PDF 不提供 OCR。

## 关键决策

- 仅支持 Apple Silicon；早期 x64 与双架构计划已撤销。
- Mac 的 PPTX 只交给系统默认应用打开；早期 Keynote 转换实验仅作历史证据。
- 真实 SSH 不作为本次适配的阻塞项；合作者反馈不等同于 Mac 客户端链路验收。
- Mac 自动更新在签名、公证与两版升级验收完成前保持关闭。

## 复现

固定工具链下可执行：

```sh
export PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH"
pnpm install --frozen-lockfile
pnpm check
pnpm smoke
pnpm smoke:macos
pnpm smoke:runtime
pnpm smoke:desktop
pnpm smoke:workspace
pnpm exec electron scripts/terminal-smoke.cjs
pnpm smoke:documents   # 显式联网，首次约 128 MiB
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dist --mac --arm64 -c.electronDist=node_modules/electron/dist
node scripts/verify-macos-package.ts dist/mac-arm64/Dela.app
node scripts/macos-launch-smoke.ts dist/mac-arm64/Dela.app
dist/mac-arm64/Dela.app/Contents/MacOS/Dela --smoke-test
```

`pnpm check` 已包含格式、lint、构建与单元测试；`smoke:documents` 需要访问 GitHub、Python 分发源与 PyPI。完整命令与各冒烟的覆盖范围见 [DEVELOPMENT.md §16.3](DEVELOPMENT.md#163-macos-本地验证)。

## 历史记录

本文取代此前按阶段编写的逐次验证日志。早期失败复现、调查过程与逐次测试数量已删除；需要追溯时查看 git 历史与 [CHANGELOG.md](../CHANGELOG.md)。
