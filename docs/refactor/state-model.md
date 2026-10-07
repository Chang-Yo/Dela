# 状态模型与迁移设计

日期：2026-09-29。状态：已于 2026-09-29 随阶段二实施（数据库 v13 起）；本文保留为模型设计契约的记录。

本文落实 [Agent 与工作区重构计划](../agent-workspace-plan.md) §3（共同的数据与状态边界）、§5.1（Pi Core 与 Dela 会话的衔接）、§7（迁移要求）中的数据模型部分，给出 Project / Session / Run / 文档版本的目标模型、SQLite DDL 草案与从现有实现的迁移步骤。

标注约定：**【事实】** 为对当前代码（2026-09-29，user_version=12）核查得出的结论；**【设计】** 为本文建议的方案；**【待裁决】** 为需要架构师拍板的选择点（汇总见 §6）。本文只描述数据与状态边界，不含 UI 与模块拆分方案。

## 1. 现状梳理

### 1.1 scope 的实际取值

**【事实】** `scope` 是一个字符串，同时充当四种角色：会话分组键（`chat_sessions.scope`）、执行互斥与当前会话指针的内存键、视图状态键（`workspace_settings` 的 `view:<scope>`）、renderer localStorage 键（`dela.editor.layout.<scope>`、`dela.chat.drafts` 的子键）。

全仓取值共四类（`src/renderer/features/projects/ProjectView.tsx`、`HomeView.tsx`、`App.tsx`、`src/main/search.ts`）：

| 取值                             | 来源                                         | 含义                                  |
| -------------------------------- | -------------------------------------------- | ------------------------------------- |
| `'home'`                         | `HomeView` 固定传入                          | 首页聊天                              |
| `'sources'`                      | `ProjectView mode='sources'`                 | 资料页聊天                            |
| `'projects'`                     | `ProjectView mode='project'` 且无有效 rootId | 项目列表/工作区根视图的聊天           |
| `<workspace_entries.id>`（UUID） | `ProjectView` 打开具体项目时传入 rootId      | 该项目（`kind='project'` 条目）的聊天 |

IPC 层对 scope 仅做 `z.string().max(100)` 校验（`src/main/agent/ipc.ts`），不校验取值或条目存在性。`search.ts` 用 `LEFT JOIN workspace_entries AS project ON project.id=chat_sessions.scope AND project.kind='project'` 求项目名，非 UUID 的三个值硬编码映射为「首页/资料/项目」，其余为「项目对话」。`App.tsx` 深链跳转时要求 scope ∈ {home, sources, projects} ∪ 现存 project 条目，否则提示「这个会话所属的项目已不存在」——即**已存在 scope 指向已删除项目的孤儿会话**，且删除项目条目（`removeWorkspaceEntry`）不清理 `chat_sessions`。

### 1.2 chat_sessions 表

**【事实】** 迁移 v9 引入（`src/main/database.ts`），当前表结构：

```sql
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '新对话',
  messages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_chat_sessions_scope ON chat_sessions(scope, updated_at DESC);
```

- `messages` 是 JSON 文本数组，每次持久化整篇 `UPDATE`（`agent/api.ts` 的 `persistSession`）。
- 历史先例：v9 迁移已把旧版 `workspace_settings` 的 `chat:<scope>` JSON 升级为本表（`INSERT ... SELECT` + `DELETE`，见 database.ts 迁移数组第 9 项），是本次迁移可直接参照的写法。
- 空会话（`messages='[]'`）会被「新对话」直接删除，不进入历史。
- 与项目无外键关系，仅靠 scope 字符串与 `workspace_entries.id` 巧合相等。

### 1.3 消息 JSON 结构（逐字段）

**【事实】** 来源 `src/shared/api.ts` 的 `WorkspaceChat.messages` 与 `src/main/agent/api.ts` 的写入路径。

用户消息：

| 字段          | 类型              | 说明                                                            |
| ------------- | ----------------- | --------------------------------------------------------------- |
| `role`        | `'user'`          |                                                                 |
| `content`     | `string`          | 剥离内联图片 token 后的正文                                     |
| `sources`     | `{key, title}[]?` | @ 引用的资料（key 为 workspace entry id 或 `source:` 前缀引用） |
| `images`      | `{id, name}[]?`   | 内联图片；id 对应 `userData/chat-media/<UUID>.<ext>` 落盘文件   |
| `attachments` | `{name}[]?`       | 文本附件名；内容已进入当轮上下文，文件不保留                    |

助手消息：

| 字段                       | 类型                 | 说明                                                  |
| -------------------------- | -------------------- | ----------------------------------------------------- |
| `role`                     | `'assistant'`        |                                                       |
| `content`                  | `string`             | 所有 `text` part 以 `\n\n` 拼接（供复制/存笔记/回灌） |
| `toolResults`              | `AgentToolResult[]?` | 逐项工具结果（时间线用）                              |
| `parts`                    | `part[]?`            | 按发生顺序交错保存正文/思考/工具组（见下）            |
| `startedAt` / `finishedAt` | `number?`            | epoch 毫秒；运行中或被中断时缺 `finishedAt`           |
| `interrupted`              | `boolean?`           | 错误中断，追加中断文案                                |
| `stopped`                  | `boolean?`           | 用户主动停止，保留已生成内容                          |

`parts` 元素：`{type:'text', text}`、`{type:'reasoning', text, startedAt?, finishedAt?}`（思考过程，不回灌模型、不进复制）、`{type:'tools', results: AgentToolResult[]}`。

`AgentToolResult`：`id`（模型侧 tool_call id）、`name`、`input`（解析后的参数对象）、`output?`（运行中占位无值）、`startedAt?`、`finishedAt?`。

持久化消息与发给模型的消息是两套形状：模型侧为 `system`（固定提示词）+ 最近 12 条 `(role, content)`（`slice(-12)`，不回灌 reasoning、不重放历史工具结果）+ 本轮 user 多模态 contentParts。PDF 页图像以 base64 不落库，只存 `pageImages` 元数据。

### 1.4 project 在数据层的现状（关键事实）

**【事实】** **没有独立的 project 表。project 是 `workspace_entries` 中 `kind='project'` 的一种行**，与 folder/note/source/local/imported 同表。`workspace_entries`（迁移 v5）：

```sql
CREATE TABLE workspace_entries (
  id TEXT PRIMARY KEY,                -- UUID
  parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- 'folder' | 'project' | 'note' | 'source' | 'local' | 'imported'
  source_id TEXT,                     -- kind='source' 时的 Canvas/水源引用
  note_id TEXT,                       -- kind='note' 时关联 workspace_notes
  local_path TEXT,                    -- 受管磁盘路径
  updated_at TEXT NOT NULL
);
CREATE TABLE workspace_notes (id TEXT PRIMARY KEY, path TEXT NOT NULL);
```

- project 的全部元数据只有 `name`；受管目录在 `<工作目录>/workspace/` 下由 `managedPath` 分配并记入 `local_path`。
- `updateWorkspaceEntry` 允许 folder ↔ project **原地互转**（只改 kind，目录与子树不动），这是现有用户行为。
- project **没有**背景、目标、外部工作目录、能力配置等任何档案字段；工具（`create_entry`/`search_workspace` 等）也不知道「当前项目」，只按 parentId 操作全局条目树。
- 项目聊天 scope = project 条目 id；聊天与项目之间没有任何数据库层约束。
- 技术规划 §5.1 中的「Project：名称、目标、背景、可选工作目录」尚未在数据层落地。

### 1.5 会话与运行的内存态

**【事实】**（`src/main/agent/api.ts`）：

- `activeSession: Map<scope, string | null>`——每个 scope 一个「当前打开会话」指针，进程内存，重启即失（视为新对话闲置态）。
- `asking: Map<scope, {controller: AbortController, tool?}>`——**按 scope 互斥**：同一 scope 同时至多一个运行；`cancelAsk` abort；删除正在运行的当前会话先 abort（避免僵尸忙碌态）；`asking` 期间不能 `openChat` 切到其他会话。
- （2026-10-07 更新：`workspace:chat-update` 已删除，TimetableView 改订阅 `session:on-run-event` 终态刷新课表。）原文：`publishChat` 经 `workspace:chat-update` 按 scope 广播给所有订阅 WebContents；`TimetableView` 也订阅它，在聊天不运行时刷新课表（因为工具可能写了日历）——目前没有独立的资源变化通知。
- **没有 Run 持久实体**：一次执行的进度内嵌在助手消息 JSON（parts 增量 + `persistSession` 节流/即时落库），进程退出后没有任何「中断」标记，重启后无识别与恢复入口（技术规划 §7 已注明「重启后不自动恢复执行；完整任务状态机暂缓」）。

### 1.6 文档与版本现状

**【事实】**：

- 笔记正文 = 磁盘 Markdown 文件；`workspace_notes` 只存路径。
- `revision` 即时计算不落库：笔记为 `sha256(正文)`；本地/导入文件为 `${mtimeMs}-${size}`。
- `saveWorkspaceNote(id, text, revision)` 整篇替换：读盘 hash ≠ 传入 revision 即报「已在外部修改」；否则 tmp+rename 原子写、更新 `updated_at`、返回新 hash。`write_note` 工具同路径。**没有历史版本、没有差异、没有恢复依据**。
- renderer `useWorkspace.drafts` 按 entry id 单例共享：同一文档在两个编辑组打开时共享 text/saved/revision；CodeMirror 会话键 `${scope}:${group}` 使各组有独立撤销/光标。即「多入口共享正文与版本、隔离视图位置」在现状中已部分成立，但键里的 scope 是项目级而非文档级分组。

### 1.7 视图状态现状

**【事实】** 视图状态分裂在两处、且都按 scope 键控：

- DB `workspace_settings` `view:<scope>`：`{tabs, active, expanded, scroll}`（tabs 为 entry id / `source:` 引用）。
- renderer localStorage：`dela.editor.layout.<scope>`（双编辑组 split/orientation/ratio/focus/groups）、`dela.chat.drafts`（按 scope 的输入草稿）、`dela.workspace.agentOpen/agentWidth/sidebarWidth/collapsed`、`dela.workspace.project`（最后打开的项目）。

## 2. 目标模型

### 2.1 Project

**【设计】** Project = 工作主题与执行上下文（计划 §3、§5.1），分两层表达：

1. **挂载点**：保留 `workspace_entries` 的 `kind='project'` 行，继续承担名称、目录、树位置、来源关联——现有全部资源组织逻辑（`checkParent`、`managedPath`、`link_source`、`copy_file_to_project`）都以 `parent_id` 为中心，不动这层可以把重构面收敛在 Agent 与会话侧。
2. **档案表 `projects`**（新增）：以同一 id 1:1 挂靠，存放执行上下文所需字段：

| 字段                        | 类型                             | 说明                                                                                          |
| --------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `id`                        | TEXT PK = `workspace_entries.id` | `REFERENCES workspace_entries(id) ON DELETE CASCADE`                                          |
| `background`                | TEXT                             | 项目背景（注入会话上下文）                                                                    |
| `goal`                      | TEXT                             | 默认目标                                                                                      |
| `workdir`                   | TEXT NULL                        | 可选外部工作目录（Lab 代码等原目录路径关联；与受管 `local_path` 区分）                        |
| `capabilities`              | TEXT                             | 项目级能力启停/资源范围覆盖，JSON；MCP/Skills 落地（阶段四）前为 `'{}'`，不为空置字段预建结构 |
| `created_at` / `updated_at` | TEXT                             |                                                                                               |

folder → project 原地转换时补插一行 `projects`；project → folder 时删除。Run 与工具从此拿到「项目身份 + 背景 + 资源范围」，不再依赖提示词转述（计划 §5.2「宿主在执行时检查资源范围」）。

理由与备选（独立 projects 表 / 直接给 workspace_entries 加列）见 **待裁决 1**。

### 2.2 Session

**【设计】** Session 归属一个项目或为通用会话（`project_id` 可空），保存独立历史。新表 `sessions` 取代 `chat_sessions`：

| 字段                        | 类型      | 说明                                                      |
| --------------------------- | --------- | --------------------------------------------------------- |
| `id`                        | TEXT PK   | UUID，沿用现有会话 id                                     |
| `project_id`                | TEXT NULL | `REFERENCES projects(id)`；NULL = 通用聊天                |
| `title`                     | TEXT      | 沿用                                                      |
| `messages`                  | TEXT      | 持久消息 JSON（结构沿用 §1.3，向后兼容旧会话）            |
| `summary`                   | TEXT NULL | 上下文压缩摘要（阶段二启用；含覆盖范围与资源引用的 JSON） |
| `archived_at`               | TEXT NULL | 会话归档（计划 §5.1「继续、中断与归档」）                 |
| `created_at` / `updated_at` | TEXT      | 沿用                                                      |

消息是否拆为行表见 **待裁决 2**（推荐首阶段保留 JSON 列）。

**与 Pi 会话状态的衔接边界（只保留一套持久事实来源）**：

- `sessions.messages`（Dela DB）是**唯一**持久事实来源；Pi Core 会话对象是 Run 生命周期内的内存执行态，可随时从持久历史重建、不落盘、不拥有独立历史。
- 统一 Dela 的 `Session → Run → 执行项（工具步骤）` 三层语义，不暴露 Pi 对 turn 的定义。
- 每个 session 同时至多一个活跃 Run（沿用单会话串行）；Run 结束/中断后 Pi 实例可丢弃，「继续」= 新 Run 从持久历史 + 摘要重建上下文。

### 2.3 Run

**【设计】** Run = 一次用户请求及其后续执行，携带会话、项目身份与取消信号（计划 §5.1）。新表 `runs`：

| 字段                      | 类型             | 说明                                                                                                       |
| ------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`                      | TEXT PK          | UUID                                                                                                       |
| `session_id`              | TEXT NOT NULL    | `REFERENCES sessions(id) ON DELETE CASCADE`                                                                |
| `project_id`              | TEXT NULL        | 创建时的项目快照，便于项目级任务列表查询；`ON DELETE SET NULL`                                             |
| `status`                  | TEXT NOT NULL    | 状态机见下                                                                                                 |
| `request`                 | TEXT             | 请求摘要 JSON（文本前缀、引用/附件名、发起入口）；不含正文全文                                             |
| `steps`                   | TEXT             | 轻量步骤索引 JSON：`{id, name, status, startedAt, finishedAt}[]`；input/output 全文留在消息 JSON，避免双写 |
| `error`                   | TEXT NULL        | failed/interrupted 的原因                                                                                  |
| `started_at` / `ended_at` | TEXT / TEXT NULL |                                                                                                            |

状态机：

```text
                    resume(用户补充后放行)
          ┌──────────── waiting_input ◄────────────┐
          │                                        │
pending ──► running ──► completed                  │
   │         │   ▲                                 │
   │         │   └─────────────────────────────────┘
   │         ├──► stopped       （用户主动取消，保留部分内容）
   │         ├──► failed        （错误/超时/限流不可恢复）
   │         └──► interrupted   （应用退出或崩溃）
   └──► failed                  （发送前校验失败：未配置模型、引用读取失败等）
```

- `pending`：Run 落库后、首次模型请求前（输入解析、引用读取、附件消费）。现有实现里这段失败发生在持久化之前（消息不上屏、草稿恢复），目标模型显式化为状态。
- `waiting_input`：计划 §4.1 要求会话能呈现「等待输入」；是否在首轮接入（Pi 的运行中输入）见 **待裁决 8**。状态先入模型，不实现时不进入该态。
- 步数上限（现状 MAX_ROUNDS=12）归为 `completed`（带总结文案），与现状一致。

**取消信号**：内存 `Map<runId, AbortController>`（取代按 scope 的 `asking`）；互斥粒度从「每 scope 一个」改为「每 session 一个活跃 Run」。

**应用退出后的中断识别与恢复语义**：

- Run 进入 `running`/`waiting_input` 即落库；步骤与流式内容按现状节奏写入消息 JSON。
- 启动序列早期（迁移完成后、IPC 就绪前）执行一次：`UPDATE runs SET status='interrupted', error='应用退出时中断' WHERE status IN ('pending','running','waiting_input')`。
- **不自动续跑**：interrupted 是终态；用户「继续」= 从持久历史创建新 Run。
- **避免重复写入**：已完成的工具调用结果已固化在消息 JSON 中，新 Run 重建上下文时将其作为既有事实回灌，不重新执行；写入类工具的幂等性由版本机制（§2.4）兜底。历史执行信息留在消息里，runs 表**不回填**（§7「新增信息无法从旧数据恢复时明确标记，不能补造历史上下文」）。

### 2.4 文档与资源版本

**【设计】** 沿用「磁盘 Markdown 为正文事实来源 + 内容指纹 revision」，补两点：

1. **局部修改**：新增 `edit_note(id, base_revision, edits[])` 语义——基于明确版本提交一组文本修改，校验匹配与重叠，一次提交返回新 revision、差异与定位依据（计划 §6.2）。`base_revision` 不匹配即版本冲突，不盲目重试；现有 `write_note` 整篇替换保留。
2. **版本历史 `note_versions`**：为「差异呈现、恢复依据、恢复时检查后续版本」提供数据。挂 `note_id`（正文身份，重命名/移动不失效）：

| 字段         | 类型          | 说明                                                   |
| ------------ | ------------- | ------------------------------------------------------ |
| `id`         | INTEGER PK    |                                                        |
| `note_id`    | TEXT NOT NULL | `REFERENCES workspace_notes(id) ON DELETE CASCADE`     |
| `revision`   | TEXT NOT NULL | 该版本正文的 sha256                                    |
| `text`       | TEXT NOT NULL | 全量快照（Markdown 量级可接受；增量化待验证后再考虑）  |
| `run_id`     | TEXT NULL     | 产生该版本的 Run（Agent 写入时），`ON DELETE SET NULL` |
| `created_at` | TEXT NOT NULL |                                                        |

记录策略：Agent 写入必记；用户自动保存按间隔/差异阈值采样，具体上限（版本数或时间窗）在文档协作阶段验证后确定，DDL 不预设。首次写入历史前，把被覆盖前的当前正文记为基线版本。同一文档多组打开共享 draft 与版本（现状 `drafts[entryId]` 单例保持），Agent 修改不覆盖用户未保存草稿的规则由编辑器协作层执行，数据层只保证版本可查。

## 3. DB schema 与迁移

### 3.1 DDL 草案

**【设计】** 按现有 `database.ts` 迁移方式（`migrations` 数组追加一项，`user_version` 驱动，`db.transaction` 包裹；当前数组 12 项，下一版本为 v13，以实施时数组长度为准）：

```ts
[
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY REFERENCES workspace_entries(id) ON DELETE CASCADE,
    background TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    workdir TEXT,
    capabilities TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX idx_projects_updated ON projects(updated_at DESC)`,
  `CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    messages TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at DESC)`,
  `CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC)`,
  `CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','running','waiting_input','completed','failed','stopped','interrupted')),
    request TEXT NOT NULL DEFAULT '{}',
    steps TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
  )`,
  `CREATE INDEX idx_runs_session ON runs(session_id, started_at DESC)`,
  `CREATE INDEX idx_runs_project ON runs(project_id, started_at DESC)`,
  `CREATE TABLE note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL REFERENCES workspace_notes(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,
    text TEXT NOT NULL,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX idx_note_versions_note ON note_versions(note_id, created_at DESC)`,
  // 为现存项目条目建档案行
  `INSERT INTO projects (id, created_at, updated_at)
    SELECT id, updated_at, updated_at FROM workspace_entries WHERE kind='project'`,
  // 会话迁移：scope → project_id
  `INSERT INTO sessions (id, project_id, title, messages, created_at, updated_at)
    SELECT c.id, p.id, c.title, c.messages, c.created_at, c.updated_at
    FROM chat_sessions c LEFT JOIN projects p ON p.id = c.scope`,
  `DROP INDEX idx_chat_sessions_scope`,
];
```

`ON DELETE` 语义链：删除项目条目 → `projects` 行级联删除 → 该项目 `sessions.project_id` 置 NULL（会话保留为通用）、`runs.project_id` 置 NULL。`chat_sessions` 表本版本**不 DROP**（回滚窗口，见 3.3）。

外键说明：`projects.id` 引用 `workspace_entries(id)`，`sessions.project_id` 引用 `projects(id)`；SQLite 需 `foreign_keys = ON`（database.ts 已开启）。

### 3.2 scope → project_id 映射规则

**【设计】** 迁移 SQL 中 `LEFT JOIN projects p ON p.id = c.scope` 天然完成映射：

| 旧 scope                              | 新 project_id | 说明                                                                |
| ------------------------------------- | ------------- | ------------------------------------------------------------------- |
| `'home'` / `'sources'` / `'projects'` | NULL          | 三个入口的会话并入通用池（**待裁决 5**）                            |
| 存在的 project 条目 UUID              | 该 id         | 正常归属                                                            |
| UUID 但条目已删除（孤儿会话）         | NULL          | JOIN 不命中；会话保留为通用，App 现有「项目已不存在」错误态随之消失 |

### 3.3 迁移步骤与回滚

**【设计】** 沿用现有机制并补两点：

1. **备份（已有）**：`getDatabase` 在 `current > 0 && current < migrations.length` 时自动 `VACUUM INTO dela-before-v13.db`，迁移前无需新增动作；实施时确认该路径覆盖本版本。
2. **顺序**：v13 一个事务内完成建表 + 数据搬迁 + 停用旧索引；随后代码切换读写到 `sessions`/`runs`，`chat_sessions` 停写但保留。**不出现新旧实现同时执行同一请求**（计划 §7）：切版在一个提交内完成 main 进程读写路径替换。
3. **回滚**：恢复 `dela-before-v13.db`（用户级操作，覆盖 `userData/dela.db` 前先关闭应用）；或换回旧版本应用——旧代码仍可读 `chat_sessions`，但 v13 之后新产生的会话在 `sessions` 表，回滚会丢失该窗口数据，需在发布说明中写明。
4. **清理**：`chat_sessions` 待 `sessions` 稳定运行一个发布周期后，在后续迁移版本中 `DROP TABLE chat_sessions`（**待裁决 10**）。
5. **验证清单**（实施后、合入前）：
   - 两表行数一致；逐行 `messages` 长度一致；
   - 归属映射抽样：项目会话 `project_id` 非空且对应条目 `kind='project'`；孤儿会话计数记录到开发记录；
   - 旧版会话打开、续聊、删除路径回归；`pnpm build` 与现有 agent/workspace 测试通过。

### 3.4 视图状态键

**【设计】** 本轮（v13）**不动** `view:<scope>` 键与 localStorage：工作台布局（分割树、按项目保存）属阶段三交付，届时布局结构本身要重写（两组 → 分割节点树），提前改键只会做两次迁移。阶段三实施时：视图状态按 `project_id`（通用为固定键）保存，归宿见 **待裁决 6**。

## 4. 三类状态划分表

**【设计】** 对应计划 §3「分开管理三类状态」：

| 类别               | 包含什么                                                                                                                                                                                                                                                          | 存哪                                                                                                         | 谁写                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **持久数据**       | projects（档案）、sessions（消息历史、摘要、归档）、runs（终态执行记录）、note_versions、workspace_entries / workspace_notes、业务表（mail/canvas/todo/calendar/shuiyuan/notifications）、workspace_settings 中的偏好与指令（chat-commands、directory、theme 等） | `userData/dela.db`（SQLite，WAL）                                                                            | 仅 main 进程；renderer 经有限 preload API 读写，不直接访问数据库 |
| **正在执行的 Run** | 活跃 Run 的 AbortController、Pi Core 会话实例、流式缓冲（parts 增量）、chat-media 暂存（未发送附件）、runId → 状态映射                                                                                                                                            | main 内存为主；Run 行（status/request/steps）与消息 JSON 增量落库作为执行记录                                | 仅 main（agent 执行域）；启动时把开放状态 Run 改标 interrupted   |
| **视图状态**       | 标签与分屏布局（按项目）、活动标签与焦点、光标/撤销历史（编辑器会话键）、滚动位置、composer 草稿与 @ 引用、面板宽度/开关                                                                                                                                          | renderer zustand + localStorage（现状 `dela.*` 键；阶段三按 project_id 重组）；过渡期 `view:<scope>` 仍在 DB | 仅 renderer（经 save-view IPC 落 DB 的部分除外）                 |

边界规则：视图状态丢失只影响「现场」，不影响事实与执行；执行态丢失（崩溃）由 runs 落库记录兜底识别；持久数据是唯一跨启动事实。「当前会话指针」（现状 `activeSession`）从执行域移入视图域：它描述「哪个入口在看哪个会话」，随视图状态保存；运行互斥改由 runs 表 + 内存 runId Map 表达。

## 5. 多入口一致性规则

**【设计】** 对应计划 §3「同一会话的多个入口共享会话状态，不能因打开视图而启动重复 Agent；同一文档多组打开共享正文与版本」：

1. **会话状态按 sessionId 广播**：`workspace:chat-update` 载荷从 `(scope, chat)` 改为 `(sessionId, chat)`，订阅者按 sessionId 过滤；任何入口 `getChat(sessionId)` 读到同一快照。preload API 形状同步调整（`getChat/openChat/listChats/ask/cancelAsk` 均以 sessionId 为参数，项目上下文由 main 从 session 归属解析）。
2. **打开视图不产生执行**：Run 只由显式用户动作（发送、编辑重发、继续中断的会话）创建；入口挂载 = 读取快照 + 订阅推送。同一 session 同时至多一个活跃 Run，第二个发送请求被拒（沿用现状错误语义）。
3. **关闭视图不停止执行**：切换项目、关闭聊天标签不隐式停止 Run（计划 §3）；停止执行只有独立的停止入口（stopRun）。删除会话是显式操作，删除运行中的会话先 abort 再删（沿用现状路径）。
4. **文档正文与版本单键共享**：正文事实 = 磁盘文件，版本 = `workspace_notes` 路径 + revision 指纹 + `note_versions`；renderer draft store 按文档 key（entry id）单例，多组打开共享 text/saved/revision，光标/撤销/滚动按组隔离（现有 CodeMirror 会话键模式推广到 N 组）。
5. **资源变化通知替代整体刷新**：文件与业务数据改动按资源引用广播事件，相关视图订阅；`TimetableView` 依赖「聊天结束」刷新课表的现状随之替换为日历事件订阅（属工具重构阶段实施，模型层先确立通知键 = 资源引用 + 版本）。
6. **草稿按会话/项目隔离**：composer 草稿键从 scope 迁移为 sessionId（通用入口用固定键），避免同项目多会话互相覆盖输入；上限策略沿用 `dela.chat.drafts` 的裁剪逻辑。

## 6. 待裁决项

| #   | 决策点                                       | 推荐                                                                            | 备选与理由                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Project 表形态                               | **`projects` 档案表，主键复用 `workspace_entries.id`**（§2.1）                  | 备选 A：完全独立 projects 表、资源树另挂——概念最干净，但现有 parentId 中心的全部资源逻辑需连带重写，且 folder↔project 原地转换语义会被破坏；备选 B：给 workspace_entries 加列——通用树表背上仅项目可用的字段，且无法表达外键约束。推荐方案改动面最小、迁移映射天然成立。 |
| 2   | sessions.messages 存 JSON 列还是拆行表       | **保留 JSON 列**（首阶段）                                                      | 拆表利于追加写入与按 Run 关联查询，但现状整篇 UPDATE 在当前量级没有实测瓶颈；上下文压缩摘要已用独立列承载。若阶段二压缩实现需要按消息寻址再拆，届时单独迁移。                                                                                                           |
| 3   | Run 工具步骤存内嵌 JSON 还是 tool_calls 行表 | **`runs.steps` 轻量索引 JSON，全文留在消息**                                    | 行表便于按工具统计，但目前没有这类查询需求；双写大 output 会放大存储。出现真实查询方再拆。                                                                                                                                                                              |
| 4   | 删除项目时会话去向                           | **`ON DELETE SET NULL`，会话降级为通用**                                        | 计划只规定「删除会话不连带删除项目成果」，未规定反向；CASCADE 会静默删除用户对话历史，与「不能补造/静默丢失」精神冲突。                                                                                                                                                 |
| 5   | 旧 `sources`/`projects` 入口会话归属         | **并入通用池（project_id NULL），不保留分组**                                   | 计划 §4.1 只保留「无项目的通用聊天入口」一个概念；若产品希望保留「资料页助手」独立池，可加 `origin TEXT` 列，一个版本后再决定去留。                                                                                                                                     |
| 6   | 视图状态最终归宿                             | **阶段三统一到 renderer localStorage 按 project_id 键；DB `view:%` 键届时废弃** | 布局属视图状态不该进 DB；现状 DB/localStorage 双处是历史包袱。若要支持「重装/换机保留现场」则需进 DB，属新需求，默认不做。                                                                                                                                              |
| 7   | note_versions 挂 note_id 还是 entry_id       | **note_id**                                                                     | 正文身份在 workspace_notes，entry 重命名/移动不失效；工具侧 entry id → note_id 已有查询路径（`notePath` 模式）。                                                                                                                                                        |
| 8   | `waiting_input` 首轮是否实现                 | **状态入模型、首轮不触发**                                                      | 依赖 Pi Core 运行中输入的验证结果（计划 §5.1 最小接入验证）；模型先定义可避免后续改状态机。                                                                                                                                                                             |
| 9   | 跨会话并行运行                               | **同 session 串行、不同 session 允许并行**（受 Pi/提供商验证约束）              | 现状按 scope 互斥即「项目内串行」；目标模型把串行单位收敛到 session。并行度上限待阶段一实测（网络、限流、UI 呈现）。                                                                                                                                                    |
| 10  | chat_sessions 清理时点                       | **v13 不 DROP，稳定一个发布周期后单独迁移版本 DROP**                            | 保留回滚窗口；代价是双表共存期间旧表只读不写，需在代码中标注。                                                                                                                                                                                                          |

## 7. 与计划的对应关系（核对表）

- §3 五对象：Project（§2.1）、Session（§2.2）、Run（§2.3）、文档与资源（§2.4）、标签与分屏（§4 视图状态行，布局结构本设计不展开）。
- §3 三类状态：§4 划分表。
- §3 多入口一致性：§5。
- §5.1 Pi 衔接：§2.2 边界与 §2.3 Run。
- §6.1 上下文压缩：§2.2 `summary` 字段（触发与预算属阶段二实现，不在本文）。
- §6.2 局部修改：§2.4。
- §7 迁移要求：§3.3（备份、回滚、不双跑、不补造历史）。
