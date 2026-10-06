# 重构目标目录结构与模块边界

日期：2026-09-29。状态：设计稿，供 [Agent 与工作区重构计划](../agent-workspace-plan.md) 各阶段实施时执行；本文只定义目标结构与迁移路径，不代表任何部分已经落地。

本文落实计划文首的组织要求：执行核心、会话与持久化、上下文与压缩、业务工具、能力接入、工作台布局分别成目录；入口只负责组装；模块经明确接口协作。所有路径落到文件名级别。单应用、单 package 不变；新增目录不等于子包，`vite.*.config.ts` 的三个入口（`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/index.html`）保持不变，`tsconfig.{main,preload,renderer}.json` 无需调整。

行数与工具数量以 2026-09-29 代码盘点为准。计划简报中"18 个工具"为约数，`src/main/agent/tools.ts` 实际定义 **20 个**，以代码为准。

---

## 1. 现状问题清单

### 1.1 renderer 侧

**`src/renderer/features/projects/ProjectView.tsx`（1799 行）** —— 本次重构最大拆除对象，单文件承担至少 12 项职责：

| #   | 职责                                                                                                              | 现状位置（行号区间大致）                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | 编辑器布局引擎：`EditorLayout` 类型、split/ratio/focus、localStorage 持久化、scope 切换种子、渲染期同步           | 类型与 `defaultEditorLayout`（80–170），`persistEditorLayout`/`syncView`（266–472） |
| 2   | 标签系统：打开/关闭/批量关闭/跨组移动/拖拽协议/中键关闭/上下文菜单/激活滚动到可见/dirty 标记                      | `open`/`closeTab`/`closeTabs`/`moveTab`/`dropEditorTab`/`renderTabs`（473–1044）    |
| 3   | 目录侧栏：筛选、课程资料/我的资料/归档三段、折叠、拖放移动与文件导入                                              | `renderGroup` 之外的 aside JSX（1193–1509）                                         |
| 4   | 工作区 CRUD 弹窗：8 种 modal（新建项目/文件夹/笔记、重命名、移动、移除、链接资料、连接 Canvas），含表单状态与提交 | `Modal` 类型、`show`/`submit`（65–78、672–822、1674–1759）                          |
| 5   | 助手面板挂载与布局：开关、宽度、并排/覆盖判定（`agentInline`）、Resizer                                           | 248–254、395–408、1571–1608                                                         |
| 6   | 滚动位置记录：`scrollPending` 防抖落盘到 view state                                                               | 261–262、823–834                                                                    |
| 7   | 编辑器会话键管理与清理：`documentSessionKey`/`noteSessionKey`/`forgetDocumentSessions`                            | 103–108、503–508                                                                    |
| 8   | 键盘快捷键：Ctrl+\、Alt+1/2、PageUp/Down、Ctrl+B、Ctrl+W                                                          | `handleWorkspaceKeyDown`（1139–1169）                                               |
| 9   | 标题栏 portal 工具栏：布局菜单、助手开关                                                                          | `TitleBarPortal`（1609–1673、1764–1771）                                            |
| 10  | 响应式分流：mobile drawer / explorerDrawer / matchMedia 监听                                                      | 226–237、351–358                                                                    |
| 11  | 新建笔记（含来源 header 拼装）、Canvas 课程刷新                                                                   | `newNote`、`refreshCourses`（732–746、844–858）                                     |
| 12  | 与 `useWorkspace` 的双向同步（syncView 单向推送不变量靠注释维系）                                                 | 370–389、469–472                                                                    |

耦合点：布局、标签、目录、弹窗、助手五块状态互相纠缠（例如 `closeTab` 同时做保存冲盘、会话键清理、view 同步、焦点回退）；`mode: 'project' | 'sources'` 双模式让同一文件服务两个视图（`SourcesView` 只是它的薄包装）。

**`src/renderer/App.tsx`（492 行）**：视图路由状态机 + 导航历史栈 + 5 种一次性定位请求脉冲（`chatRequest`/`mailRequest`/`todoRequest`/`settingsRequest`/`createProject`）+ 通知镜像与轮询 + 主题/缩放/字号应用 + onboarding 阶段 + 托盘动作。耦合点：`openSearchResult` 逐分支知道每个目标视图的内部状态入口（直接写 `useWorkspace` 的 view、`useShuiyuan` 的 requestTopic），搜索分发与各视图内部实现强耦合。

**`src/renderer/components/AppShell/AppShell.tsx`（809 行）**：窗口 chrome、标题栏四菜单、全局快捷键注册、主导航、项目列表、帮助弹窗。耦合点：作为通用壳却直接订阅 `useWorkspace`（项目列表、`hasSaveableNote`、保存所有笔记），组件层级反向依赖 feature store。

**`src/renderer/features/projects/workspace.ts`（232 行）**：renderer 全局耦合枢纽——`useWorkspace` 同时持有条目树、Canvas 概览、视图持久化（`setView` 直写 IPC）、文档草稿生命周期（read/release/edit/save 与防抖、保存互斥）。被 App、AppShell、AgentPanel、use-chat、ProjectDocument 等 6+ 处 import；chat 的引用保存前校验（`use-chat.ts` 里 `store.save(ref.key)`）也跨界打进来。

**`src/renderer/features/chat/use-chat.ts`（296 行）**：单 hook 承担会话加载/推送订阅/发送/失败恢复/附件暂存/输入草稿/模型切换/会话管理。`scope` 参数绑定旧 scope 身份模型；与 `useWorkspace` 双向调用（use-chat → workspace.save；workspace 无反向，但语义上 chat 依赖工作区 store）。

其余：`ChatThread.tsx`（612）/`ChatComposer.tsx`（579）/`ProjectDocument.tsx`（539）/`NoteEditor.tsx`（483）体量大但职责相对内聚，迁移时按域归位即可，不强制再拆。

### 1.2 main 侧

**`src/main/agent/api.ts`（462 行）**：会话指针（`activeSession` Map）、`chat_sessions` 持久化、`ask` 编排（引用读取/附件消费/图片拼装/系统提示词/**硬编码 `slice(-12)` 历史截取**/parts 流式增量/节流推送/中断语义）、自定义指令 CRUD、`publishChat` 订阅广播。计划要替换的上下文策略和要重建的会话身份都内嵌在这一个函数里。

**`src/main/agent/loop.ts`（343 行）**：OpenAI 兼容 SSE 解析（`readCompletion`）与 agent 执行循环（重试/超时/max_tokens 降级/图像摘出/轮次上限）耦合。这是 Pi Core 接入要替换或包裹的对象，两种策略现在无法分开演进。

**`src/main/agent/tools.ts`（446 行）**：20 个工具单文件，横跨 7 个业务领域，直接 import 各业务 API 函数（`../todo`、`../canvas/api`、`../mail/api`、`../workspace/api`…），没有统一契约层。计划 §5.2 的接口重设计（状态语义、分页衔接、覆盖范围标注）没有落点。

**`src/main/workspace/api.ts`（661 行）**：条目 CRUD、存储树管理（`managedPath`/`prepareStorage`/迁移与 pending move）、笔记读写与 revision、导入、外部打开（VS Code spawn）、预览路径放行、视图持久化。域内聚尚可，但它同时是 renderer IPC 实现层和 agent 工具实现层，两批调用方共享同一组宽接口。

**`src/main/index.ts`（452 行）**：应用生命周期、窗口/托盘、内联 `registerSettingsIpc`、后台定时器、smoke 流程。设置通道内联在入口文件，§4.4 新增偏好没有去处。

**`src/main/workspace/ipc.ts` → `registerAgentIpc()`**：agent 通道由 workspace 的 IPC 入口转手注册，模块边界被入口互相缠绕。

### 1.3 shared 与 preload

**`src/shared/api.ts`（897 行）**：12 个领域的 IPC 契约、载荷类型、常量（`calendarEventColors`/`zoomLevels`/`workspaceArchiveId`…）全在一个文件。main/preload 26 处、renderer 45 处 import；改任何领域的类型都触碰同一文件，review 噪音大。更深的结构问题：**会话与运行通道挂在 `WorkspaceApi` 下**（`getChat`/`ask`/`onChatUpdate`…），因为会话以 `scope` 字符串为身份而非独立实体——这是计划 §3 要改的数据边界在类型层的投影。

**`src/preload/index.ts`（293 行）**：所有通道内联一个文件。面本身是克制的（约 90 个方法、11 个命名空间），问题只是组织：新增 session/layout 通道时会继续膨胀。

### 1.4 跨层耦合点汇总（重构必须切断的）

1. **`scope` 作为万能身份**：会话（`chat_sessions.scope`）、视图（`view:{scope}` 设置行）、布局（`dela.editor.layout.{scope}` localStorage）、chatRequest 导航脉冲全用同一字符串，"项目=scope"的假设贯穿 main/renderer。
2. **workspace 命名空间承载 chat 通道**：会话/运行是独立实体，却复用工作区通道。
3. **`useWorkspace` 是 renderer 枢纽 store**：条目/Canvas/视图/草稿四类状态一个 store，任何消费方都能碰全部内部状态。
4. **App.openSearchResult 知道所有视图内部**：新增导航目标必须改 App。
5. **tools.ts 直连业务 API**：工具契约、结果语义（coverage/分页/新鲜度）没有统一落点。
6. **视图状态双份持久化**：`workspace_settings` 的 `view:%` 行（DB，随账号/设备）与 `dela.editor.layout.%`（localStorage）两套布局事实。

---

## 2. main 进程目标结构

### 2.1 `src/main/agent/` 目标目录树

```
src/main/agent/
  index.ts                 # 组装入口：registerAgentIpc()，被 src/main/index.ts 直接调用
  core/                    # 执行核心：Pi 接入与运行循环。不依赖 Dela 存储、不依赖 Electron IPC
    run.ts                 # Run 执行循环（迁移自 loop.ts 的 runAgent）：轮次、取消、工具回调、图像附加
    stream.ts              # OpenAI 兼容 SSE 解析（迁移自 loop.ts 的 readCompletion）
    pi.ts                  # Pi Core 适配层（阶段一新增）：版本锁定、能力探测、事件映射；验证后决定 run.ts 走 Pi 还是 stream.ts
    providers.ts           # 模型服务配置存取（迁移自 agent/providers.ts，含 llm:* 通道注册）
  session/                 # 会话与运行持久化 + renderer 推送
    store.ts               # 会话表读写与每项目会话指针（迁移自 api.ts 的 sessionRow/resolveSession/persistSession/listChats）
    runs.ts                # Run 记录：运行状态、工具调用、中断/停止标记、恢复语义（阶段二实体化）
    manager.ts             # 会话生命周期编排：new/open/delete/ask/cancel（迁移自 api.ts 主体）
    commands.ts            # 自定义 / 指令 CRUD（迁移自 api.ts 的 chatCommands 三函数）
    media.ts               # 聊天图片/附件暂存与 GC（迁移自 agent/media.ts）
    subscriptions.ts       # WebContents 订阅集合与 publish 推送（迁移自 api.ts 的 chatClients/publishChat）
    ipc.ts                 # session:* / chat:* 通道注册与 zod 校验（迁移自 agent/ipc.ts）
  context/                 # 上下文组装与压缩
    references.ts          # @ 引用与附件的读取、净化、体积校验（迁移自 api.ts ask() 内 documents/attachmentDocs 段）
    assemble.ts            # 项目背景 + 历史 + 引用/选区 + Skill → 模型消息（迁移自 ask() 内 sections/system prompt 拼装）
    budget.ts              # 上下文预算：窗口来源、token 估算、输出与工具交互预留（阶段二）
    compaction.ts          # 按预算触发的历史压缩与摘要（阶段二，替换 slice(-12)）
  tools/
    registry.ts            # 工具契约（AgentTool 类型）、聚合、modelToolDefinitions()、executeAgentTool()
    shared.ts              # 跨工具小工具：page()/match()/slimTodo（迁移自 tools.ts 顶部）
    index.ts               # 领域聚合入口：import 各领域并合并注册
    common/                # 跨领域通用：发现/搜索/读取/编辑
      read-resource.ts     # read_resource
      edit.ts              # write_note；阶段二扩展局部修改（edit_note：匹配校验+diff+新版本）
      discover.ts          # （阶段二新增）跨业务资源发现/检索统一入口
    canvas/
      find-courses.ts      # find_courses
      sync-sources.ts      # sync_sources
      search-sources.ts    # search_sources
    workspace/
      search-workspace.ts  # search_workspace
      entries.ts           # create_entry + update_entry
      link-source.ts       # link_source
      copy-file.ts         # copy_file_to_project
    todo/
      query.ts             # query_todos + query_assignments（同一缓存两种筛选，共享 slim/page）
      save.ts              # save_todo
      refresh.ts           # refresh_todos
    timetable/
      query-schedule.ts    # query_schedule
      create-event.ts      # create_event
    mail/
      search-mail.ts       # search_mail
      prepare-email.ts     # prepare_email
    web/
      web-search.ts        # web_search（实现迁移自 agent/web-search.ts 的 searchWeb）
      fetch-page.ts        # fetch_page（实现迁移自 web-search.ts 的 fetchWebPage）
    shuiyuan/              # （阶段二新增）主题搜索/详情/楼层分页读取，按 §5.2 水源行落地
  capabilities/            # MCP / Skills 预留（阶段四填充；阶段一先立 types.ts 契约）
    types.ts               # 能力定义契约（注册、启停、连接/依赖状态），对齐 tools/registry 的接口
    mcp/                   # 阶段四：MCP 客户端接入，产出注册进 tools/registry 的动态工具
    skills/                # 阶段四：SKILL.md 发现、渐进加载
```

每个目录附 `test/` 子目录，测试就近（延续 `src/main/canvas/test/` 的现有惯例），如 `tools/todo/test/query.test.ts`、`session/test/manager.test.ts`；现 `src/main/agent/test/` 下的 5 个测试按被测对象迁入对应目录。

文件粒度约定：一个文件一个工具（或一组强绑定的小工具，如 `entries.ts`）；目录 `index.ts` 只做聚合不做逻辑；`manager.ts` 允许是目录内最大的文件，但只保留"编排"，具体策略下沉到 context/ 或 core/。

### 2.2 tools.ts → 领域目录映射表（现有 20 个工具）

| 现有工具（tools.ts）   | 目标文件                              | 迁移性质                                |
| ---------------------- | ------------------------------------- | --------------------------------------- |
| `prepare_email`        | `tools/mail/prepare-email.ts`         | 平移                                    |
| `search_mail`          | `tools/mail/search-mail.ts`           | 平移                                    |
| `query_schedule`       | `tools/timetable/query-schedule.ts`   | 平移                                    |
| `create_event`         | `tools/timetable/create-event.ts`     | 平移                                    |
| `query_todos`          | `tools/todo/query.ts`                 | 平移；阶段二按 §5.2 复核筛选语义        |
| `query_assignments`    | `tools/todo/query.ts`                 | 平移；与 query_todos 共享实现、分开定义 |
| `save_todo`            | `tools/todo/save.ts`                  | 平移                                    |
| `refresh_todos`        | `tools/todo/refresh.ts`               | 平移                                    |
| `find_courses`         | `tools/canvas/find-courses.ts`        | 平移；阶段二补状态诊断语义              |
| `sync_sources`         | `tools/canvas/sync-sources.ts`        | 平移                                    |
| `search_sources`       | `tools/canvas/search-sources.ts`      | 平移                                    |
| `read_resource`        | `tools/common/read-resource.ts`       | 平移；阶段二统一分页/新鲜度表达         |
| `write_note`           | `tools/common/edit.ts`                | 平移；阶段二在此扩展局部修改            |
| `search_workspace`     | `tools/workspace/search-workspace.ts` | 平移                                    |
| `create_entry`         | `tools/workspace/entries.ts`          | 平移                                    |
| `update_entry`         | `tools/workspace/entries.ts`          | 平移                                    |
| `link_source`          | `tools/workspace/link-source.ts`      | 平移                                    |
| `copy_file_to_project` | `tools/workspace/copy-file.ts`        | 平移                                    |
| `web_search`           | `tools/web/web-search.ts`             | 平移（实现自 web-search.ts 拆出）       |
| `fetch_page`           | `tools/web/fetch-page.ts`             | 平移（实现自 web-search.ts 拆出）       |

阶段二按 §5.2 盘点新增：`tools/shuiyuan/`（搜索/主题/楼层）、`tools/common/discover.ts`（跨业务发现）、`tools/common/edit.ts` 的局部修改闭环。**迁移即拆分**：工具搬到领域目录的同时按 §5.2 契约复核描述与结果语义，不把"原样搬入"当作完成。

### 2.3 模块依赖方向规则

```
src/main/index.ts（应用组装）
  └→ agent/index.ts ──→ session/、core/、context/、tools/、capabilities/
        session/  ──→ core/（run + providers + budget）、context/（类型与调用）、tools/（仅 registry 聚合入口）、capabilities/（skillIndex，manager 取后注入 context/assemble）、业务读取 API
        core/     ──→ shared/（类型）；不 import session/tools/context/业务目录；不经由 electron IPC 感知 renderer
        context/  ──→ shared/、core/budget（预算与 token 估算归位 core）、业务读取 API（canvas/shuiyuan/workspace 的 read*）；不 import session/tools/capabilities
        tools/    ──→ 业务 API（../canvas、../mail、../timetable、../todo、../workspace）、shared/；不 import core/session/context
        capabilities/ ──→ tools/registry（setMcpRouting 注入与 agentTools 键名，单向——registry 不回指 capabilities，MCP 并集与路由经该注入获得）、shared/；不 import session/core/context
业务目录（canvas/mail/timetable/shuiyuan/workspace/todo）──→ shared/、database；禁止 import agent/（跨层错误码契约在 shared/tool-errors.ts）
```

具体红线：

- **core 不 import renderer**：与 renderer 的全部通信经 `session/subscriptions.ts` 的事件回调（现 `publishChat` 模式的延伸），core 只产出事件。
- **tools 不 import core**：工具不感知模型循环；`session/manager.ts` 持有 registry 聚合结果传入 `core/run.ts`（延续现 `runAgent` 的 `execute` 回调注入，依赖倒置）。
- **tools 领域间不互相 import**：`tools/canvas` 不 import `tools/workspace`；共享的 `page()`/`match()` 只在 `tools/shared.ts`。
- **业务目录不反向依赖 agent**：`src/main/workspace/api.ts` 等保持对 agent 零 import（现状即如此，拆分后作为红线守住）。
- `session` 与 `context` 的边界：session 管事实（存了什么、谁在跑），context 管策略（发什么给模型）；manager 编排两者，`context` 不回写 session。

### 2.4 agent 之外的 main 调整（最小幅度）

- `src/main/index.ts`：直接 `import { registerAgentIpc } from './agent'`，`workspace/ipc.ts` 不再转手注册 agent 通道；内联的 `registerSettingsIpc` 迁出（见 §3.6）。
- `src/main/settings/ipc.ts`（新增，阶段三）：承接现 `index.ts` 内联设置通道 + §4.4 新增偏好（任务通知、工作区偏好）。
- `src/main/workspace/api.ts`（661 行）暂不强制拆分；阶段二做文档局部编辑协作时，若 `tools/common/edit.ts` 与 renderer 保存路径需要更细的读写原语，再按 `storage.ts`（存储树/迁移）/`notes.ts`（笔记读写与 revision）/`entries.ts`（CRUD）拆开。是否拆以阶段二实际耦合为准，不在本轮预建。
- `mail/canvas/timetable/shuiyuan/todo` 业务目录不动，仅在工具契约需要新函数时新增。

---

## 3. renderer 目标结构

### 3.1 目标目录树

新增五个顶层目录（`app/`、`workbench/`、`navigation/`、`content/`、`sessions/`，外加 `workspace/` 状态目录），`features/` 保留给整页业务视图。这样"工作台/导航/内容"与"业务功能页"在目录层可见，避免 workbench 混进 features 后边界再次模糊。（备选方案是全部塞进 `features/workbench`，不采用：工作台是承载面而非并列功能，值得顶层位置。）

```
src/renderer/
  app/                      # 应用装配层（现 App.tsx 拆分）
    App.tsx                 # 根组件：launch 阶段、provider 组合、视图切换动画
    navigation.ts           # 视图路由 zustand store：view、back/forward 栈、定位请求脉冲、navigate()
    theme.ts                # 主题/缩放/字号的应用与 localStorage 镜像（迁移自 App.tsx 散落 effects）
    notifications.ts        # 通知镜像订阅与跳转 hook（迁移自 App.tsx 通知段）
    workbench-shell.tsx     # 工作台装配（3B 新增）：三 Provider + EntryDialogs + 导航脉冲消费
    workbench-explorer.tsx  # 工作台目录侧栏装配（3B 新增）：ProjectFileTree + SourcesTree + 归档区
    mail-draft-dialog.tsx   # ChatTabSource.mailDialog 注入实现（3B 新增）：包装 MailComposer 为自包含弹窗
  workbench/                # 统一标签工作台（替换 ProjectView 的布局/标签职责）
    Workbench.tsx           # 工作台根：渲染 layout 根节点，接管现 ProjectView 的编辑区骨架
    layout-store.ts         # 分割树/标签/焦点/最大化 zustand store + 防抖持久化
    layout-schema.ts        # LayoutNode/TabId 类型、校验、旧 view:%/localStorage 数据种子
    SplitNode.tsx           # 分割节点：递归渲染、纵横分屏、组间尺寸拖拽
    TabGroup.tsx            # 标签组：标签栏 + 内容宿主 + 组级工具栏挂载
    TabBar.tsx              # 扁平标签栏：排序拖拽、跨组拖放、上下文菜单、激活滚动可见
    tab-dnd.ts              # 拖拽负载协议（application/x-dela-tab），扩展现 editor-tab 协议
    GroupToolbar.tsx        # 组操作：分屏方向、最大化/还原、组菜单（并入标题栏 portal 机制）
    EmptyState.tsx          # 组空态
    registry.ts             # 内容类型注册表：TabKind → { 组件, 图标, 标题解析 }；唯一 import content/ 的地方
  navigation/               # 项目会话导航（替换 AppShell 项目列表 + ProjectView 目录侧栏）
    ProjectSessionNav.tsx   # 按项目展开会话、近期优先、"显示更多"（§4.1）
    SessionRow.tsx          # 会话行：运行/完成/等待输入状态徽标（订阅 sessions/runs）
    ProjectFileTree.tsx     # 项目文件树（迁移自 features/projects/ProjectSidebar.tsx）
    SourcesTree.tsx         # Canvas 资料树（迁移自 features/sources/SourceList.tsx）
    store.ts                # 展开态/筛选/选中 zustand store
  sessions/                 # 会话与运行镜像（同一会话多入口共享状态的家）
    store.ts                # 会话列表镜像（按项目），替换 listChats 的按需拉取
    runs.ts                 # Run 状态镜像：订阅 session:on-run-event，供导航徽标与 ChatTab 共用
  content/                  # 标签内容组件（按内容类型分域，互不 import）
    chat/                   # ← features/chat 全目录 + features/projects/AgentPanel.tsx
      ChatTab.tsx           # 会话作为标签内容（AgentPanel 去面板化：去掉 aside/宽度逻辑）
      ChatThread.tsx  ChatComposer.tsx  ComposerEditor.tsx  ChatSessions.tsx
      ToolTimeline.tsx  markdown.tsx  media.ts  drafts.ts
      use-chat.ts           # 改为按 sessionId 订阅 sessions/ 镜像，去掉 scope 参数
    note/                   # ← features/projects 的文档编辑部分
      NoteTab.tsx           # 笔记标签内容（ProjectDocument 的笔记分支 + 模式切换）
      document-toolbar.tsx  # 保存状态/源码切换/导出/外部打开（ProjectDocument 工具栏逻辑）
      MarkdownEditor.tsx  NoteEditor.tsx  note-editor.css   # 原文件平移
    preview/                # ← features/sources 的预览部分 + ProjectDocument 只读分支
      PreviewTab.tsx        # 按格式分流（PDF/Office/图片/HTML/文本），合并现 SourceDetail 与 ProjectDocument 只读路径
      PdfReader.tsx  DocxPreview.tsx  SheetPreview.tsx  OfficePrompt.tsx  use-pinch-zoom.ts
    review/                 # （阶段二预留）修改审阅标签：diff 呈现、应用/恢复
      ReviewTab.tsx
  workspace/                # 工作区数据与操作（renderer 侧）
    store.ts                # 条目树 + Canvas 概览镜像（迁移自 features/projects/workspace.ts 前半）
    drafts.ts               # 笔记草稿生命周期：read/edit/save/release 防抖与互斥（迁移自 workspace.ts 后半）
    entry-dialogs.tsx       # 8 种 CRUD 弹窗（迁移自 ProjectView modal 段）
    entry-actions.ts        # 归档/升级为项目/导入/移动等动作（迁移自 ProjectView action/move 段）
  features/                 # 保留整页业务视图：mail/ timetable/ shuiyuan/ todo/ notifications/ search/ onboarding/
    settings/               # 重构见 §3.6
  components/  lib/  styles/  main.tsx  index.html   # 不变（AppShell 瘦身见下）
```

`components/AppShell/AppShell.tsx` 保留原路径（窗口 chrome、标题栏菜单、快捷键注册、帮助弹窗），但移除项目列表与 `useWorkspace` 订阅——项目/会话导航整体由 `navigation/ProjectSessionNav` 承担，挂进 AppShell 的侧栏槽位。AppShell 不再 import 任何 feature/workspace store。

### 3.2 workbench 布局模型（落到类型）

```ts
// workbench/layout-schema.ts
type TabKind = 'chat' | 'note' | 'preview' | 'review';
type TabId = `${TabKind}:${string}`; // chat:{sessionId} | note:{entryId} | preview:{sourceKey|entryId}
type GroupNode = { type: 'group'; id: string; tabs: TabId[]; active: TabId | null };
type SplitNode = {
  type: 'split';
  orientation: 'vertical' | 'horizontal';
  ratio: number;
  children: LayoutNode[]; // ≥2，支持三屏（split 嵌套）
};
type LayoutNode = GroupNode | SplitNode;
type WorkbenchLayout = { root: LayoutNode; focus: string; maximized: string | null };
```

- 现有 `EditorLayout`（固定 primary/secondary 两组）是 `SplitNode` 深度为 1 的特例；`layout-schema.ts` 提供从旧 `view:{scope}` 行与 `dela.editor.layout.{scope}` localStorage 生成种子的迁移函数。
- 持久化按项目：`layout:{projectId}`（写入 `workspace_settings`，经 IPC，替换 `workspace:save-view`），渲染输入草稿、光标、撤销历史仍在各内容组件本地（`documentSessionKey` 的语义由 TabId + groupId 承接）。
- 拖拽协议统一为 `application/x-dela-tab`（现 `application/x-dela-editor-tab` 扩展 kind 字段），边缘拖放创建新组、组间移动、组内排序都在 `tab-dnd.ts` 一处定义。
- 助手不再是特例面板：chat 是普通 TabKind，`agentOpen`/`agentWidth`/`agentInline` 及其 Resizer 逻辑随 ProjectView 退役。

### 3.3 内容类型迁移映射（features → content）

| 现文件                                                                                                               | 去向                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `features/chat/ChatThread.tsx` 等全部                                                                                | `content/chat/` 原名平移                                                                                              |
| `features/chat/use-chat.ts`                                                                                          | `content/chat/use-chat.ts`；签名从 `(scope, chatRequest)` 改为 `(sessionId)`，会话列表/运行状态改订阅 `sessions/`     |
| `features/projects/AgentPanel.tsx`                                                                                   | `content/chat/ChatTab.tsx`（去掉 aside、宽度、开关；保留 @ 引用候选拼装）                                             |
| `features/projects/ProjectDocument.tsx`                                                                              | 拆两半：笔记分支 → `content/note/NoteTab.tsx` + `document-toolbar.tsx`；只读分支并入 `content/preview/PreviewTab.tsx` |
| `features/projects/MarkdownEditor.tsx` / `NoteEditor.tsx` / `note-editor.css`                                        | `content/note/` 原名平移                                                                                              |
| `features/sources/SourceDetail.tsx`                                                                                  | `content/preview/PreviewTab.tsx` 吸收其分流逻辑                                                                       |
| `features/sources/PdfReader.tsx` / `DocxPreview.tsx` / `SheetPreview.tsx` / `OfficePrompt.tsx` / `use-pinch-zoom.ts` | `content/preview/` 原名平移                                                                                           |
| `features/sources/SourceList.tsx`                                                                                    | `navigation/SourcesTree.tsx`                                                                                          |
| `features/sources/CanvasTokenForm.tsx` / `canvas-connect.ts`                                                         | `features/settings/connections/`（onboarding CanvasStep 从设置域 import）                                             |
| `features/sources/SourcesView.tsx`                                                                                   | 退役（资料浏览由 navigation + workbench 预览标签承载）                                                                |
| `features/home/HomeView.tsx`                                                                                         | 退役（通用聊天入口进 navigation；问候语/空态并入 workbench EmptyState 或导航落地页，交互细节阶段三定稿）              |
| `features/projects/ProjectView.tsx`                                                                                  | 退役（职责分派见 §6 总表）                                                                                            |
| `features/projects/workspace.ts`                                                                                     | 拆为 `workspace/store.ts` + `workspace/drafts.ts`                                                                     |
| `features/projects/ProjectSidebar.tsx`                                                                               | `navigation/ProjectFileTree.tsx`                                                                                      |
| `features/projects/index.ts`                                                                                         | 随 ProjectView 退役删除                                                                                               |

content 域间红线：`content/chat` 不 import `content/note`/`content/preview`；跨内容协作只经 `workbench/registry.ts`、`sessions/`、`workspace/` 与 shared 类型。

### 3.4 sessions/ 与 workspace/ 的镜像职责

- `sessions/store.ts`：按项目（含"无项目"）维护会话摘要列表与运行状态摘要；数据全部来自 IPC（`session:list`）与订阅（`session:on-update`），不发起点对点请求。
- `sessions/runs.ts`：订阅 `session:on-run-event`（流式文本、工具开始/结束、运行状态迁移），按 sessionId 归并；导航行、ChatTab、通知设置共用这一份，满足"同一会话多个入口共享会话状态，不因打开视图启动重复 Agent"。
- `workspace/store.ts`：条目树 + Canvas 概览（现 `load/refresh/setCanvas`），去掉 `setView`（布局归 workbench）与 drafts（归 `workspace/drafts.ts`）。
- `workspace/drafts.ts`：保留现 read/edit/save/release 的防抖与互斥语义，仅作为独立 store；ProjectView 的关闭前冲盘逻辑移到 workbench 关闭标签流程调用。

### 3.5 状态管理边界（zustand vs IPC）

| 状态                             | 归属                                     | 持久化路径                                            |
| -------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| 视图路由、导航历史、定位请求脉冲 | `app/navigation.ts`（zustand）           | localStorage（当前项目）                              |
| 分割树、标签、焦点、最大化       | `workbench/layout-store.ts`（zustand）   | IPC `layout:save`（防抖），按项目                     |
| 会话列表、运行状态镜像           | `sessions/`（zustand，订阅驱动）         | 事实在 main（chat_sessions、run 记录）                |
| 条目树、Canvas 概览              | `workspace/store.ts`（zustand 镜像）     | 事实在 main DB，经 `workspace:get-state`              |
| 笔记草稿与保存队列               | `workspace/drafts.ts`（zustand）         | IPC `workspace:save-note`（防抖 600ms，语义不变）     |
| 聊天输入草稿、@ 引用、附件 chip  | `content/chat/drafts.ts` + `use-chat.ts` | localStorage + `chat:stage/release-media`（现状保留） |
| 光标/滚动/撤销历史               | 内容组件本地（按 TabId+groupId 键控）    | 不持久化（滚动可并入 layout 附带，阶段三定）          |
| 设置（主题/缩放/通知偏好…）      | 无 renderer store，设置页直连 IPC        | main DB                                               |

判断规则：**renderer 永远只持有视图状态和镜像**；凡是"关掉应用后还应存在"的事实（会话、Run、条目、布局、设置）都以 main 为唯一事实来源，renderer 经 IPC 读写或订阅。

### 3.6 设置页重构结构（§4.4）

```
features/settings/
  SettingsView.tsx          # 保留"分类侧栏 + 右侧内容页"骨架；接入 sectionRequest 与设置搜索
  SettingsNav.tsx           # 分类改为：通用/外观/通知/工作区/模型服务/连接/插件/关于
  SettingsSearch.tsx        # 新增：按分类、选项名、关键词过滤（§4.4 查找与直达）
  connections/              # ConnectionsSection 拆分 + 收编 CanvasTokenForm
    ConnectionsSection.tsx  # Canvas/邮箱/教务/水源四张连接卡的容器
    CanvasTokenForm.tsx  canvas-connect.ts
  sections/
    GeneralSection.tsx      # 保留
    AppearanceSection.tsx   # 保留
    NotificationsSection.tsx# 新增：校园消息 + Agent 任务通知偏好、暂停通知（与通知中心同状态源）
    WorkspaceSection.tsx    # 新增：工作目录（自 ConnectionsSection 迁入）、启动恢复、默认编辑方式、布局重置
    LlmSection.tsx          # 保留（模型服务）
    PluginsSection.tsx      # 扩展：内部按 Skills / MCP / 自定义指令三类型切换
    AboutSection.tsx        # 保留
  SectionHeader.tsx  credits.ts  INTERFACES.md   # 保留；INTERFACES.md 随通道变化同步
```

`SettingsSectionId` 扩为 `'general' | 'appearance' | 'notifications' | 'workspace' | 'llm' | 'connections' | 'plugins' | 'about'`；`GlobalSearchResult` 的 setting 目标随之更新，全局搜索、错误引导直达链接同步（§4.4 迁移要求）。main 侧对应新增 `src/main/settings/ipc.ts`（§2.4）。

---

## 4. shared 契约拆分

`src/shared/api.ts`（897 行）按领域拆为平铺文件（与现有 `resources.ts`/`todo.ts`/`schedule.ts` 惯例一致，不再嵌套子目录）；`api.ts` 收缩为聚合接口。

| 现 api.ts 中的块（大致行号）                                                                                          | 新文件                                                           | 内容                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WindowState`/`TrayAction`/`WindowApi`（3–16）                                                                        | `shared/window.ts`                                               |                                                                                                                                                                                                 |
| `SettingsApi` + 主题/图标/缩放/字号类型与常量（452–475）                                                              | `shared/settings.ts`                                             | 含扩展后的 `SettingsSectionId`                                                                                                                                                                  |
| `LlmProviderView`/`LlmApi` 等（477–529）                                                                              | `shared/llm.ts`                                                  |                                                                                                                                                                                                 |
| Mail 全部（18–177）                                                                                                   | `shared/mail.ts`                                                 | 约 160 行，MailApi 及载荷                                                                                                                                                                       |
| Timetable + CalendarEvent（179–254）                                                                                  | `shared/timetable.ts`                                            | `calendarEventColors` 常量随行                                                                                                                                                                  |
| Shuiyuan 全部（258–450）                                                                                              | `shared/shuiyuan.ts`                                             | 约 190 行                                                                                                                                                                                       |
| `CanvasApi`/`CanvasState`/`SourceItem`（643–714）                                                                     | `shared/canvas.ts`                                               |                                                                                                                                                                                                 |
| `DocumentContent`/`OfficeExport*`（671–702，被 canvas/workspace/shuiyuan 共用）                                       | `shared/documents.ts`                                            | 跨域文档载荷独立成文件                                                                                                                                                                          |
| `WorkspaceApi`/`WorkspaceEntry`/`WorkspaceState`/`WorkspaceViewState`/`workspaceArchiveId`（716–792，剔除 chat 通道） | `shared/workspace.ts`                                            | 只留条目/文件/视图相关                                                                                                                                                                          |
| `ChatApi`（媒体/指令，588–623 中非会话部分）                                                                          | `shared/chat.ts`                                                 | `ChatAskInput`/`ChatMediaView`/`ChatCommandView`                                                                                                                                                |
| `WorkspaceChat`/`AgentToolResult`/`ChatSessionSummary`（794–848）+ 新 Session/Run 视图                                | `shared/session.ts`                                              | **新增**：`SessionApi`（`list/create/open/remove/ask/cancelRun/onSessionUpdate/onRunEvent`）、`RunEvent` 联合类型；`WorkspaceChat` 更名 `SessionView` 并按 Session→Run 语义重整（阶段一定契约） |
| `TodoApi`/`TodoItem` 等（850–897）                                                                                    | `shared/todo.ts`（类型并入现有文件，现 shared/todo.ts 是纯逻辑） |                                                                                                                                                                                                 |
| `NotificationsApi`（554–586）                                                                                         | `shared/notifications.ts`                                        |                                                                                                                                                                                                 |
| `SearchApi`/`GlobalSearchResult`（534–552）                                                                           | `shared/search.ts`                                               | setting 目标类型随 §3.6 更新                                                                                                                                                                    |
| `DelaApi` 聚合（625–641）                                                                                             | `shared/api.ts`（保留）                                          | 只 import 各领域 Api 接口并聚合；renderer `env.d.ts` 与 preload `satisfies` 不变                                                                                                                |
| 布局载荷（新增）                                                                                                      | `shared/layout.ts`                                               | `WorkbenchLayout` 持久化类型与 `LayoutApi`（get/save，按项目）                                                                                                                                  |

拆分规则：类型跟着唯一拥有其事实的进程侧走——`SessionView`/`RunEvent` 归 session（main 拥有），`WorkspaceViewState` 改为 `shared/layout.ts`（main 只存不解）。`shared/` 不出现任何实现，纯类型与常量。

---

## 5. preload 面

### 5.1 拆分结构（面不变，先做纯机械拆分）

```
src/preload/
  index.ts            # contextBridge.exposeInMainWorld('dela', {...})，只做组装，satisfies DelaApi 不变
  lib.ts              # invoke/on 封装：channel 工厂与退订函数，消除 293 行里的重复样板
  window.ts  settings.ts  llm.ts  chat.ts  mail.ts  timetable.ts  shuiyuan.ts
  canvas.ts  workspace.ts  session.ts  layout.ts  todo.ts  notifications.ts  search.ts
```

现有分组（todo/search/notifications/window/settings/llm/chat/mail/timetable/shuiyuan/canvas/workspace）一一对应拆文件，方法集合不变。

### 5.2 新增通道（随阶段启用，未上线前不暴露）

| 通道组               | 方法                                                                                                                                                             | 阶段                                       | 替换谁                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session:*`          | `list(projectId)`、`create(projectId)`、`open(sessionId)`、`remove(sessionId)`、`ask(sessionId, input)`、`cancelRun(sessionId)`、`onSessionUpdate`、`onRunEvent` | 阶段一–二（main）→ 阶段三（renderer 接入） | `workspace:get-chat/new-chat/list-chats/open-chat/delete-chat/ask/cancel-ask` + `workspace:chat-update` 共 8 个通道（7 invoke + 1 订阅；`editAsk` 复用 `workspace:ask`） |
| `layout:*`           | `get(projectId)`、`save(projectId, state)`                                                                                                                       | 阶段三                                     | `workspace:save-view`                                                                                                                                                    |
| `settings:*`（扩展） | `getTaskNotifications`/`setTaskNotifications`、`getWorkspacePrefs`/`setWorkspacePrefs`                                                                           | 阶段三                                     | 新增（§4.4 通知/工作现场偏好）                                                                                                                                           |
| `capabilities:*`     | `list/add/remove/setEnabled/inspect`                                                                                                                             | 阶段四                                     | 新增（MCP/Skills 管理）                                                                                                                                                  |

### 5.3 退役通道与"有限 API"原则

- 旧 `workspace:chat-*` 通道保留到阶段三 renderer 迁移完成的同一提交删除——双通道期只允许 main 同时实现，不允许 renderer 同时调用新旧两套。
- preload 继续只做透传与类型标注，不写业务逻辑；新增通道必须先在 `shared/` 有类型、在 `docs/refactor` 或 INTERFACES 有记录，才进 `index.ts`。
- 阶段四前 `capabilities:*` 不出现在 preload——未实现的协议不暴露开关（§4.4 红线）。

---

## 6. 迁移映射总表与步骤

分五步，与计划 §7 阶段对齐。**每步都是可独立构建、测试通过的提交序列**；纯搬迁类拆分当提交删除旧文件，不留 re-export 垫片（计划要求同步清理失效入口）。

### 第 0 步：契约与桥的机械拆分（先行，行为零变化）

| 旧文件                           | 新文件                                  | 退役时机                      |
| -------------------------------- | --------------------------------------- | ----------------------------- |
| `src/shared/api.ts`（897 行）    | §4 的 14 个领域文件 + 瘦身后的 `api.ts` | 同提交（`api.ts` 保留为聚合） |
| `src/preload/index.ts`（293 行） | §5.1 的拆分文件                         | 同提交                        |

### 第 1 步（阶段一）：main/agent 立目录 + Pi 最小接入

| 旧文件                                              | 新文件                                                                                                                                      | 退役时机                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `agent/tools.ts`                                    | `tools/registry.ts` + `tools/shared.ts` + 7 个领域目录（§2.2 表）                                                                           | 同提交删除                                                 |
| `agent/web-search.ts`                               | `tools/web/web-search.ts` + `tools/web/fetch-page.ts`                                                                                       | 同提交删除                                                 |
| `agent/loop.ts`                                     | `core/run.ts` + `core/stream.ts`；新增 `core/pi.ts` 做最小接入验证                                                                          | 同提交删除；Pi 验证结论决定 run.ts 与 stream.ts 的最终关系 |
| `agent/api.ts`                                      | `session/store.ts`、`session/manager.ts`、`session/commands.ts`、`session/subscriptions.ts`、`context/references.ts`、`context/assemble.ts` | 同提交删除；`slice(-12)` 原样留在 assemble.ts 并标注待替换 |
| `agent/providers.ts`                                | `core/providers.ts`                                                                                                                         | 同提交删除                                                 |
| `agent/media.ts`                                    | `session/media.ts`                                                                                                                          | 同提交删除                                                 |
| `agent/ipc.ts`                                      | `session/ipc.ts` + 新 `agent/index.ts` 组装；`main/index.ts` 改直接 import agent                                                            | 同提交删除                                                 |
| `agent/test/*.test.ts`                              | 就近迁入各目录 `test/`                                                                                                                      | 同提交删除旧目录                                           |
| `workspace/ipc.ts` 中 `registerAgentIpc()` 转手调用 | 移除（main/index.ts 直接调用）                                                                                                              | 同提交                                                     |

阶段一同时产出：`session/manager.ts` 持有 Run 语义初版（`runs.ts` 可先为空壳记录现状 `asking` Map），工具缺口清单（§5.2 第一阶段交付）。

### 第 2 步（阶段二）：执行与业务闭环

新增 `session/runs.ts`（Run 持久化）、`context/budget.ts`、`context/compaction.ts`（替换 slice(-12)）、`tools/shuiyuan/`、`tools/common/discover.ts`、`tools/common/edit.ts` 局部修改；`shared/session.ts` 的 `SessionApi`/`RunEvent` 上线，`session/ipc.ts` 注册 `session:*` 新通道（旧通道并存，renderer 未动）。DB 迁移：`chat_sessions.scope` → `project_id`（先备份；写入路径一次性切换到新会话身份，不出现新旧两套写入路径同时处理同一请求）。

### 第 3 步（阶段三）：renderer 统一工作台

| 旧文件                                                                                         | 新文件                                                                                                                                                                                                                 | 退役时机                                                                    |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `App.tsx`（492）                                                                               | `app/App.tsx` + `app/navigation.ts` + `app/theme.ts` + `app/notifications.ts`                                                                                                                                          | 已完成于 3B                                                                 |
| `AppShell.tsx` 中项目列表/通知计数段                                                           | `navigation/ProjectSessionNav.tsx`；AppShell 瘦身为纯 chrome                                                                                                                                                           | 已完成于 3B                                                                 |
| `features/projects/ProjectView.tsx`（1799）                                                    | 布局/标签 → `workbench/*`；目录侧栏 → `navigation/*`；modal → `workspace/entry-dialogs.tsx`；动作 → `workspace/entry-actions.ts`；助手挂载 → 删除（chat 成为标签）；快捷键 → `workbench/`（布局类）与 `app/`（导航类） | 已完成于 3C                                                                 |
| `features/projects/workspace.ts`                                                               | `workspace/store.ts` + `workspace/drafts.ts`                                                                                                                                                                           | 已完成于 3C                                                                 |
| `features/projects/ProjectSidebar.tsx`                                                         | `navigation/ProjectFileTree.tsx`                                                                                                                                                                                       | 已完成于 3C                                                                 |
| `features/projects/ProjectDocument.tsx`                                                        | `content/note/NoteTab.tsx` + `content/note/document-toolbar.tsx` + `content/preview/PreviewTab.tsx`                                                                                                                    | 已完成于 3C                                                                 |
| `features/projects/MarkdownEditor.tsx`、`NoteEditor.tsx`、`note-editor.css`                    | `content/note/` 平移                                                                                                                                                                                                   | 已完成于 3C（note-editor.test.ts 同步迁移）                                 |
| `features/projects/AgentPanel.tsx`                                                             | `content/chat/ChatTab.tsx`                                                                                                                                                                                             | 已完成于 3C                                                                 |
| `features/chat/*`                                                                              | `content/chat/*` 平移；`use-chat.ts` 改 sessionId 签名                                                                                                                                                                 | 已完成于 3C                                                                 |
| `features/sources/SourceList.tsx`                                                              | `navigation/SourcesTree.tsx`                                                                                                                                                                                           | 已完成于 3C                                                                 |
| `features/sources/SourceDetail.tsx` 及预览组件                                                 | `content/preview/*`                                                                                                                                                                                                    | 已完成于 3C（sheet-preview.test.ts 同步迁移）                               |
| `features/sources/CanvasTokenForm.tsx`、`canvas-connect.ts`                                    | `features/settings/connections/`                                                                                                                                                                                       | 已完成于 3C                                                                 |
| `features/sources/SourcesView.tsx`、`features/home/HomeView.tsx`、`features/projects/index.ts` | 无后继（职责并入 navigation + workbench）                                                                                                                                                                              | 已完成于 3C                                                                 |
| `settings/*`                                                                                   | §3.6 结构；`SettingsNav` 八分类、新增两 Section、SettingsSearch                                                                                                                                                        | 已完成于 3B                                                                 |
| `workspace:save-view` / `view:%` 数据                                                          | `layout:*` / `layout:{projectId}`；`layout-schema.ts` 提供旧数据种子函数                                                                                                                                               | 已完成于 3C（写通道删除；`view:%` 仅剩 getWorkspaceState 读路径作布局种子） |
| `dela.editor.layout.*`、`dela.workspace.agentOpen/agentWidth` localStorage                     | layout store 迁移函数消费后清理                                                                                                                                                                                        | 已完成于 3C（首次 layout:save 成功后清除旧键）                              |

### 第 4 步（阶段四）：capabilities/ 填充（mcp/、skills/ 实现 + `capabilities:*` 通道 + PluginsSection 三类型管理）。

### 6.1 迁移期安全规则

- 运行与写入路径切换时避免新旧实现同时执行同一请求：`ask` 通道在阶段二切换为 session 身份时，`workspace:ask` 旧通道内部直接委托新实现（不保留两份循环）。
- 每步完成依据对齐计划 §7 表：第 1 步以"现有模型服务流式/工具/中断/续接验证"收口，第 3 步以五类工作流场景收口，不以"文件搬完"为完成。
- 动画、拖拽过渡与视线稳定性由用户实机审阅（AGENTS.md 约束），不写探针脚本。

---

## 7. 依赖规则红线与检查方式

### 7.1 红线清单

1. **renderer 不 import main，不访问凭据与数据库**：renderer/preload 只 import `src/shared/**` 的类型与常量；`src/renderer/**` 出现 `../main` 或 `../preload` import 即违规。
2. **preload 保持有限面**：只透传 `shared/` 中声明的通道；新增通道必须同步类型与文档。
3. **main 内单向依赖**：`agent/index.ts → {core, session, context, tools, capabilities}`；`session → core/context/tools(registry)/capabilities(仅 skillIndex)`；`context → core(仅 budget)/业务读取 API`；`tools → 业务 API`；`capabilities → tools/registry 与 shared`（单向——MCP 工具并集与路由经 `setMcpRouting` 注入，registry 不 import capabilities；领域工具的 `AgentTool` 类型在 `tools/shared.ts`）；反向全部禁止。业务目录不 import `agent/`，跨层错误码契约统一在 `shared/tool-errors.ts`。
4. **tools 领域间不互相 import**；共享工具只进 `tools/shared.ts`。
5. **content 域间不互相 import**；workbench 对 content 的引用只经 `workbench/registry.ts`。
6. **features/（业务视图）与 workbench/ 互不 import**：业务数据经 `workspace/`、`sessions/` 镜像或 props 传入。
7. **无循环依赖**：任何两个文件之间不允许出现环（含类型 import）。

### 7.2 检查方式建议

- **边界（规则 1/3/4/5/6）**：在 `.oxlintrc.json` 用 `no-restricted-imports` 配置 paths/groups（oxlint 已支持该规则），按目录配禁入模式：renderer 禁 `**/main/**`、`**/preload/**`；`agent/core/**` 禁 `**/session/**`、`**/tools/**`、`**/context/**`；`agent/tools/*/**` 禁 `**/core/**`、`**/session/**`、`**/context/**` 与兄弟领域目录；`content/*/**` 禁兄弟内容目录；`src/main/{canvas,mail,timetable,shuiyuan,workspace,todo}/**` 禁 `**/agent/**`。违规在 lint 即报，进 `.github/workflows/check.yaml`。
- **循环（规则 7）**：加 `pnpm check:deps` 脚本运行 `dpdm src/main/index.ts src/preload/index.ts src/renderer/main.tsx --cyclic --tree false`（或 `madge --circular --ts`），退出码非零即失败，纳入 check.yaml。选 dpdm 因零配置支持 TS 路径且能区分类型依赖。
- **面收敛（规则 2）**：preload `index.ts` 的 `satisfies DelaApi` 保留为编译期断言；review 约定新通道必须同时改 `shared/` 类型与 INTERFACES/本文档。
- 各阶段收口时在 devlog 记录一次 `check:deps` 与 lint 输出作为结构验收证据。

---

## 8. 与计划的对接

- 本文目录即计划 §7 各阶段"目录归属、模块依赖、可独立调试性"检查的验收基准；每阶段完成后按本文核对，偏差记入 devlog 并回写本文。
- 计划 §8 待确认事项（每项目布局与跨项目混排、Pi 版本、分屏库选型等）不影响目录结构本身：布局树类型已预留嵌套，分屏实现库（自研或第三方）都落在 `workbench/SplitNode.tsx` + `tab-dnd.ts` 两个文件内替换。
- 本文不改变 `docs/technical-plan.md` 的进程边界与数据保护约束；与其冲突处以 agent-workspace-plan.md 为准。
