# Dela

以 Project 为中心，连接交大校园信息和本地文件，提供轻量编辑与 Agent 协作的桌面工作台。

当前包含可交互的前端骨架、真实邮箱客户端和个人课表同步。左侧导航为首页、项目、资料、邮箱、课表（设置在侧边栏底部）。邮箱通过 IMAP（mail.sjtu.edu.cn:993）同步文件夹与邮件；凭据经 Electron `safeStorage` 加密保存在本机，邮件缓存于本地 SQLite。课表通过独立的 jAccount 登录窗口访问教学信息服务网，按学期缓存课程、教师、教室、校区、节次、教学周和可取得的学期日期；提供带时间轴的周视图、月视图、窄屏日程列表，并允许创建保存在本地 SQLite 的个人事件。资料页（Canvas）目前仍是明确标注的示例界面。窗口使用自定义标题栏，窗口操作经 preload 受控 IPC 执行；标题栏左侧依次为侧栏开关、后退/前进（按视图导航历史，与邮箱离开确认共用守卫）和帮助入口（链接后续接入）。主侧栏在宽屏经标题栏按钮完全折叠，窄屏改为左上角菜单按钮控制的覆盖式两级抽屉——邮箱视图首击直达邮箱功能层（文件夹、发送邮件、账号、退出登录），抽屉顶部「主菜单」返回导航层；邮箱、项目、资料页内的面板共用 48px 图标折叠栏、1px 拖拽拉伸线和 h-11 工具栏。

邮箱同步已用真实账号验证：文件夹列表、信头、摘要与正文（含纯 HTML 邮件）均正确拉取并缓存。发送邮件已支持加粗、斜体、HTTP(S) 超链接、正文图片和附件，并由用户在正常应用会话中完成手动发送；草稿只保留在当前编辑界面，离开前会提示抛弃。收到的附件可点击并在每次下载时显示系统保存位置对话框；后台定时轮询与多账号尚未实现。

课表的数据结构与会话接口已根据教学信息服务网现行实现及公开客户端交叉核对，周/月视图和本地事件已用脱敏数据完成宽、窄窗口渲染检查；本人账号的 jAccount 登录、真实课表返回以及响应中学期日期的实际格式仍待应用内实测，因此暂不将远端同步和真实日期映射标记为已验证完成。旧缓存没有学期日期时，周视图仍按教学周显示课程，月视图只显示本地事件。官方开放平台也提供 Education API，但需要本项目无法取得的应用 `client_id`，不作为实现路线。

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

邮箱按连接表单、文件夹栏、邮件列表、阅读面板、写邮件面板与 HTML 正文拆分组件，格式化和 HTML 文档处理各有独立 TS 文件。邮件优先读取 HTML，保留内联样式、样式表和表格，支持 CID 图片、适应宽度/原始布局、纯文本切换、远程图片开关和经系统浏览器打开的正文链接。文件夹栏记忆折叠状态，图标位置保持稳定；打开未读邮件后会同步更新列表与文件夹未读数，窄屏经两级抽屉访问文件夹与账号操作。

其余功能页沿用邮箱页的交互语言：拉伸线（`components/ui/resizer.tsx`，含 aria 值、方向键步进与外扩命中区）、折叠按钮（`panel-toggle.tsx`）与浏览器预览提示（`desktop-only-notice.tsx`）为共享组件。项目页拆分为侧栏、文档与 Agent 面板，左侧列表折叠为图标栏，Agent 面板可折叠并从文档标签行恢复；资料页拆分为列表与详情，列表改为固定宽度加拉伸线并可折叠；课表拆分为视图、周/月历、事件弹窗与格式化工具，工具栏对齐邮箱风格；设置页为分区导航加右侧详情（数据与服务/外观/关于），连接行使用图标，未实现的连接其配置按钮禁用，外观主题选择尚未实际生效。侧栏与各面板的折叠状态保存在 localStorage。

HTML 仍在无脚本、不同源的 sandbox iframe 内显示；远程图片沿用默认显示，可在单封邮件内关闭。外部样式表、字体、脚本和表单提交不加载；Outlook 专有 VML、不受支持或超出 2 MB 图片总预算的 CID 图片不能保证还原。旧缓存打开时尝试重新读取，失败则保留离线正文。数据库 v2 迁移前保留本地备份。附件按 MIME part 流式下载到用户每次选择的位置；旧缓存中没有 MIME part 的附件需重新同步后才可下载。

构建后可运行 `pnpm exec electron scripts/mail-smoke.cjs`，使用独立测试目录和脱敏数据检查 HTML 隔离、侧栏折叠、写邮件交互、未读数更新、请求竞态及窄屏布局；截图保存到被忽略的 `.tools/`。`pnpm test` 包含 MIME 正文选择与 CID 图片测试。本次自动化没有再次发送真实邮件。

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

## 自动发布安装包

使用以下命令修改 `package.json` 的应用版本，npm 负责 SemVer 校验与递增：

| 命令                                        | 示例（从 `0.1.0` 开始） |
| ------------------------------------------- | ----------------------- |
| `pnpm version:patch`                        | `0.1.1`                 |
| `pnpm version:minor`                        | `0.2.0`                 |
| `pnpm version:major`                        | `1.0.0`                 |
| `pnpm version:bump 0.2.0-beta.1`            | 指定预发布版本          |
| `pnpm version:bump prerelease --preid beta` | `0.1.1-beta.0`          |

命令不自动创建 Git commit/tag，也不推送或发布。当前单包 pnpm 锁文件不记录应用自身版本，升版无需修改锁文件。preload 在构建时从 `package.json` 内联版本，设置页与冒烟检查随之同步；升版后重新构建，开发模式需重启。检查完成后自行提交并推送对应 tag。

`.github/workflows/release.yml` 在推送 `v*` tag 时构建并发布 GitHub Release；tag 必须等于 `v` 加 `package.json` 的版本，例如 `v0.1.0`。先提交版本和代码，再执行 `git tag v0.1.0`、`git push origin v0.1.0`。含预发布后缀的版本（例如 `0.2.0-beta.1`）会发布为 prerelease。

工作流合入默认分支后，也可在 Actions → Release installers → Run workflow 中填写已有 tag。手动运行构建该 tag 指向的代码，使用相同版本校验和发布流程。已存在的 Release 不自动覆盖；发布失败若留下草稿，检查并删除该草稿后可重跑同一 tag。

| 平台    | 最低系统基线     | 架构                 | 产物               | GitHub runner                |
| ------- | ---------------- | -------------------- | ------------------ | ---------------------------- |
| Windows | Windows 10       | x64                  | NSIS `.exe` 安装包 | `windows-2022`               |
| macOS   | macOS 13 Ventura | x64、arm64，分别构建 | `.dmg`             | `macos-15-intel`、`macos-15` |
| Ubuntu  | Ubuntu 24.04 LTS | x64                  | `.AppImage`        | `ubuntu-24.04`               |

以上是项目选择的运行基线，不代表最低系统实机兼容性已验收；[Electron 44 要求 macOS 13 或以上](https://www.electronjs.org/blog/electron-44-0)，该下限也写入打包配置。Ubuntu AppImage 需 `libfuse2t64`，下载后赋予执行权限即可运行。GitHub runner 是构建环境，与最低运行系统不同。

四个构建任务均执行锁文件安装、类型检查与生产构建、单元测试、Electron 冒烟及打包目录启动检查，全部成功才统一创建草稿 Release、上传安装包并公开。Linux 冒烟通过 Xvfb 运行，并仅在临时 runner 中放开 AppArmor 对用户命名空间的限制以运行 Electron sandbox。安装包名包含版本、系统和架构，避免产物重名。仅发布任务具有 `contents: write`，使用内置 `GITHUB_TOKEN`，无需另配发布 token。

当前未配置 Windows 签名、Apple Developer ID 签名或公证，安装时可能遇到 SmartScreen/Gatekeeper 提示。工作流中的冒烟检查验证打包后程序及 SQLite/preload，不代替 NSIS 安装过程或 DMG/AppImage 最低系统实机验收；跨平台流水线结果需在 GitHub 首次运行后确认。
