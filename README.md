<div align="center">

<picture>
  <img src="assets/Dela_white_bg.png" alt="Dela" width="160">
</picture>

</div>

---

<div align="center">

**An Agent Harness designed for SJTUer**
</div>

<div align="center">

_The world keeps changing. Dela stays with you._

</div>

---

> [!IMPORTANT]
> 下载、安装或使用 Dela，即视为你已阅读并同意本项目的[使用条款](docs/terms.md)与[隐私条款](docs/privacy.md)。
> 如果你不同意其中部分内容，可以跳过对应服务的配置、不提供该项凭据，从而仅使用其余功能；如果你不同意全部条款，请停止使用并卸载本软件。
>
> Demo 演示与下载见 [Dela 官网](https://dela.changyo.me)。

Dela 是一款专门面向 SJTUer 的 Agent 产品。

Dela 的内核基于 Pi 构建，所有的校园服务功能都通过交大公开 API 和学校服务器交互。凭据经系统钥匙串加密后保存在本机，其余数据保存在本地，不上传服务器。

## 功能概览

**水源社区与课堂视频下载属于试验功能，可在 “设置 > 通用 > 试验功能” 中开关；所有侧栏功能入口可在 “设置 > 通用 > 导航入口” 中隐藏。**

### 校园信息服务

- **Canvas 课程资料快捷预览**：利用 access token 同步课程资料，快捷查看和切换不同课件，还支持一键批量下载；「添加到项目」可将课件引用放入所选本地项目的根目录，支持批量导出课件
- **校园邮箱**：支持交大邮箱和任意第三方 IMAP/SMTP 邮箱的收信与写信功能，还可以本地保存草稿
- **课堂视频回看**：已连接 Canvas 时与「资料」共用课程列表，通过各课程的官方视频入口打开录像；支持语音识别文稿跳转和录音稿导出，还支持将课堂视频全量缓存到本地；重新打开时从上次播放位置继续
- **课表日历**：通过教学信息网获取个人课表，月视图支持“滑拽式”创建事件，支持和 TODO 双向互通
- **水源社区（beta）**：通过 Discourse User API Key 安全授权，为您提供水源的另一种阅读体验，并且可以接入 Agent 被调用
- **全局搜索**：搜索内容跨项目、会话、邮件、课程资料和设置
- **TODO**：支持 Canvas 课程作业完成状态提醒，支持写入课表日历；可以在月历图和列表两种视图中切换

### Agent 功能

Dela Harness 基于 Pi 构建，可以作为一款通用 agent 产品使用，并且 Dela 在 Coding 领域进行了特别加强。

Dela 支持导入第三方 skills 和接入 MCPs，通过**内置的校园 skills** 可以快速获取到用户的校园信息数据，比如读取 Canvas 课程状态，获取 Canvas 课程资料，读取个人所有邮件，获取课表，获取水源讯息、按时间范围读取课堂语音文稿与批量保存文稿等等，详情可以直接阅读应用内的内置校园 skills。

Dela 提供自定义的 `web_search` 工具接入（如 DeepSeek、Brave、Google，默认关闭，需自备 API KEY），还提供免费的 `web_fetch` 工具（默认开启）。

此外 Dela 还兼容大部分 Pi Packages 生态。可以安装 Pi 社区的 package（扩展、skills、提示模板），来源支持 npm、git 与本地目录；扩展与 Dela 同权限运行，安装前请确认来源可信。

Dela 的 **remote project** 可以把远端服务器目录登记为项目：通过 SSH 建立连接后，Dela 上传 helper runtime 维持本机与服务器之间的稳定通道，Agent 的读写与命令直接在服务器上执行，远端目录变化实时同步到文件树。远端文件可在应用内预览与下载。

### 工作台功能

- **Markdown 笔记编辑**：支持对 `.md` 文件即时渲染编辑，支持数学公式与 mermaid 流程图
- **文件编辑**：任意文本文件都能打开编辑（包括 `.env`、`Makefile`、无后缀日志），按内容而不是扩展名识别；1 MB 以上只读预览
- **内置终端**：用户可以直接在应用打开内置终端（Git Bash），如果是 remote project 则默认为 ssh，默认继承项目目录作为启动路径

## 技术栈

![Electron](https://img.shields.io/badge/Electron-v44-47848F?style=for-the-badge&logo=electron&logoColor=white&labelColor=1F2328)
![React](https://img.shields.io/badge/React-v19-087EA4?style=for-the-badge&logo=react&logoColor=white&labelColor=1F2328)
![TypeScript](https://img.shields.io/badge/TypeScript-v7-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=1F2328)
![Vite](https://img.shields.io/badge/Vite-v8-646CFF?style=for-the-badge&logo=vite&logoColor=white&labelColor=1F2328)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white&labelColor=1F2328)
![Pi](https://img.shields.io/badge/Pi-v1.1-1E293B?style=for-the-badge&logoColor=white&labelColor=1F2328)
![Go](https://img.shields.io/badge/Go-v1.22-00ADD8?style=for-the-badge&logo=go&logoColor=white&labelColor=1F2328)

## 下载安装

从 [Dela 官网](https://dela.changyo.me) 或 [GitHub Releases](https://github.com/Chang-Yo/Dela/releases/latest) 下载对应平台的安装包。Dela 支持应用内更新。

## 本地开发

推荐使用 [`.node-version`](.node-version) 指定的 Node.js 与 [`package.json`](package.json) 的 `packageManager` 指定的 pnpm，兼容范围见 `engines`（本机可用 `. ./scripts/use-local-tools.ps1` 启用仓库内固定版本）：

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

您可以前往 “设置 > 关于” 页面为作者提供赞助 🙏

<table>
  <tr>
    <td width="80" align="center" valign="middle">
      <img src="assets/sponsors/FRAMENEO_logo_black.png" width="44" alt="FRAMENEO logo">
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/"><strong>FRAMENEO</strong></a><br>
      为 Dela 的软件包分发提供免费的高速 CDN 服务。
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/">FRAMENEO Website</a>
    </td>
  </tr>
</table>
