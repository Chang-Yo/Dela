# 开发指南

面向想在本地构建和修改 Dela 的贡献者。产品与技术决策见[技术规划书](technical-plan.md)，发布流程见[发布指南](release.md)，日常编码约束见根目录 [AGENTS.md](../AGENTS.md)。

## 工具链

| 工具    | 固定版本 | 何时需要                              |
| ------- | -------- | ------------------------------------- |
| Node.js | 24.21.0  | 总是                                  |
| pnpm    | 12.3.4   | 总是                                  |
| Go      | 1.22+    | 只在改远端 helper 时（本仓库用 1.27） |

- 版本固定在 `package.json` 的 `engines` 与 `packageManager`；不要使用全局其他版本。
- 作者本机把两者安装在被 Git 忽略的 `.tools/` 中，PowerShell 里执行以下命令为当前会话启用：

  ```powershell
  . ./scripts/use-local-tools.ps1
  ```

- 新克隆的仓库不包含 `.tools/`，需自行安装上述版本。也可以将官方 Windows Node ZIP 解压到 `.tools/node-v24.21.0-win-x64`，再用该 Node 自带的 npm 执行 `npm install --prefix .tools/package-manager pnpm@12.3.4`。
- 远端 helper（`helper/`）的静态二进制已入库在 `vendor/dela-helper/`，日常开发不需要 Go；改了 `helper/` 下的 Go 代码后执行 `pnpm build:helper --all` 重建 amd64 与 arm64 两个产物并一并提交——只重建 amd64 会让仓库里的 arm64 停在旧版（发布时 CI 会覆盖，但本地对 arm64 远端的测试用的是旧版）。构建细节与协议见 [helper/README.md](../helper/README.md)。

## 启动

```sh
pnpm install
pnpm dev
```

- `pnpm install` 会通过 Electron 提供的 `install-electron` 命令下载运行时。
- 原生依赖（`better-sqlite3`、`node-pty`、`@napi-rs/canvas`）使用随包预编译产物，关闭源码重建（`npmRebuild: false`）；`@napi-rs/canvas` 在 `vite.main.config.ts` 标记 external 并加入 electron-builder `asarUnpack`。
- `@earendil-works/*`（pi-coding-agent / pi-agent-core / pi-ai / pi-mcp）在 main 构建中以正则保持 external、随 node_modules 打包进 asar；pi 系为纯 ESM 包，main 的 CJS 产物经 `agent/pi.ts` 动态 `import()` 加载。
- 运行时依赖 Git for Windows：内核 Bash 工具与内置终端统一使用 Git Bash（`locateBash()` 探测安装位置，缺失时明确报错）。
- 开发模式下每次启动都会完整重播首启引导；URL 加 `?smoke-test=1` 可短路引导，供自动化使用。

## 常用命令

| 命令                                            | 用途                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                                      | 启动开发服务器和窗口，监听主进程/preload 变更                      |
| `pnpm build`                                    | 类型检查（三组 tsconfig）与 main/preload/renderer 三入口生产构建   |
| `pnpm start`                                    | 启动已构建产物                                                     |
| `pnpm check`                                    | 格式检查 + Oxlint + 构建 + 单元测试的组合检查                      |
| `pnpm format` / `pnpm format:check`             | Prettier 格式化 / 检查                                             |
| `pnpm lint`                                     | Oxlint（TypeScript 正确性、未使用代码、React Hook 规则）           |
| `pnpm test`                                     | Vitest 单元测试（不含真机远程套件）                                |
| `pnpm test:remote`                              | 真机远程回归：需 `DELA_REMOTE_HOST`（如 `root@1.2.3.4`），CI 不跑  |
| `pnpm smoke`                                    | Electron 冒烟：SQLite、React 渲染与 preload 隔离，自动退出         |
| `pnpm smoke:workspace`                          | 工作区回归                                                         |
| `pnpm smoke:pdf`                                | PDF.js 阅读器回归                                                  |
| `pnpm smoke:shuiyuan`                           | 水源社区回归                                                       |
| `pnpm exec electron scripts/terminal-smoke.cjs` | 内置终端回归（Git Bash、多会话、选取复制）                         |
| `pnpm exec electron scripts/agent-smoke.cjs`    | Agent 基座回归：需 `DELA_SMOKE_BASE_URL/API_KEY/MODEL`，发真实请求 |
| `pnpm package:dir`                              | 生成未安装的可执行目录                                             |
| `pnpm package:dist`                             | 生成 Windows 安装包                                                |

打包目录可运行 `dist/win-unpacked/Dela.exe --smoke-test` 做与 `pnpm smoke` 相同的检查；终端冒烟加 `dist/win-unpacked/resources/app.asar` 参数可验证包内资源。冒烟脚本使用独立测试目录与脱敏数据；除 agent-smoke 外不发送真实请求。

应用启动不读取仓库 `.env`，凭据只能在应用内配置；文档、个人凭据与 `.tools/` 均不属于安装资源（打包白名单限定 `out/` 与包元数据）。

## 仓库组织

单仓库、单 `package.json`，三个进程分别构建：

- `src/main/` — 主进程，按业务域分目录（`mail/`、`canvas/`、`timetable/`、`workspace/`、`shuiyuan/` 等，每域 `api.ts` + `ipc.ts`）。`agent/` 为 Agent 基座：`pi.ts`（Pi SDK 接线与模型注册）、`session.ts`（会话索引、事件投影与 ask）、`environment.ts`（追加提示、dela 桥、skills、MCP 与联网工具）、`commands.ts` + `domain/`（dela 命令）、`providers.ts`、`skills.ts`、`mcp.ts`、`tools.ts`（内置能力开关）。根级有数据库、凭据、终端等共用模块。
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

改动远端（`src/main/remotes/`、`helper/`、连接与上下文镜像）时，另用 `pnpm test:remote` 对着真机跑一遍：那批用例需要 `DELA_REMOTE_HOST`，默认套件与 CI 都会跳过它们（`vitest.remote.config.ts`）。

涉及构建、原生依赖或打包时，另验证 `pnpm smoke` 与打包目录启动。重要功能改动同步更新 `docs/devlog.md`，面向使用者的变化更新 README。
