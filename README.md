# Dela

以 Project 为中心，连接交大校园信息和本地文件，提供轻量编辑与 Agent 协作的桌面工作台。

当前包含可交互的前端骨架与首个真实业务功能：左侧导航为首页、项目、资料、邮箱、课表（设置在侧边栏底部）。邮箱是内置的邮件客户端（Outlook 式三栏布局）：在邮箱页输入交大邮箱地址与 jAccount 密码即可通过 IMAP（mail.sjtu.edu.cn:993）同步文件夹与邮件。凭据经 Electron `safeStorage` 加密保存在本机，邮件缓存于本地 SQLite；支持文件夹未读数、本地搜索、HTML 正文沙箱渲染、打开邮件自动标记已读。课表页与资料页（Canvas）目前仍是明确标注的示例界面。窗口使用自定义标题栏（隐藏系统标题栏，最小化/最大化/关闭由应用内渲染，经 preload 受控 IPC 执行），界面按组件与 feature 拆分为 CSS Modules。

邮箱同步已用真实账号验证：文件夹列表、信头、摘要与正文（含纯 HTML 邮件）均正确拉取并缓存。发送邮件（SMTP/nodemailer）、附件下载、后台定时轮询与多账号尚未实现。

基础工程已通过类型检查、格式检查、开发与生产启动以及 Windows 可执行目录的冒烟验证；尚未验证 NSIS 安装流程和其他平台。

## 开发基线

- 本地单用户，桌面优先；Electron 跨平台实现，Windows 首先验收。
- Electron 44.3.0、React 19.2.8、TypeScript 7.0.2、Vite 8.2.2、pnpm 12.3.4。
- 单仓库、单 package，不使用 monorepo；`pnpm-workspace.yaml` 仅保存 pnpm 12 项目设置，无子包。直接 Vite 构建，electron-builder 打包。
- 项目关联校园资料和本地目录；轻量 Markdown 编辑，复杂工程用 VS Code 等专业软件打开。

## 文档

- [技术规划书](docs/technical-plan.md)：固定技术栈、目录架构、界面 ASCII 草图、执行约束和阶段验收。
- [前端重构计划](docs/frontend-refactor-plan.md)：当前原型的组件与样式拆分步骤。
- [背景与已知条件](background.md)
- [校园接口参考索引](knowledge/SJTU_API_References.md)

接口索引是参考资料，不能视为本人账号已验证的能力清单。其中申请 jAccount client_id 的路线不适用于本项目。密钥与个人数据不得提交或打入安装包。

## 本地开发

邮箱按连接表单、文件夹栏、邮件列表、阅读面板与 HTML 正文拆分组件，格式化和 HTML 文档处理各有独立 TS 文件。邮件优先读取 HTML，保留内联样式、样式表和表格，支持 CID 图片、适应宽度/原始布局、纯文本切换、远程图片开关和经系统浏览器打开的正文链接。文件夹栏记忆折叠状态，图标位置保持稳定；窄屏显示带名称的文件夹标签。

HTML 仍在无脚本、不同源的 sandbox iframe 内显示；远程图片沿用默认显示，可在单封邮件内关闭。外部样式表、字体、脚本和表单提交不加载；Outlook 专有 VML、不受支持或超出 2 MB 图片总预算的 CID 图片不能保证还原。旧缓存打开时尝试重新读取，失败则保留离线正文。数据库 v2 迁移前保留本地备份。附件仍仅列出信息，未提供下载。

构建后可运行 `pnpm exec electron scripts/mail-smoke.cjs`，使用独立测试目录和脱敏数据检查 HTML 隔离、侧栏折叠、请求竞态及窄屏布局；截图保存到被忽略的 `.tools/`。`pnpm test` 包含 MIME 正文选择与 CID 图片测试。本次未重新登录真实邮箱验收各类邮件模板。

安装 Node.js **24.21.0** 和 pnpm **12.3.4**。本机已将两者安装在被忽略的 `.tools/` 中，不改变全局环境；在 PowerShell 中先启用：

```powershell
. ./scripts/use-local-tools.ps1
node --version
pnpm --version
```

新克隆仓库不包含 `.tools/`，需自行安装上述版本；也可将官方 Windows Node ZIP 解压到 `.tools/node-v24.21.0-win-x64`，再使用该 Node 的 npm 执行 `npm install --prefix .tools/package-manager pnpm@12.3.4`。

```sh
pnpm install
pnpm dev
```

安装会通过 Electron 提供的 `install-electron` 命令下载运行时。pnpm 仅允许明确的依赖脚本；better-sqlite3 13 使用随包提供的预编译模块，当前关闭源码重建。新增原生依赖时重新评估此设置。

| 命令                                | 用途                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                          | 启动开发服务器和窗口，监听主进程/preload 变更                      |
| `pnpm build`                        | 类型检查与三个入口的生产构建                                       |
| `pnpm start`                        | 启动已构建产物                                                     |
| `pnpm format` / `pnpm format:check` | 格式化 / 检查格式                                                  |
| `pnpm test`                         | Vitest；包含 MIME 正文选择、CID 图片与失败回退测试                 |
| `pnpm smoke`                        | 构建后验证 Electron 内 SQLite、React 渲染和 preload 隔离，自动退出 |
| `pnpm package:dir`                  | 生成未安装的可执行目录                                             |
| `pnpm package:dist`                 | 生成当前平台安装包                                                 |

Windows 打包目录可运行 `dist/win-unpacked/Dela.exe --smoke-test` 做相同检查。当前没有命令行凭据导入功能，启动不会读取仓库 `.env`；邮箱账号只能在应用内配置。

打包入口限定为 `out/` 和包元数据（构建器另收集生产依赖）。`knowledge/` 默认忽略，仅公开接口索引进入 Git；仓库文档、个人凭据与 `.tools/` 均不属于安装资源。
