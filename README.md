<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/Dela_black_bg.png">
  <img src="assets/Dela_white_bg.png" alt="Dela" width="160">
</picture>

![Platform](https://img.shields.io/badge/platform-Windows-blue)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

---

_The world keeps changing. Dela stays with you._

---

Dela 是一款专门面向 SJTUer 的 Agent 产品。

Dela 的内核基于 Pi 构建，所有的校园服务功能都通过交大公开 API 和学校服务器交互。所有个人信息数据全部经过加密存储在本地。

## 功能概览

**部分功能默认关闭，请前往“设置 > 通用 > 试验功能”打开相关功能！**

### 校园信息服务

- **Canvas 课程资料快捷预览**： 利用access token同步课程资料，快捷查看和切换不同课件，还支持一键下载和链接至项目文件夹
- **校园邮箱**： 支持交大邮箱和任意第三方 IMAP/SMTP 邮箱（需自填服务器）；可以快速同步邮件，还支持富文本写信，附件收发和本地草稿
- **课堂视频回看**：支持在应用内会看
- **课表日历**：通过教学信息网获取个人课表，月视图支持“滑拽式”创建事件，支持和TODO双向互通
- **水源社区（beta）**：通过Discourse User API Key 正式授权，为您提供沉浸式的阅读体验，并且可以接入 Agent
- **全局搜索**：搜索内容跨项目、会话、邮件、课程资料和设置
- **TODO**：支持 Canvas 课程作业完成状态提醒，支持写入课表日历

### Agent 功能

Dela Harness基于 Pi 构建，支持接入skills, mcps，通过**内置的校园skills**可以快速获取到用户的校园信息数据，比如读取Canvas课程状态，获取Canvas课程资料，读取个人所有邮件，获取课表，获取水源咨询等等，详情可以直接阅读应用内的内置校园skills类。

除此之外，Dela还具有较强的 Coding 能力，内置 9 大 tools，还有**独创的基于helper建立长连接隧道的远程项目功能**，胜任大部分生产力场景。

- **常驻工具**：`read`, `write`, `edit`, `bash`. 始终保持开启
- **文件检索工具**：`find`, `grep`, `ls`
- **网页搜索工具**：`web_search`(默认关闭，需自备API KEY), `web_fetch`（默认开启，免费）

**remote project**: 通过上传编译好的 helper 文件至服务器，Dela 可以与远端建立隧道实现长连接，并通过 helper 的代理来实现对服务器上下文的获取，环境理解以及文件的读写。并且通过自动端口转发，可以**本地访问远程的启动的网页**。_只要能够连上ssh，就可以像本地一样操作读写！_

### 工作台功能

- **md笔记编辑**：所见即所得的md笔记编辑，支持 math 公式解析和 mermaid 流程图
- **代码文件编辑**：支持绝大部分主流代码文件的高亮显示与编辑功能
- **内置终端**：用户可以直接在应用打开内置终端（Git Bash），如果是 remote project 则默认为 ssh

## 下载安装

从 [CDN 下载页](https://openlist.frameneo.com/@s/Dela_latest_release) 或 [GitHub Releases](https://github.com/Chang-Yo/Dela_releases/releases/latest) 下载 Windows x64 的 NSIS（`.exe`）安装包。

在 设置 › 通用 › 软件更新 中检查、下载和安装。旧版需手动覆盖安装一次带新更新机制的版本。确认安装后，Dela 保存工作区并退出，安装向导会显示进度，点击“显示细节”可展开安装过程；终端任务会结束。下载时，进度条左侧显示速度，右侧显示百分比。安装完成后保留“运行 Dela”选项并点击“完成”，重新打开时会提示当前版本。差分下载不可用时退回完整下载，新版安装向导及两版覆盖升级仍需实机验证。

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

## 赞助鸣谢

<table>
  <tr>
    <td width="90" align="center" valign="middle">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="assets/sponsors/FRAMENEO_logo_white.png">
        <img src="assets/sponsors/FRAMENEO_logo_black.png" width="48" alt="FRAMENEO logo">
      </picture>
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/"><strong>FRAMENEO</strong></a><br>
      为 Dela 的软件包分发提供免费的高速 CDN 服务
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/">Website</a>
    </td>
  </tr>
</table>
