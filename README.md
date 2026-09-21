<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/Dela_black_bg.png">
  <img src="assets/Dela_white_bg.png" alt="Dela" width="420">
</picture>

**以 Project 为中心，连接交大校园信息与本地文件的桌面工作台**

轻量编辑 · Agent 协作 · 本地优先

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#下载安装)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

<!-- 截图占位：建议在 assets/screenshots/ 放置 2–4 张主界面截图（首页 / 项目工作区 / 课表 / 水源），插入此处效果最佳 -->

Dela 是为上海交通大学学生打造的本地优先桌面工作台：把 Canvas 课程资料、校园邮箱、课表、水源社区聚合到一个应用里，再以「项目」为单位组织资料、笔记与 AI 助手对话。所有数据保存在本机（SQLite + 磁盘文件），凭据经系统密钥加密，界面行为向 VS Code 与 ChatGPT 等成熟产品的交互习惯看齐。

> _The world keeps changing. Dela stays with you._

Dela 以单实例运行：重复启动快捷方式会打开已有主窗口。关闭窗口后驻留系统托盘；左键单击托盘图标打开主窗口，右键单击显示菜单，可从菜单退出应用。

## 功能一览

|     | 功能                   | 说明                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🗂️  | **项目工作区**         | VS Code 式多标签、预览标签、可拆分编辑器组与拖拽整理；Markdown 笔记（CodeMirror 6 + GitHub 配色高亮）、PDF.js 阅读器、HTML/图片/文本预览；目录对应真实磁盘文件夹，笔记随手可被外部编辑器打开                                                                                                                                       |
| 🎓  | **Canvas 课程资料**    | 使用个人 Access Token 同步课程、目录、模块、作业与附件，按学期组织；文件按需缓存、内嵌阅读，可一键加入任意项目，同一来源多处引用不复制原件                                                                                                                                                                                         |
| 📧  | **校园邮箱**           | IMAP 同步文件夹与邮件，HTML 邮件在无脚本沙箱中安全渲染；富文本写信、附件收发、本地草稿箱与回收站，阅读体验向桌面邮件客户端看齐                                                                                                                                                                                                     |
| 📅  | **个人课表**           | 经 jAccount 登录教学信息服务网同步课表；周时间轴 / 月视图、时间重叠课程并排分列、拖拽跨天创建个人任务，八色低饱和配色按课程自动分配                                                                                                                                                                                                |
| 💧  | **水源社区**           | 基于 Discourse User API Key 的正式授权流；信息流浏览、楼层阅读与楼层级回复、私信、收藏、通知，站内图片经认证代理加载；帖子可挂进项目或作为 AI 对话引用                                                                                                                                                                             |
| 🤖  | **AI 助手**            | 接入任意 OpenAI 兼容提供商（致远一号、DeepSeek、MiniMax、智谱、自定义）；查找资料/邮件/作业/日程、整理文件、编辑笔记、起草邮件等工具调用；支持联网搜索与网页阅读、PDF 文本与页图像提取（扫描件/图表，需视觉模型）、DOCX/PPTX 文本提取、图文混排输入、思考流展示与动作时间线；回答支持 LaTeX 公式、mermaid 图表渲染与代码块一键复制 |
| 🔍  | **全局搜索与通知中心** | `Ctrl/⌘K` 跨项目、会话、邮件与课程资料搜索；邮件与水源通知聚合呈现，支持免打扰暂停                                                                                                                                                                                                                                                 |
| 🚀  | **首启引导**           | 首次使用时显示开场动画与五步配置向导（邮箱 → 教学信息服务网 → Canvas → 水源 → 模型服务）；更新、重启直接跳过                                                                                                                                                                                                                                       |

**本地优先与安全边界**：数据与索引保存在本机 SQLite，凭据经 Electron `safeStorage` 加密；邮件 HTML 与社区内容在禁止脚本的沙箱 iframe 中渲染；渲染进程不接触文件系统、数据库与凭据，一切经受控 IPC 通信。发送给模型服务商的内容范围在界面上始终可见。

## 下载安装

从 [Releases](https://github.com/Chang-Yo/Dela/releases) 下载对应平台安装包（公开镜像：[Chang-Yo/Dela_releases](https://github.com/Chang-Yo/Dela_releases)）：

| 平台    | 系统要求                              | 产物               |
| ------- | ------------------------------------- | ------------------ |
| Windows | Windows 10+ (x64)                     | NSIS `.exe` 安装包 |
| macOS   | macOS 13+ (Intel / Apple Silicon)     | `.dmg`             |
| Linux   | Ubuntu 24.04+ (x64，需 `libfuse2t64`) | `.AppImage`        |

> 项目处于早期开发阶段（v0.x），安装包尚未做代码签名，Windows 可能出现 SmartScreen、macOS 可能出现 Gatekeeper 提示，选择「仍要运行」即可。

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
| `pnpm package:dist` | 生成当前平台安装包                                    |

环境搭建细节、冒烟测试与代码组织约定见 [开发指南](docs/development.md)；版本与发布流程见 [发布指南](docs/release.md)。

## 文档

| 文档                                                                                                    | 内容                                                 | 读者           |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------- |
| [技术规划书](docs/technical-plan.md)                                                                    | 产品定位、技术栈、进程边界、持久化与 Agent 架构契约  | 贡献者（先读） |
| [开发指南](docs/development.md)                                                                         | 工具链、常用命令、冒烟测试与仓库约定                 | 贡献者         |
| [发布指南](docs/release.md)                                                                             | CI 检查、版本管理、安装包发布与公开镜像              | 维护者         |
| [开发记录](docs/devlog.md)                                                                              | 按日期的功能演进、设计裁决与验证边界                 | 贡献者         |
| [前端风格审查](docs/frontend-style-audit.md)                                                            | renderer 风格漂移清单与整改优先级（2026-09-17 快照） | 贡献者         |
| [Canvas API 探测记录](docs/canvas-api-findings.md) / [水源 API 探测记录](docs/shuiyuan-api-findings.md) | 校园接口的实测数据结构与边界                         | 贡献者         |
| [背景与已知条件](docs/background.md)                                                                    | 项目背景与固定约束                                   | 维护者         |
| [校园接口参考索引](knowledge/SJTU_API_References.md)                                                    | 交大开放 API 与社区项目全景索引                      | 贡献者         |

## 作者

<img src="assets/author_avatar_square.jpg" alt="ChangYo" width="80" style="border-radius: 50%">

**ChangYo**（[@Chang-Yo](https://github.com/Chang-Yo)）

## 许可

本项目尚未设置开源许可证（UNLICENSED），代码与素材版权归原作者所有。
