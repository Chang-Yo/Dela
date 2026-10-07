# 开发指南

面向想在本地构建和修改 Dela 的贡献者。产品与技术决策见[技术规划书](technical-plan.md)，发布流程见[发布指南](release.md)，日常编码约束见根目录 [AGENTS.md](../AGENTS.md)。

## 工具链

| 工具    | 固定版本 |
| ------- | -------- |
| Node.js | 24.21.0  |
| pnpm    | 12.3.4   |

- 版本固定在 `package.json` 的 `engines` 与 `packageManager`；不要使用全局其他版本。
- 作者本机把两者安装在被 Git 忽略的 `.tools/` 中，PowerShell 里执行以下命令为当前会话启用：

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
- 原生依赖（`better-sqlite3`、`node-pty`、`@napi-rs/canvas`）使用随包预编译产物，关闭源码重建（`npmRebuild: false`）；`@napi-rs/canvas` 在 `vite.main.config.ts` 标记 external 并加入 electron-builder `asarUnpack`。
- `@earendil-works/*`（pi-agent-core / pi-ai / pi-mcp）在 main 构建中以正则保持 external、随 node_modules 打包进 asar；pi 系为纯 ESM 包，main 的 CJS 产物经 `agent/core/pi-load.ts` 动态 `import()` 加载。
- 运行时依赖 Git for Windows：内核 Bash 工具与内置终端统一使用 Git Bash（`locateBash()` 探测安装位置，缺失时明确报错）。
- 开发模式下每次启动都会完整重播首启引导；URL 加 `?smoke-test=1` 可短路引导，供自动化使用。

## 常用命令

| 命令                                            | 用途                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                                      | 启动开发服务器和窗口，监听主进程/preload 变更                    |
| `pnpm build`                                    | 类型检查（三组 tsconfig）与 main/preload/renderer 三入口生产构建 |
| `pnpm start`                                    | 启动已构建产物                                                   |
| `pnpm check`                                    | 格式检查 + Oxlint + 构建 + 单元测试的组合检查                    |
| `pnpm format` / `pnpm format:check`             | Prettier 格式化 / 检查                                           |
| `pnpm lint`                                     | Oxlint（TypeScript 正确性、未使用代码、React Hook 规则）         |
| `pnpm test`                                     | Vitest 单元测试                                                  |
| `pnpm smoke`                                    | Electron 冒烟：SQLite、React 渲染与 preload 隔离，自动退出       |
| `pnpm smoke:workspace`                          | 工作区回归                                                       |
| `pnpm smoke:pdf`                                | PDF.js 阅读器回归                                                |
| `pnpm smoke:shuiyuan`                           | 水源社区回归                                                     |
| `pnpm exec electron scripts/terminal-smoke.cjs` | 内置终端回归（Git Bash、多会话、选取复制）                       |
| `pnpm package:dir`                              | 生成未安装的可执行目录                                           |
| `pnpm package:dist`                             | 生成 Windows 安装包                                              |

打包目录可运行 `dist/win-unpacked/Dela.exe --smoke-test` 做与 `pnpm smoke` 相同的检查；终端冒烟加 `dist/win-unpacked/resources/app.asar` 参数可验证包内资源。所有冒烟脚本使用独立测试目录与脱敏数据，不发送真实请求。

应用启动不读取仓库 `.env`，凭据只能在应用内配置；文档、个人凭据与 `.tools/` 均不属于安装资源（打包白名单限定 `out/` 与包元数据）。

## 仓库组织

单仓库、单 `package.json`，三个进程分别构建：

- `src/main/` — 主进程，按业务域分目录（`mail/`、`canvas/`、`timetable/`、`workspace/`、`shuiyuan/` 等，每域 `api.ts` + `ipc.ts`）。`agent/` 为 Agent 核心：`core/`（Pi 执行循环与模型服务）、`session/`（会话与 Run 持久化）、`context/`（上下文组装与压缩）、`tools/kernel/`（九个内核工具）、`tools/commands.ts`（dela 命令桥）、`capabilities/`（Skills 与 MCP）。根级有数据库、凭据、终端等共用模块。
- `src/preload/` — contextBridge：`index.ts` 聚合入口 + 分域文件，只暴露受控 API。
- `src/renderer/` — React 界面：`app/`（装配与视图路由）、`workbench/`（标签工作台与布局树）、`content/`（chat / note / preview / terminal 标签内容）、`navigation/`、`sessions/`、`workspace/`（镜像与草稿）、`features/`（mail / timetable / shuiyuan / todo / notifications / onboarding / search / settings 整页视图）；共享组件在 `components/ui/`，样式用 Tailwind v4 + 语义 token。
- `src/shared/` — 进程间共享的 IPC 契约与纯函数（`api.ts` 聚合 re-export）。
- 测试放在各级 `test/` 子目录，`scripts/` 存放开发服务器与冒烟脚本。

边界约定：renderer 不导入 main、不访问凭据和数据库；Vite 不自动加载仓库 `.env`；不引入 Manager/Service/Factory 等抽象层级，出现真实重复前不做提取。

## 提交前检查

改动后至少运行与其相关的检查（完整约束见 [AGENTS.md](../AGENTS.md)）：

```sh
pnpm format:check
pnpm lint
pnpm build
pnpm test
```

涉及构建、原生依赖或打包时，另验证 `pnpm smoke` 与打包目录启动。重要功能改动同步更新 `docs/devlog.md`，面向使用者的变化更新 README。
