# Dela 技术规划

日期：2026-10-08。状态：基座已切换到 Pi Coding Agent SDK，不向下兼容，旧数据不迁移；用户最新明确决定优先于本文。

## 产品

本地个人 Agent：内核是通用 agent，领域知识外置为 skills 与 dela 命令，工作台 GUI 是壳。单用户、单应用、单 package；仅 Windows（跨平台明确放弃）；安装包暂用 NSIS（exe），MSIX 与微软商店分发是后续计划；无服务端，检索 API 由用户自配。

## 分层架构（建设顺序＝依赖方向，自下而上）

**1. 内核＝Pi Coding Agent（冻结）**：`@earendil-works/pi-coding-agent` SDK 的 `createAgentSession` 就是 agent 内核。会话树（JSONL）、多轮工具上下文、自动压缩、重试、AGENTS.md 上下文文件、skills 发现与渐进加载都由 Pi 承担，Dela 不另写执行循环、上下文组装或压缩。

| 工具                       | 来源                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| read / write / edit / bash | Pi 内置，cwd＝会话所属项目目录；bash 用 Git Bash（与终端同源），不可关闭       |
| grep / find / ls           | Pi 内置；首次使用时 Pi 自动下载 rg/fd 到 `userData/pi/bin`（待验证离线体验）   |
| web_search / web_fetch     | Dela 自定义工具，默认关闭；搜索服务在「网络」域注册（Brave / Google / 自定义） |
| MCP 工具                   | Dela 连接 stdio 服务器后作为自定义工具注入                                     |

**2. dela 命令**：领域能力的 CLI 门面。应用生命周期内一个本机 HTTP 桥（127.0.0.1 随机端口 + Bearer token），经 Pi 的 `shellCommandPrefix` 注入 bash，终端同样可用；`dela help` 列命令与 JSON Schema。

**3. skills**：纯文档领域知识，Pi 按 Agent Skills 规范发现；Dela 把五个内置领域 skill 写进 `~/.dela/skills` 并作为附加 skill 目录交给 Pi，设置页的禁用名单经 `skillsOverride` 过滤。

**4. GUI**：标签工作台（聊天/笔记/预览/终端），经 IPC 消费同一套领域实现。UI 组件统一以 vendored beautiful-ui 为基座，被替代的自研 UI 必须清理。

## 会话与上下文

- 项目＝目录：项目是 `kind='project'` 的 workspace 条目，身份是条目 UUID，目录是其 `local_path`。会话 cwd 恒为该目录（通用会话为工作区根）；目录缺失时报错，不静默换目录。
- 会话的完整记录是 Pi JSONL（`userData/pi/sessions`），SQLite `sessions` 只是索引（项目归属、标题、置顶、归档、文件路径）。renderer 看到的 `WorkspaceChat` 是 Pi 消息的投影（`main/agent/session.ts`）。
- 会话归属在创建时确定，ChatTab 从会话快照取 projectId/cwd，不取当前工作台。
- 上下文是 pull 模型：@ 引用是会话 cwd 下文件的绝对路径，模型自主 read；附件文本与图片随用户消息进入 Pi 会话。
- 系统提示＝Pi 默认提示 + Dela 追加段（dela 命令说明、项目名与目录、用户自定义指令）。
- 编辑重发在 Pi 会话树上分支，旧分支保留在 JSONL。

## 安全

诚实而非表演：给了 bash 就不设业务级守卫、无沙箱、无越权校验；skill 启停是引导层。保留进程级基本边界：renderer 隔离、凭据不进 renderer、preload 有限暴露。Pi 的全局目录放在 `userData/pi`，与用户自己的 `~/.pi` 隔离；模型密钥只在主进程内注册给 Pi 的运行时，不写入 `auth.json`。

## 持久化

schema v2：v1→v2 只重建 `sessions`，删除 `runs` 与 `projects`（会话不迁移）；更早的旧世界库整库备份后重建。表：workspace_settings、workspace_entries、sessions（索引）、领域缓存（mail 三表、timetable 两表、calendar_events、canvas 两表、shuiyuan_topics、todo_items、notifications 两表）。笔记即磁盘文件。

## 终端

与 Bash 同源：Git Bash + node-pty（ConPTY）+ xterm.js，实现参考 VS Code / Hyper；dela 桥函数同样注入项目终端。本机须装 Git for Windows，缺失时明确报错，不回退 PowerShell。

## 工程与交付

Node 24.21.0、pnpm 12.3.4（先执行 `. ./scripts/use-local-tools.ps1` 等价前置）；其余版本以 package.json 与锁文件为准，精确依赖。检查链：format + lint + typecheck + test + build + smoke。CI 仅 Windows；electron-builder 产出 NSIS 安装包；better-sqlite3 与 node-pty 必须在打包产物中实测加载。密钥、个人数据与本地工具不进 Git 与安装包。

## 本次删除清单（2026-10-08 基座重构）

自研执行循环（core/run、pi 流包装、预算与修剪）、上下文组装与压缩（context/）、九个自研内核工具（tools/kernel/，含 ReadSkills 与 Bash 长任务让出）、Run 状态表与 projects 档案表、session/manager。

## 文档

每篇 ≤2000 字：technical-plan（本文）、development、release、devlog（短条目）、background；必要时分文件，不写长文。
