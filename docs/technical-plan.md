# Dela 技术规划

日期：2026-10-07。状态：破坏性重构的施工蓝图，不向下兼容，旧数据不迁移；用户最新明确决定优先于本文。

## 产品

本地个人 Agent：内核是通用 agent，领域知识外置为 skills 与 dela 命令，工作台 GUI 是壳。单用户、单应用、单 package；仅 Windows（跨平台明确放弃）；安装包暂用 NSIS（exe），MSIX 与微软商店分发是后续计划；无服务端，检索 API 由用户自配。

## 分层架构（建设顺序＝依赖方向，自下而上）

**1. 内核（冻结）**：9 个无领域工具。

| 工具                 | 说明                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Read / Write / Edit  | 文件读取、写入与局部修改；任意路径，无目录守卫                                                    |
| Grep / Glob          | 内容搜索与文件名模式匹配，ripgrep 式契约                                                          |
| Bash                 | 统一 Git Bash；长任务让出/续读/取消；pwd 默认项目目录                                             |
| WebFetch / WebSearch | 默认关闭；搜索服务由用户在内置能力「网络」域注册（Brave / Google / 自定义 JSON 端点），无内置服务 |
| ReadSkills           | 读 SKILL.md 与目录内支持文件；承载 skill 启停语义                                                 |

**2. dela 命令**：领域能力的 CLI 门面。canvas/mail/shuiyuan/timetable/todo/workspace 动词经 shell 内本机 HTTP 桥（127.0.0.1 随机端口 + Bearer token）回调应用内实现，复用缓存、登录与凭据；`dela help` 列命令与 JSON Schema。

**3. skills**：纯文档领域知识。shuiyuan / Canvas / Mail / TODO / curriculum 五域，正文教 agent 何时、如何组合命令与文件；跨域关联（如 Canvas 课件挂进项目）是资料层行为。系统提示只注入启用项索引。

**4. GUI**：标签工作台（聊天/笔记/预览/终端），经 IPC 消费同一套领域实现，不另写业务。UI 组件统一以 vendored beautiful-ui（`@/components/ui/beautifului/`，见其 README 的适配清单）为基座：聊天界面已整体迁移（ThinkingState 工作过程、CodeBlock 工具卡、PromptBar 视觉的 composer 与菜单、IconButton/Button atoms），其余界面渐进替换；被替代的自研 UI 必须清理（AGENTS.md 规则）。

## 会话与上下文

- 上下文是 pull 模型：@ 引用只是路径/标识文本，agent 自主用 Read 或 dela 命令读取；不存在类型化资源引用系统。
- Project session 注入项目上下文（名称、目标、背景）；非项目 session 即网页式 chat（随聊）。
- 资料页 titlebar 的 message-circle-plus 入口可在当前资料上下文起 chat，@ 可指定文件。
- chat composer 不出现项目选择。

## 安全

诚实而非表演：给了 Bash 就不设业务级守卫、无沙箱、无越权校验；skill 启停是引导层（禁用＝不进索引＋ReadSkills 拒绝），不做路径硬墙。保留进程级基本边界：renderer 隔离、凭据不进 renderer、preload 有限暴露。

## 持久化

schema v1 重开；启动检测到旧版本库即废弃重建（可留一次性备份）。表：workspace_settings、projects、sessions（含 archived/pinned）、runs、workspace_entries、领域缓存（mail 三表、timetable 两表、calendar_events、canvas 两表、shuiyuan_topics、todo_items、notifications 两表）。笔记即磁盘文件：无 workspace_notes、无 note_versions、无 UUID 笔记身份。

## 终端

与 Bash 同源：Git Bash + node-pty（ConPTY）+ xterm.js，实现参考 VS Code / Hyper；dela 桥函数同样注入项目终端。本机须装 Git for Windows，缺失时明确报错，不回退 PowerShell。

## 工程与交付

Node 24.21.0、pnpm 12.3.4（先执行 `. ./scripts/use-local-tools.ps1` 等价前置）；其余版本以 package.json 与锁文件为准，精确依赖。检查链：format + lint + typecheck + test + build + smoke。CI 仅 Windows；electron-builder 产出 NSIS 安装包；better-sqlite3 与 node-pty 必须在打包产物中实测加载。密钥、个人数据与本地工具不进 Git 与安装包。

## 本次删除清单

VSJTU 课堂视频、在线赞助（关于页恢复 credits.ts 硬编码名单）、fetch_page / read_resource / write_note / edit_note / read_skill / read_skill_file / shell_poll / shell_cancel 及全部旧别名、SearXNG 硬编码、PowerShell 分支、macOS/Linux 打包与 CI 矩阵。

## 文档

每篇 ≤2000 字：technical-plan（本文）、development、release、devlog（短条目）、background；必要时分文件，不写长文。
