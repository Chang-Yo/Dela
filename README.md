<div align="center">

<picture>
  <img src="assets/Dela_white_bg.png" alt="Dela" width="160">
</picture>

</div>

---

<div align="center">

_The world keeps changing. Dela stays with you._

</div>

---

> [!IMPORTANT]
> 下载、安装或使用 Dela，即视为你已阅读并同意本项目的[使用条款](docs/terms.md)与[隐私条款](docs/privacy.md)。
> 如果你不同意其中部分内容，可以跳过对应服务的配置、不提供该项凭据，从而仅使用其余功能；如果你不同意全部条款，请停止使用并卸载本软件。

Dela 是一款专门面向 SJTUer 的 Agent 产品。

Dela 的内核基于 Pi 构建，所有的校园服务功能都通过交大公开 API 和学校服务器交互。所有个人信息数据全部经过加密存储在本地。

## 功能概览

**水源社区与课堂视频下载属于试验功能，可在“设置 > 通用 > 试验功能”中开关；侧栏入口可在“设置 > 通用 > 导航入口”中隐藏。**

### 校园信息服务

- **Canvas 课程资料快捷预览**： 利用access token同步课程资料，快捷查看和切换不同课件，还支持一键下载；「添加到项目」可将课件引用放入所选本地项目的根目录
- **校园邮箱**： 支持交大邮箱和任意第三方 IMAP/SMTP 邮箱（需自填服务器）；可以快速同步邮件，还支持加粗、斜体等富文本写信、附件收发和保留正文换行的本地草稿
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

- **md笔记编辑**：笔记就是 `.md` 文件，即时渲染编辑（光标所在行显示原文），支持数学公式（含中文）与 mermaid 流程图；保存时原样写回，不改换行符与格式
- **文件编辑**：任意文本文件都能打开编辑（包括 `.env`、`Makefile`、无后缀日志），按内容而不是扩展名识别；1 MB 以上只读预览
- **内置终端**：用户可以直接在应用打开内置终端（Git Bash），如果是 remote project 则默认为 ssh

## 技术栈

![Electron](https://img.shields.io/badge/Electron-v44-47848F?style=for-the-badge&logo=electron&logoColor=white&labelColor=1F2328)
![React](https://img.shields.io/badge/React-v19-087EA4?style=for-the-badge&logo=react&logoColor=white&labelColor=1F2328)
![TypeScript](https://img.shields.io/badge/TypeScript-v7-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=1F2328)
![Vite](https://img.shields.io/badge/Vite-v8-646CFF?style=for-the-badge&logo=vite&logoColor=white&labelColor=1F2328)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white&labelColor=1F2328)
![Pi](https://img.shields.io/badge/Pi-v1.1-1E293B?style=for-the-badge&logoColor=white&labelColor=1F2328)
![Go](https://img.shields.io/badge/Go-v1.22-00ADD8?style=for-the-badge&logo=go&logoColor=white&labelColor=1F2328)

## 下载安装

从 [Dela官网](https://dela.changyo.me) 或 [GitHub Releases](https://github.com/Chang-Yo/Dela/releases/latest) 下载对应平台的安装包。

## 本地开发

需要 Node.js **24.22.1** 与 pnpm **12.3.4**（本机可用 `. ./scripts/use-local-tools.ps1` 启用仓库内固定版本）：

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

| 文档                               | 内容                               | 读者           |
| ---------------------------------- | ---------------------------------- | -------------- |
| [开发文档](docs/DEVELOPMENT.md)    | 架构、各子系统约定、构建与发布流程 | 贡献者（先读） |
| [使用条款](docs/terms.md)          | 软件性质、责任划分与免责范围       | 使用者         |
| [隐私条款](docs/privacy.md)        | 数据存放位置与联网去向             | 使用者         |
| [更新日志](CHANGELOG.md)           | 按版本分节的变更记录               | 贡献者         |
| [贡献指南](CONTRIBUTING.md)        | 环境准备、提交规范与协作方式       | 贡献者         |
| [功能边界](docs/what-we-not-do.md) | 明确不做与需先讨论的功能           | 贡献者         |
| [安全策略](SECURITY.md)            | 漏洞报告渠道、支持范围与安全边界   | 使用者、贡献者 |
| [校园接口资料](docs/sjtu-apis.md)  | Canvas 实测数据结构与交大接口索引  | 贡献者         |

## 贡献者

![Contributors](https://contrib.rocks/image?repo=Chang-Yo/Dela 'Contributors')

## 许可

本项目以 GNU General Public License v3.0（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。代码与素材版权归原作者所有。

## 赞助鸣谢

<table>
  <tr>
    <td width="80" align="center" valign="middle">
      <img src="assets/sponsors/FRAMENEO_logo_black.png" width="44" alt="FRAMENEO logo">
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/"><strong>FRAMENEO</strong></a><br>
      Provides CDN delivery for MAD Toolbox, reducing origin bandwidth usage for downloads and updates.
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/">FRAMENEO Website</a>
    </td>
  </tr>
</table>
