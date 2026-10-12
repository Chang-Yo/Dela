<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/Dela_black_bg.png">
  <img src="assets/Dela_white_bg.png" alt="Dela" width="420">
</picture>

**带工作台的本地个人 Agent，连接交大校园信息与本地文件**

Agent 内核 · 校园 Skills · 本地优先

[![Platform](https://img.shields.io/badge/platform-Windows-blue)](#下载安装)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

Dela 是为上海交通大学学生打造的本地个人 Agent：内核是 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) Coding Agent（read / write / edit / bash / grep / find / ls，外加可选的 web_search / web_fetch 与 MCP 工具），领域能力外置为 `dela` 命令与 Skills 文档，GUI 工作台只是消费同一套能力的壳。Canvas 课程资料、校园邮箱、课表、水源、TODO 由此聚合，以「项目」为单位组织资料、笔记与会话。所有数据保存在本机（SQLite + 磁盘文件），凭据经系统密钥加密。仅支持 Windows。

> _The world keeps changing. Dela stays with you._

应用单实例运行，关闭窗口后驻留托盘，右键托盘可退出。

## 功能一览

|     | 功能                | 说明                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🤖  | **Agent 内核**      | Pi Coding Agent：直接读写本机文件、执行 Git Bash 命令，会话保留完整的工具上下文并自动压缩。会话各有自己的工作目录：项目会话就是项目目录，通用会话用私有目录（资料页会话落在课件目录）；`@` 引用工作目录内的文件，agent 自主读取。模型服务在「设置 › 模型供应商」配置，自定义 OpenAI 兼容网关会自动校正 API 地址；输入框底部圆环显示上下文占用，点击查看已用/窗口总量 |
| 🔧  | **dela 命令**       | 课程、邮件、水源、课表、待办、工作区六个领域，外加按需读取资料资源的 `read_resource`，经 shell 内本机命令桥调用应用内实现（复用缓存与登录），`dela help` 查看全部命令与参数                                                                                                                                                                                          |
| 📚  | **Skills**          | shuiyuan / canvas / mail / todo / curriculum 五份领域知识内置在 `~/.dela/skills`，教 agent 何时如何组合命令；设置页可启停，自定义 Skill 放同一目录即被发现                                                                                                                                                                                                           |
| 🗂️  | **统一工作台**      | 聊天、笔记、文件预览、终端同为标签：可拖拽分组与分屏，布局按项目记忆；Markdown 所见即所得，图片落盘正文旁；目录对应真实磁盘文件夹（新建项目可导入电脑上已有的文件夹，留在原处），外部编辑器可直接打开                                                                                                                                                                |
| 🖥️  | **远程项目**        | 用 SSH 连接远端 Linux 主机并把远端目录登记为项目：agent 的读写、搜索与命令执行，以及项目终端，都在远端运行，内核、密钥与会话记录仍留在本机。认证只用密钥或 ssh agent（可在 `~/.ssh/config` 里配跳板与默认端口）；需要在远端密码登录时，用项目终端里的 ssh 交互输入                                                                                                   |
| 🎓  | **Canvas 课程资料** | 个人 Access Token 同步课程与资料，按需缓存、内嵌阅读；PowerPoint 经本机 PowerPoint 导出 PDF；资料可一键挂进项目                                                                                                                                                                                                                                                      |
| 📧  | **校园邮箱**        | 交大邮箱或任意第三方 IMAP/SMTP（自填服务器）；IMAP 同步，HTML 沙箱渲染；富文本写信、附件收发、本地草稿箱与回收站                                                                                                                                                                                                                                                     |
| 📅  | **课表与 TODO**     | 经 jAccount 登录教学信息服务网同步课表，周/月视图；个人待办与 Canvas 作业统一管理，可一键写入日历                                                                                                                                                                                                                                                                    |
| 💧  | **水源社区**        | Discourse User API Key 正式授权；信息流、楼层阅读、回复点赞、私信、通知；帖子可挂进项目                                                                                                                                                                                                                                                                              |
| 🔍  | **搜索与通知**      | `Ctrl+K` 跨项目、会话、邮件与资料搜索；邮件、水源与作业通知聚合，可免打扰暂停，后台新消息弹系统通知                                                                                                                                                                                                                                                                  |

联网搜索默认关闭：web_search 需要在「设置 › 内置能力」的「网络」分组中注册一个搜索服务（Brave Search API、Google 搜索或自定义 JSON 端点），Dela 不内置搜索服务。read / write / edit / bash 是常驻内核能力，不提供开关。

web_fetch 默认开启，无需搜索服务：HTML 经 mdream 转为 Markdown，保留链接、标题、表格与代码块；PDF 仍提取文本。超长内容可按 offset 续读，不执行网页 JavaScript。

**本地优先与安全边界**：数据保存在本机 SQLite；凭据经 Electron `safeStorage` 加密；renderer 不接触文件系统、数据库与凭据，一切经受控 IPC 通信。Agent 的 bash 与文件工具即本机权限，不设沙箱；Skill 启停只影响模型引导。远程项目只有被调用的那条命令会在远端执行，身份与权限由 ssh 决定；Dela 不保存远端密码；SSH 客户端优先用系统装的 OpenSSH，系统缺失时用随包分发的那份（`vendor/openssh`，BSD 许可，来源与版本见该目录 README）。远程项目还会在服务器上放一个 Dela 的常驻小程序（`~/.dela/helper/`，随包分发的 Go 静态二进制，`vendor/dela-helper`），它只绑定 `127.0.0.1`、每个请求都要 token、权限与那条 ssh 会话完全相同，连续 5 分钟收不到 Dela 的心跳就自己退出并结束它启动的命令；不装 systemd 服务、不写系统目录，删掉 `~/.dela/helper` 即彻底清理。

远程项目：工具（read/write/edit/grep/bash 等）与终端都在远端执行；目录树展开时按需读取远端目录，远端有变化（包括你在服务器上自己改的）会自动刷新已展开的那几层；点远端文件开只读预览（文本、Markdown、图片、PDF 与 Word/Excel），可以下载到本地、交给系统默认程序打开，也可以把本地文件上传到远端目录（右键菜单或直接拖进去）；打开远程项目后文件树顶栏有「预览远端端口」，可把远端正在跑的 dev server 经 SSH 隧道在本机浏览器打开。首次连一台服务器要几秒（要在远端放 helper 并握手），这段时间文件树显示「正在连接远端」；鼠标停在项目行或文件树标题上会显示连的是哪台机器、远端根在哪。helper 通道起不来（例如服务器禁执行、SELinux 拦截）时自动退回一次性 ssh，目录树会显示原因；此时端口预览与远端改动实时刷新不可用，其余功能照常。远端项目内仍不支持新建/编辑笔记，远端 PPTX 不支持内嵌预览（下载后用 PowerPoint 打开），打开着的预览不会自动跟随远端改动。

**试验功能**：在「设置 → 通用」管理，默认开启。总开关控制试验功能的可用性，关闭时隐藏全部子项；开启后可逐项管理子项（当前仅「课堂视频」）。课堂视频子项开启后侧栏出现「课堂视频」入口：登录交大视频后可按课程查看本学期课堂录像，在线播放（跳转、拖拽进度、音量、0.75–2x 倍速、多画面切换），也可下载原始 MP4（无需 FFmpeg），默认保存位置在课堂视频子项下的「视频默认下载目录」里指定（未设置时由系统保存对话框决定，每次下载都还能改）。播放经主进程代理（`dela-resource://vsjtu`），签名地址与校园会话不出主进程；临时取流失败会有限重试，持续断流后需点击重试。接口范围与验证状态见 [开发文档](docs/DEVELOPMENT.md#5-课堂视频试验)。

## 下载安装

从 [Releases](https://github.com/Chang-Yo/Dela/releases) 下载 Windows 安装包（公开镜像：[Chang-Yo/Dela_releases](https://github.com/Chang-Yo/Dela_releases)）：

| 平台    | 系统要求          | 产物               | 前置                                                                        |
| ------- | ----------------- | ------------------ | --------------------------------------------------------------------------- |
| Windows | Windows 10+ (x64) | NSIS `.exe` 安装包 | [Git for Windows](https://git-scm.com/download/win)（终端与 Bash 工具依赖） |

> 版本 1.0.x，安装包尚未签名，Windows 可能出现 SmartScreen 提示，选择「仍要运行」即可；商店版尚未上架。

> 2026-10 破坏性重构：首次启动检测到旧版本数据库时会自动备份为 `dela-legacy-backup.db` 后重建，旧聊天与笔记记录不迁移。

## 本地开发

需要 Node.js **24.21.0** 与 pnpm **12.3.4**（本机可用 `. ./scripts/use-local-tools.ps1` 启用仓库内固定版本）：

```sh
pnpm install
pnpm dev
```

| 命令                | 用途                                                  |
| ------------------- | ----------------------------------------------------- |
| `pnpm dev`          | 启动开发服务器和窗口，监听主进程/preload 变更         |
| `pnpm build`        | 类型检查与 main/preload/renderer 三入口生产构建       |
| `pnpm test`         | Vitest 单元测试                                       |
| `pnpm smoke`        | Electron 内 SQLite、React 渲染与 preload 隔离冒烟检查 |
| `pnpm package:dist` | 生成 Windows 安装包                                   |

环境搭建细节、冒烟测试与代码组织约定见 [开发文档](docs/DEVELOPMENT.md)；版本与发布流程同样在其中。

> 生成安装包会先构建商店更新用的原生模块（`pnpm build:native`），需要 Visual Studio 2022 的 C++ 生成工具与 Windows SDK；只跑 `pnpm dev`、`pnpm build`、`pnpm test` 不需要该工具链。

商店版可在「设置 → 通用 → 软件更新」检查、下载和安装新版（商店尚未上架，该入口对已安装的商店版生效）。安装前会保存所有已打开笔记、聊天文字草稿、邮件草稿与工作台布局；保存失败、Agent 仍在运行或聊天有未发送的暂存附件/图片时会暂停安装。「下次启动时提醒」只准备更新并提示，确认后才安装。更新会关闭应用，终端进程无法恢复。自建分发（NSIS）安装版与开发运行不支持应用内更新，该行只引导前往商店。

## 文档

| 文档                              | 内容                               | 读者           |
| --------------------------------- | ---------------------------------- | -------------- |
| [开发文档](docs/DEVELOPMENT.md)   | 架构、各子系统约定、构建与发布流程 | 贡献者（先读） |
| [更新日志](CHANGELOG.md)          | 按版本分节的变更记录               | 贡献者         |
| [贡献指南](CONTRIBUTING.md)       | 环境准备、提交规范与协作方式       | 贡献者         |
| [校园接口资料](docs/sjtu-apis.md) | Canvas 实测数据结构与交大接口索引  | 贡献者         |

## 作者

<img src="assets/credits/changyo/avatar.jpg" alt="ChangYo" width="80" style="border-radius: 50%">

**ChangYo**（[@Chang-Yo](https://github.com/Chang-Yo)）

## 许可

本项目以 GNU General Public License v3.0（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。代码与素材版权归原作者所有。
