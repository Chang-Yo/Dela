# 开发指南

面向想在本地构建和修改 Dela 的贡献者。产品与技术决策见[技术规划书](technical-plan.md)，发布流程见[发布指南](release.md)，日常编码约束见根目录 [AGENTS.md](../AGENTS.md)。

在线赞助尚处规划阶段。ECS 与 Dela 两端开发须先阅读[在线赞助协作计划书](sponsorship-plan.md)，确认相同契约修订及交接记录后再联调；该服务拟独立部署，不改变本仓库单应用、单 package 的约束。

## 工具链

| 工具    | 固定版本 |
| ------- | -------- |
| Node.js | 24.21.0  |
| pnpm    | 12.3.4   |

- 版本固定在 `package.json` 的 `engines` 与 `packageManager`；不要使用全局其他版本。
- 作者本机把两者安装在被 Git 忽略的 `.tools/` 中，PowerShell 里执行以下命令为当前会话启用，不改变全局环境：

  ```powershell
  . ./scripts/use-local-tools.ps1
  ```

- 新克隆的仓库不包含 `.tools/`，需自行安装上述版本。也可以将官方 Windows Node ZIP 解压到 `.tools/node-v24.21.0-win-x64`，再用该 Node 自带的 npm 执行 `npm install --prefix .tools/package-manager pnpm@12.3.4`。

## 启动

```sh
pnpm install
pnpm dev
```

- `pnpm install` 会通过 Electron 提供的 `install-electron` 命令下载运行时。
- pnpm 仅允许明确的依赖脚本；原生依赖（`better-sqlite3`、`@napi-rs/canvas`）均使用随包提供的预编译模块，当前关闭源码重建（`npmRebuild: false`）。`@napi-rs/canvas` 需在 `vite.main.config.ts` 标记 external 并加入 electron-builder `asarUnpack`；pnpm 不会自动安装传递平台包，非当前平台的出包需在对应平台环境补齐（见 devlog 2026-09-18 第五轮）。
- `@earendil-works/*` 三依赖（pi-agent-core / pi-ai / pi-mcp）在 `vite.main.config.ts` 以 `/^@earendil-works\//` 正则保持 external、随 node_modules 打包进 asar——rolldown 的字符串 external 不匹配 `pi-ai/api/...` 等子路径导入，必须用正则；pi 系为纯 ESM 包，main 的 CJS 产物经 `agent/core/pi-load.ts` 动态 `import()` 加载（静态 require 会崩）。pnpm 12 `allowBuilds`（`pnpm-workspace.yaml`）把 `@google/genai`、`esbuild`、`protobufjs` 三个 pi 传递依赖的安装脚本显式置 false（见 devlog 2026-09-29 第十轮）。
- 开发模式（Vite dev 构建）下每次启动都会完整重播首启引导，便于查看；正式构建只在首次启动播放。URL 加 `?smoke-test=1` 可短路引导直接渲染主界面，供自动化使用。

## 常用命令

| 命令                                | 用途                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                          | 启动开发服务器和窗口，监听主进程/preload 变更                    |
| `pnpm build`                        | 类型检查（三组 tsconfig）与 main/preload/renderer 三入口生产构建 |
| `pnpm start`                        | 启动已构建产物                                                   |
| `pnpm check`                        | 格式检查 + Oxlint + 构建 + 单元测试的组合检查                    |
| `pnpm format` / `pnpm format:check` | Prettier 格式化 / 检查                                           |
| `pnpm lint`                         | Oxlint（TypeScript 正确性、未使用代码、React Hook 规则）         |
| `pnpm test`                         | Vitest 单元测试                                                  |
| `pnpm smoke`                        | Electron 冒烟：SQLite、React 渲染与 preload 隔离，自动退出       |
| `pnpm smoke:workspace`              | 工作区回归（见下）                                               |
| `pnpm smoke:pdf`                    | PDF.js 阅读器回归（见下）                                        |
| `pnpm smoke:shuiyuan`               | 水源社区回归（见下）                                             |
| `pnpm package:dir`                  | 生成未安装的可执行目录                                           |
| `pnpm package:dist`                 | 生成当前平台安装包                                               |

打包目录可运行 `dist/win-unpacked/Dela.exe --smoke-test` 做与 `pnpm smoke` 相同的检查。

内置终端新增精确依赖 node-pty 1.1.0、xterm 6.0.0、FitAddon 0.11.0。pnpm 允许 node-pty 安装脚本使用平台预编译产物，main 构建将其 external，打包解包整个 node-pty 目录（包含原生模块、ConPTY DLL 与辅助脚本）。其他平台缺少预编译产物时需按 [node-pty 官方说明](https://github.com/microsoft/node-pty)准备原生编译环境。

Windows 内置终端检查：`pnpm exec electron scripts/terminal-smoke.cjs`。打包后使用 `pnpm exec electron scripts/terminal-smoke.cjs dist/win-unpacked/resources/app.asar` 加载包内 main/preload/renderer 和原生依赖。脚本使用独立 userData 与 documents 目录，覆盖标题栏打开、真实 xterm 键盘输入、中文/特殊字符项目 cwd、多会话、切换重挂载、主题及关闭清理；只截取静态界面，不检测动画。

脚本保留宿主原始 PSModulePath，验证产品代码处理 PowerShell 7 → Electron → Windows PowerShell 的模块路径继承，必须确认 PSReadLine 已加载。另覆盖方向键/退格编辑、鼠标拖动选取、右键复制、复制/粘贴按钮及 Alt＋单击定位；剪贴板使用页面内隔离夹具，系统剪贴板权限及实际内容仍由用户实机审阅。

应用启动不读取仓库 `.env`，邮箱/Canvas/模型等凭据只能在应用内配置；仓库文档、个人凭据与 `.tools/` 均不属于安装资源（打包白名单限定 `out/` 与包元数据）。

## 冒烟与回归脚本

所有脚本使用独立测试目录与脱敏数据，不需要个人 token，不会发送真实请求：

| 脚本                                        | 覆盖范围                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm smoke`                                | 生产构建产物在 Electron 内的 SQLite 读写、React 渲染与 preload 隔离                                                                                          |
| `pnpm smoke:workspace`                      | 工作区全链路：分页与失败缓存、共享来源引用、文件夹转项目、移动循环校验、外部编辑冲突、删除关联保留原件、标签/滚动/会话恢复、模型上下文范围、磁盘目录树与迁移 |
| `pnpm exec electron scripts/mail-smoke.cjs` | 邮箱 UI：HTML 隔离、侧栏折叠、写邮件交互、未读数、请求竞态、窄屏布局与两级抽屉                                                                               |
| `pnpm smoke:pdf`                            | PDF.js 集成：合成 300 页文档的多标签、位置恢复、分段读取、画布内存上限；可传入 `app.asar` 路径验证包内资源                                                   |
| `pnpm smoke:shuiyuan`                       | 水源：信息流、分页、阅读推入、楼层 iframe 隔离、通知已读、搜索                                                                                               |
| `node scripts/campus-session-smoke.mjs`     | 校园会话加密快照：三个进程间的 Cookie 恢复、保留与断开清除                                                                                                   |

## 仓库组织

单仓库、单 `package.json`，三个进程分别构建（完整目录约定与设计理由见[技术规划书](technical-plan.md)第 3 节）：

- `src/main/` — 主进程，按业务域分目录：`mail/`、`canvas/`、`timetable/`、`workspace/`、`shuiyuan/`、`settings/`，另有根级的数据库、凭据、搜索与通知等共用模块；每个业务域以 `api.ts`（业务入口）+ `ipc.ts`（通道注册）组织。`agent/` 为 Agent 核心，分 `core/`（Pi 执行循环与模型服务）、`session/`（会话与 Run 持久化及推送）、`context/`（上下文组装与压缩）、`tools/`（8 领域工具目录 + registry）、`capabilities/`（MCP 与 Skills）五个子目录。
- `src/preload/` — contextBridge：`index.ts` 聚合入口 + 按命名空间拆分的分域文件，只暴露受控 API。
- `src/renderer/` — React 界面：`app/`（应用装配与视图路由）、`workbench/`（统一标签工作台与布局树）、`content/`（chat / note / preview / review 标签内容）、`navigation/`（项目会话导航与文件/资料树）、`sessions/` 与 `workspace/`（会话/Run 镜像与工作区数据、草稿）、`features/`（mail / timetable / shuiyuan / todo / notifications / onboarding / search / settings 整页业务视图）；`components/ui/` 放共享组件，样式用 Tailwind v4 + `styles/globals.css` 中的语义 token。
- `src/shared/` — 进程间共享的 IPC 契约与纯函数，按领域拆分文件（`api.ts` 聚合 re-export 保持 import 面稳定）。
- 主进程测试集中放在各级目录的 `test/` 子目录（例如 `src/main/agent/session/test/`、`src/main/agent/tools/todo/test/`），`scripts/` 存放开发服务器与冒烟脚本。

边界约定：renderer 不导入 main、不访问凭据和数据库；Vite 不自动加载仓库 `.env`；不引入 Manager/Service/Factory 等抽象层级，出现真实重复前不做提取。

## 提交前检查

改动后至少运行与其相关的检查（完整约束见 [AGENTS.md](../AGENTS.md)）：

```sh
pnpm format:check
pnpm lint
pnpm build
pnpm test
```

涉及构建、原生依赖或打包时，另验证 `pnpm smoke` 与打包目录启动。重要功能改动同步更新 `docs/devlog.md`（开发记录），面向使用者的变化更新 README。
