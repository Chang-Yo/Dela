# 开发记录

按日期记录 Dela 的功能演进、关键设计裁决与验证边界。本文是[技术规划书](technical-plan.md)的过程侧补充：规划书描述"是什么、为什么"，本文记录"何时做了什么、验证到什么程度"。

约定：

- 每节区分**已验证**（真实环境/自动化确认）与**待验证**（仅在脱敏桩或推理层面确认），不把占位结果当作完成。
- 2026-09-18 文档精简时，此前的长篇记录收敛为要点；逐条实现细节可在 git 历史中查回。
- 冒烟脚本（`smoke` / `smoke:workspace` / `smoke:pdf` / `smoke:shuiyuan` / `mail-smoke` / `chat-smoke`）的含义见[开发指南](development.md)。

---

## 2026-09-29（第十四轮）旧 features 退役与通道收敛：home/projects/sources/chat 删除、旧 scope 通道与 save-view 下线（阶段三·批次 3C）

落实 [structure.md](refactor/structure.md) §6 第 3 步表与批次 3B 残留清单。应用已在 3B 切到 app/workbench/content/sessions/navigation/workspace 新架构，本批逐项 grep 验证零活引用后删除死代码并收敛旧通道。

- **旧 features 全删**（37 文件）：`features/home/**`、`features/projects/**`（ProjectView/workspace/ProjectSidebar/ProjectDocument/AgentPanel/MarkdownEditor/NoteEditor/note-editor.css/index.ts 与旧 workspace.test.ts）、`features/sources/**`（SourcesView/SourceList/SourceDetail/CanvasTokenForm/canvas-connect/PdfReader/DocxPreview/SheetPreview/OfficePrompt/use-pinch-zoom/index.ts）、`features/chat/**` 全部。测试迁移：`note-editor.test.ts` → `content/note/`、`sheet-preview.test.ts` → `content/preview/`（两者相对导入同名文件，原样迁移；新目录此前无对应覆盖）。`workspace.test.ts` 场景已在 3A 移植进 `renderer/workspace/test/`，旧文件直接删。
- **活引用改指**（删除前的 grep 验出，共 9 个文件）：`features/shuiyuan`（store/ReplyComposer/BindCard/NewMessageDialog/AddToProjectDialog）与 onboarding 四个 Step 的 `errorText` 改自 `workspace/store`；`MarkdownEditor` 改自 `content/note`（与旧文件逐字节一致）；AddToProjectDialog 的 `useWorkspace` → `useWorkspaceStore`（同字段签名）。onboarding CanvasStep 确认已指 `settings/connections`（3B 完成），仅剩 errorText 改指。
- **旧 scope 通道下线**（`workspace:get-chat/new-chat/list-chats/open-chat/delete-chat/ask/cancel-ask` 7 个 invoke + preload 方法 + `WorkspaceApi` 对应签名）：main 侧删除 `session/manager.ts` 的 shim 段（scopeToProjectId/scopeBusy/newChat/openChat/deleteChat/listChats/cancelAsk/ask）、`session/ipc.ts` 的 workspace:* handle 包装、`store.ts` 的 `activeSession`/`resolveSession`/`getChat`、`subscriptions.ts` 的 `originScopes` 机制与 `publishChat`。**保留 `workspace:chat-update` 推送**：唯一活订阅者是 TimetableView（run 结束后刷新课表，agent 可能写日历），`publishSession` 改从 `session.project_id ?? 'home'` 推导 scope（originScopes 随旧 ask 通道删除而失去写者），preload `onChatUpdate` 与 `WorkspaceApi.onChatUpdate` 保留并在注释标注迁移方向（TimetableView 改订阅 session:on-run-event 终态后删除）。
- **`workspace:save-view` 通道删除**：旧 ProjectView 是唯一写者。删 preload `saveView`、`WorkspaceApi.saveView`、main ipc handle 与 `saveWorkspaceView`；`view:%` 读路径保留（getWorkspaceState 仍返回 views 供 workbench 布局种子）。`shared/api.ts` 聚合中 `WorkspaceViewState` re-export 变零消费，一并移除（类型本体留在 shared/workspace.ts 供 WorkspaceState.views）。
- **localStorage 死键清理**（layout-store.ts）：init 记录本项目的旧 scope，首次 `layout:save` 成功后清除 `dela.editor.layout.{scope}` 与助手面板死键 `dela.workspace.agentOpen/agentWidth`（读取残留随 ProjectView 删除已不存在）；保存失败不清理，快速切换项目时只清最后落库项目的键，未保存项目的旧键保留供下次种子。新增单测覆盖「失败保留、成功清除」。
- **测试调整**：manager.test.ts 删除 7 项旧 scope shim 用例（activeSession 指针/互斥/懒创建语义随通道消亡），新增 2 项 newSession 项目归属用例（补建档案行、非 project 条目拒绝）保住仍存活语义的覆盖；integration.test.ts 的 `workspace:chat-update` 断言不改（通用会话推导 scope='home'，行为不变）。pdf-smoke 删除 `workspace:save-view` mock 路由（因本批失效）；chat-smoke/shuiyuan-smoke 中 `workspace:get-chat` mock 自 3B 起已无人调用，属预存残留未动。
- 已验证：`pnpm typecheck` 三组零错、oxlint 0 警告、52 文件 461 项单测全绿（468 − 7 shim − 3 旧 workspace.test 重复 + 3 新增）、`pnpm build` 三 bundle、`pnpm smoke`（SQLite/renderer/preload 隔离）通过。待验证（实机）：TimetableView 经保留推送的课表刷新；旧用户首次进入项目后 localStorage 旧键清除（自动化仅 jsdom 级）。

## 2026-09-29（第十三轮）设置域重构：八分类、搜索直达、通知/工作区偏好与 run 终态提醒（阶段三·批次 3B）

落实 [重构计划](agent-workspace-plan.md) §4.4 与 [structure.md](refactor/structure.md) §3.6/§2.4。`SettingsSectionId` 扩为 `general|appearance|notifications|workspace|llm|connections|plugins|about`；「数据与服务」拆解（工作目录→工作区；Canvas/邮箱/教务/水源四卡→连接）；`features/settings/` 重组为 `sections/`（七 Section）+ `connections/`（收编自 sources 复制迁入的 CanvasTokenForm/canvas-connect，原文件留待 3C 删除，首启向导 CanvasStep 已改指新处）。

- **main 侧新目录 `src/main/settings/`**：`prefs.ts`（workspace_settings 读写：自 main/index.ts 迁出的主题/图标/缩放/字号/自启读取助手 + 新偏好）、`ipc.ts`（`registerSettingsIpc` 整体迁出，既有 10 通道行为不变；新增 `settings:get/set-campus-notifications`、`settings:get/set-task-notifications`、`settings:get/set-workspace-prefs` 六个处理器，全部 zod 校验）、`task-notify.ts`（run 终态提醒）、`index.ts`（对 main/index.ts 的组装出口：`registerSettingsIpc` + `readSetting`/`savedTheme`/`savedIcon`/`savedZoom`）。**main/index.ts 的内联设置段暂留原处**（该文件归并行批次，未接线；协调方需删除内联段并改为从 `./settings` import——同文件内两份 registerSettingsIpc 不会共存运行，接线前新通道不可用、旧通道行为不变）。
- **任务通知（真实新能力）**：偏好键 `task-notifications`（JSON `{completed, failed}`，默认 failed=true/completed=false，低干扰原则）；`session/manager.ts` 的 askSession finally 在 `finishRun` 后对 completed/failed 调 `notifyRunFinished`（stopped 不提醒）——读偏好→取会话标题→`system-notify.ts` 新增 `systemNotifyToast`（复用既有 armed 启动基线/暂停/窗口聚焦守卫，点击仅唤起主窗口）；任何读取/弹出失败静默，不影响 Run 落库与推送。
- **校园消息系统提醒**：偏好键 `campus-notifications`（'0' 关闭，缺省开启=现行为）；`systemNotifyItem` 增加该守卫——关闭只停桌面弹窗，通知收集与应用内列表不受影响。此通道为批次说明之外的新增（任务只点名 4 个新通道，但 §4.4 通知分类要求「校园消息提醒偏好」）。
- **暂停通知共用状态**：通知 Section 直接读写 `notifications:set-snooze` / `getState().snoozedUntil` 并订阅 `notifications:state` 广播——与通知中心**同一份** `notifications-snoozed-until` 键，无第二开关，两端实时同步。
- **工作区偏好**：键 `workspace-prefs`（JSON，缺省 `{restoreLastProject: true, defaultNoteEditMode: 'rich'}`，恢复默认与现行为一致）；`setWorkspacePrefs` 支持部分合并。工作目录卡自旧 ConnectionsSection 迁入；布局重置经现有 `layout:save` 把当前项目布局写回默认单组（两步确认；当前项目读 `localStorage['dela.workspace.project']`，与 app/navigation 的持久化键一致，空串=通用池 `_general`）。
- **插件三类型骨架**：内部按 自定义指令（现功能原样迁入）/ Skills / MCP 切换；后两者只显示「即将支持（阶段四交付）」说明，无任何开关（「未实现不展示」红线）。
- **搜索直达**：`SettingsSearch`（内容区顶部 sticky 搜索框 + 键盘导航下拉）按分类/选项标题/关键词过滤单一索引 `search-index.ts`（内置同义词表：主题→外观、API→模型服务、邮件→连接等；校园提醒卡刻意不含「邮件/水源」词，避免抢连接页目标），选中跳转 section 并给目标卡片 `data-setting-id` 加 1.8s ring 高亮 + scrollIntoView。全局搜索的 setting 入口改由同一索引派生（`settingsResultsFor` 按分类聚合，GlobalSearchDialog 删除本地重复表）——主进程 `search.ts` 本就不含 setting 目标（批次说明的「main 侧」定位有误，实际同步点是渲染层静态表）。
- **行为红线核对**：简单偏好全部即时保存（开关/select 失败回滚原值并就地报错，无保存按钮）；主题/缩放/自启/模型服务等旧偏好键原样沿用（迁移零丢失）；错误引导「设置 › 模型服务」无需改动（section id `llm` 未变，llm 根节点带高亮锚点）。
- 已验证：`pnpm typecheck` 三组零错、oxlint 0 警告、prettier（仅本批文件）、`pnpm build` 三 bundle、全量 468 项单测（新增 prefs 9、task-notify 5、search-index 9）；app/App.tsx（并行批次）传入的 SettingsView props 与本批签名兼容。待验证（实机审阅）：搜索高亮 ring 观感、通知/工作区各开关保存反馈、插件页签切换。待接线（协调方）：main/index.ts 设置段替换为 `./settings` import、app 启动消费 `getWorkspacePrefs()` 导航、content/note NoteTab 初始模式读 `defaultNoteEditMode`、3C 删除 sources 下 CanvasTokenForm/canvas-connect 旧文件。

## 2026-09-29（第十二轮）应用装配切换：App 从旧三视图切到统一工作台（阶段三·批次 3B）

切换批次：新入口 `src/renderer/app/` 落地并挂载，旧 `src/renderer/App.tsx` 删除（内容全部迁走）；3A 交付的 workbench/sessions/content/workspace/navigation 模块全部接通。features/** 旧文件原样保留，统一在批次 3C 退役。

- **app/ 拆分**（structure.md §3.1，实际新增三个装配文件）：`navigation.ts` 视图路由 zustand——`view: 'workbench'|'mail'|'timetable'|'shuiyuan'|'todo'|'notifications'|'settings'`（'workbench' 统一取代旧 home/project/sources 三视图）+ back/forward 栈 + 当前项目（localStorage 键沿用 `dela.workspace.project`，null=通用池）+ 一次性定位脉冲（旧五类 chatRequest/mailRequest/todoRequest/settingsRequest/createProject 全部迁入，另增 reveal/generalChat 两个由工作台消费的脉冲）；`theme.ts`（主题/缩放/字号 effects 与 localStorage 镜像）；`notifications.ts`（通知镜像订阅、60s 暂停到期重读、桌面通知 onOpen 跳转经 navigation）；`App.tsx` 根组件（launch 阶段/onboarding/视图切换动画保持旧行为，含会话静默后的条目+Canvas+干净草稿刷新、beforeunload 草稿守卫、Ctrl+K）。
- **工作台装配**（`workbench-shell.tsx`）：三个 Provider 挂工作台根部。ChatTabSource：referenceSource 候选=打开中标签的草稿标题优先+可读条目（note/imported/source，覆盖 Canvas 与水源引用条目，即旧 AgentPanel 拼装）、flushReference=草稿 save 失败抛错阻止发送（旧 use-chat 语义）、mailDialog=`mail-draft-dialog.tsx`（MailComposer 包装为自包含弹窗：openDraft+账号校验+leaveComposer 关闭守卫，即旧 ChatThread 内联 Dialog 段）、onOpenSource→openDocument 脉冲、onSaveNote→prefillNoteText 新建笔记弹窗；NoteDraftSource←workspace/drafts（acquire/edit/save/release/saveAsNewNote 直连）；ContentLoader：source:→canvas.read/水源 readSource、条目→workspace.read，officeRef（pptx）/watchesDisk（local/imported）/resolveImage（本地 Markdown 图片）与旧 ProjectDocument 同规则，openLink 保留 oc.sjtu.edu.cn files 站内分流，onExported 刷新条目树。`registry.ts` 标题解析接镜像（条目名/Canvas 资料名/会话标题；镜像变化的重渲染由 shell 订阅 entries/lists 触发）。
- **目录侧栏**（`workbench-explorer.tsx`，替代旧 ProjectView/SourcesView 的 aside）：ProjectFileTree（项目模式 rootId=项目，通用模式根树）+ SourcesTree（课程资料，含刷新课程/连接 Canvas/按来源分组）+ 归档区；树状态用 navigation/store；EntryDialogs 接线（onCreated 展开父级+打开新笔记，onRemoved 清理已删条目标签+退出已删项目回通用池）；「在另一栏打开」=openTab+splitGroup。折叠态展开入口挂标题栏 `#titlebar-actions` portal（旧版在标签栏左端，TabBar 属 3A 冻结件）。
- **AppShell 瘦身**：移除 useWorkspace 订阅、项目列表、「保存所有已打开笔记」（草稿自动保存取代，Ctrl+S 菜单项同步删除）；挂 ProjectSessionNav（sessions/runs 镜像数据与回调由 App 装配经 props 传入，AppShell 保持零 store 依赖）；标题菜单收敛为 文件/视图/帮助，Ctrl+1/2/3=工作台/邮箱/课表；邮箱移动端抽屉槽与标题栏 portal 机制保留。
- **深链与托盘**：全局搜索 chat 深链的旧 scope 归一（home/sources/未知项目→通用池，旧「项目已不存在」错误态随会话新身份删除）；course-file→当前工作台开 preview:source 标签；note→openNote 按条目祖先自动归属项目；mail/todo/settings→对应视图+定位脉冲；通知点击同路径。托盘「新建对话」→openGeneralChat(true) 新建通用会话，「新建项目」→工作台新建项目弹窗——main 侧零改动（载荷复用）。
- **通用聊天与项目会话**：导航「通用聊天」=定位已有的通用会话标签（无则新建）；项目下 ChatTab 新会话经 Provider 的 projectId 自动归属项目（session.create(projectId)）。
- 修复一处装配层 bug：zustand 选择器内 `.filter()` 返回新数组触发 useSyncExternalStore 死循环（React #185），选择器改为返回稳定引用、过滤移到渲染期。
- 已验证：`pnpm vitest run` 53 文件 468 项全绿；三 bundle vite 构建通过；`pnpm smoke`（打包产物）通过——SQLite/renderer/preload 隔离检查全过；dev 模式 smoke 实证旧 'sources' 视图种子迁移（布局种子+笔记标签渲染走通）。`pnpm typecheck` 除并行设置批次 in-flight 的 `features/settings/search-index.test.ts`（2 个错，非本批文件）外零错；本批文件 oxlint 0 警告（全仓 lint 的 1 个警告同样来自并行批次的 `main/settings/ipc.ts` 未用 import）。待验证（用户实机审阅清单见批次汇报）：布局拖拽与动画视线、目录侧栏折叠动线、项目切换工作现场恢复、通知/搜索深链实跳。

## 2026-09-29（第十一轮）上下文压缩落地：按预算触发替代固定 12 条窗口（阶段二·批次 2C）

落实 [重构计划](agent-workspace-plan.md) §6.1 与 [decisions-phase1.md](refactor/decisions-phase1.md) 批次 2B 压缩骨架的完整实现，`historyWindow` 的 `slice(-12)` 退役删除。按目录拆分：`context/budget.ts`（估算与预算口径）、`context/compaction.ts`（摘要生成）、`context/assemble.ts` 重写（预算组装），`session/{manager,store}.ts` 接线，`core/{run,pi}.ts` 加运行内修剪。

- **预算口径**（budget.ts）：token 启发式估算——CJK 1 token/字、其他 4 字符/token、图片固定 1000 token/张；窗口保守常量 32768（后续接 provider 配置，不按模型名猜测）；预留 = 输出 8192 + 工具交互余量 4096，输入预算 20480；触发阈值 = 预算 × 0.7 = 14336，另为摘要块预留 2048（摘要请求 max_tokens 1536 封顶，保证摘要永远放得进预留）。
- **摘要生成**（compaction.ts）：独立非流式 fetch POST 到 provider 的 `/chat/completions`（不走 Pi、无工具、120s 超时、失败抛错）。摘要 JSON 存 `sessions.summary`：`{ coveredUpTo（覆盖到的消息索引锚点）, createdAt, model, content: { goals, decisions, completed, pending, resources[] }, messageCount }`，六要素覆盖计划 §6.1「保留任务连续性」；提示词要求只从给定历史提取、不虚构、资料内指令不算用户要求、未完成不得写成已完成；附带旧摘要时合并覆盖（增量压缩不丢早期要素）；输出剥离 ```json 围栏后经 zod 校验。
- **组装**（assemble.ts）：system + 摘要前置块（存在且锚点未超过当前历史长度时合并进 system，明确标注「历史摘要，非资源最新状态」）+ 从最新向前按预算容纳的完整历史（选择起点为摘要锚点，不重复注入已摘要区间）+ 本轮引用前言与用户消息（永不压缩或丢弃）；预算内全部保留（20 条小历史全量注入，无 12 条上限）；最新一条历史单独超限时截断并标注（沿用「请用更具体的过滤或分页参数重新查询」语义）；本轮输入加 system 超出预算时明确抛错，不静默截断。
- **接线**（manager.ts）：askSession 在 runAgent 前读 `sessions.summary` → 估算（system+摘要+全量历史+本轮+工具定义）→ 超阈值时计算覆盖范围（放不进触发阈值的较早历史前缀）→ 压缩期间快照带 `compacting: true`（store 的 `compactingSessions` 集合，沿用现有推送通道，`WorkspaceChat` 仅可选追加字段）→ 成功才持久化摘要并以新上下文组装；失败且不压缩也放得下（估算 ≤ 预算）照常发送全量历史，失败且放不下则本次请求明确报「上下文压缩失败，请重试或减少引用资料」，不静默回退条数截断。摘要跨 Run 生效：重启后新 Run 从持久历史 + 摘要重建（现有逻辑），下次 ask 直接读取。
- **运行内修剪**（pi.ts + run.ts 可选 `prunePolicy`）：Pi Agent 的 `transformContext` 钩子在每次模型请求前估算消息总量，超预算时把较早轮次（最近 2 轮完整）的工具结果内容替换为「[已修剪的工具结果：工具名，关键结果保留前 500 字符]」占位（图片一并剥离），不做运行中模型调用；返回值只影响发出的请求、不改会话状态。`prunePolicy` 缺省时不挂钩子，runAgent 签名与缺省行为不变。
- 已验证：context/session/core 全部 21 个测试文件 216 项单测（新增 budget 6、compaction 7、assemble 11、prune 5、manager 压缩 5；摘要模型调用全部 fetch stub 不走真网）、`pnpm typecheck` 三组零错、oxlint 0 警告、prettier。待验证：真实提供商下摘要质量与触发频率（估算启发式 vs 实际 tokenizer 的偏差）、压缩期间 UI 的 compacting 状态实机观感、`pnpm build` 与打包后运行（本轮未涉及原生依赖，风险低）。

## 2026-09-29（第十轮）Pi Agent Core 最小接入验证（阶段一）

落实 [重构计划](agent-workspace-plan.md) §5.1 的最小接入验证，报告见 [pi-integration-report.md](refactor/pi-integration-report.md)。新增精确依赖 `@earendil-works/pi-agent-core`、`pi-ai`、`pi-session-backend-sqlite-node`（均 0.87.1；`pi-ai` 为验证中追加——自定义 OpenAI 兼容 provider 必需，计划未列出）；探针代码 `src/main/agent/pi-probe/`（mock SSE 服务 + 装配层 + vitest 用例，不接入应用入口）。七个用例全部实测通过：流式增量、工具往返（TypeBox 与 zod→JSON Schema 两种参数）、中途 abort 保留已产出内容、500/429 错误事件、SQLite 会话持久化续接（node:sqlite 与 better-sqlite3 适配双工厂）、DeepSeek 风格 reasoning 映射、图片输入。结论：**可替换 loop.ts，无关键不成立项**；重要差异三条——Pi 会把 thinking 以 `reasoning_content` 回灌（与 DeepSeek「不回传」策略相反，需在 convertToLlm 剥离）、错误/中止是事件而非异常（默认不重试，重试归 Dela 外层）、`maxTokens` 未在 Agent 层暴露（需 streamFn 包装注入）。

- 已验证：探针 8/8 通过、`pnpm typecheck`、`pnpm lint`（0 警告）、`pnpm build`（main bundle 零 pi 引用）、全量 212 项单测；`node:sqlite` 在 Node 24.21.0 与 Electron 44 内嵌 Node 24.20.0（ELECTRON_RUN_AS_NODE）可 import。安装踩坑两处已记录：pnpm 12 `allowBuilds` 需把 `@google/genai`/`esbuild`/`protobufjs` 显式置 false；pi-ai 双实例断链用 `pnpm dedupe` 修复。待验证：真实提供商端点（重点 reasoning 回灌容忍度）、Electron 主进程/打包后运行、接入时的 external 配置与 asar 体积。

## 2026-09-29（第九轮）移除选区引用「回复此内容」悬浮钮

实机审阅后用户裁决放弃该功能：悬浮钮在沙箱 iframe（高度=内容高度、不可滚动）里定位反复修补——先贴底截断、翻转修复后矮楼层整钮消失、跨楼选区清除又需引入父页中继协议——复杂度收益比不划算。移除全部相关代码：注入脚本选区段与 postMessage 通道（frame-height.ts 与 index.html 的 CSP hash 回退为功能引入前的值）、ShuiyuanHtmlBody 的 onSelectionQuote 与 iframe 注册表中继、TopicReader 的接线。楼层操作条「引用」按钮（PostActions）不受影响；第三、五轮记录保留作为过程存档。

- 已验证：oxlint 0 警告、prettier、`pnpm build`、24 文件 204 项单测、`pnpm smoke:shuiyuan` 通过（引用路径走楼层按钮，仍覆盖）。

## 2026-09-29（第八轮）标签色块：按名称哈希每 tag 一色

用户反馈列表里只有分类有色块、后面的 tag 是纯文本，期望每个 tag 都有自己的色块。Discourse API 的标签只有名字没有色值（色块是分类专属），故在 `shuiyuan-format.ts` 新增 `tagColor`：名称字符串哈希 → 固定色相（`hsl(H 62% 52%)`，中间调在深浅主题下均可读），同名标签永远同色。列表（TopicFeed）与阅读页标题区（TopicReader）的 tag 统一渲染为「色方 + 文字」，色方规格与分类一致（size-2.5 rounded-[2px]）。

- 已验证：oxlint 0 警告、prettier、`pnpm build`、24 文件 203 项单测、`pnpm smoke:shuiyuan` 通过。待验证：实机观感（哈希色的整体观感由用户审阅）。

## 2026-09-29（第七轮）回复编辑器修复滚动 + 全屏书写

用户反馈：编辑区内容过长时无法滚动；要求在 X 左边加全屏钮，向上展开为大屏书写（对长文友好）。

- **滚动修复**：根因是编辑壳 `h-44` 容器不是 flex，MarkdownEditor（CodeMirror）的 `flex-1` 高度链断了——内部 scroller 拿不到约束高度随内容长高，被壳的 `overflow-hidden` 裁掉。壳改为 `flex flex-col` 后内部滚动生效（预览的 `max-h-40 overflow-y-auto` 本就正常）。
- **全屏书写**：X 左侧新增 Maximize2 钮（icon-sm ghost，与 X 同组悬于编辑卡右上角）；点击后表单 `absolute inset-0 z-30` 铺满阅读区（TopicReader 根补 `relative` 作锚点，只盖阅读页不遮全局外壳与标题栏），编辑器 `flex-1` 吃满剩余高度，内栏仍限 max-w-3xl 保行长；Esc 或 Minimize2 退出，X 收起整个回复框，发送成功自动退出全屏。编辑/预览/目标准条/附件/工具栏在全屏态全部可用（previewBody、editorHost 参数化避免双份 markup）。已知取舍：全屏切换会重挂 CodeMirror，正文保留但撤销历史清空。

- 已验证：oxlint 0 警告、prettier、`pnpm build`、24 文件 203 项单测、`pnpm smoke:shuiyuan` 通过。待验证：实机长文滚动、全屏展开动线与 Esc 退出。

## 2026-09-29（第六轮）水源卡片大气化：过量留白 + 字号对比

用户引《Refactoring UI》「先过量留白再收敛」，反馈卡片空白与高度不足、有难以言说的狭窄感，要求用对比增强设计感。卡片整体放大一档：头像 24px→40px（窄屏 32px，头像请求尺寸随之 48→96 保清晰）、卡内边距 p-4→p-5（窄屏 p-4）、卡间距 gap-3→gap-4、容器 pt-3/pb-8→pt-4/pb-10、标题 text-sm→text-base（与 12px 元信息拉开字号对比）、标题行—元信息行间距 gap-1→gap-1.5、头像—正文沟槽 gap-3→gap-3.5、元信息列间距 gap-x-2→gap-x-2.5、右簇图标 3→3.5，骨架屏同步新形。

- 已验证：oxlint 0 警告、prettier、`pnpm build`、24 文件 203 项单测、`pnpm smoke:shuiyuan` 通过。待验证：实机观感由用户审阅；如「过量」过头再逐档收敛。

## 2026-09-29（第五轮）回复框收起钮上移 + 「回复此内容」截断与配色修复

用户反馈两点：收起 X 应放进编辑区右上角而非工具栏；「回复此内容」悬浮按钮被截断（用户猜测 z-index 不当）且颜色与主题色相反。

- **收起钮归位**：X 从底部工具栏移除，绝对定位悬在编辑/预览卡片右上角（`absolute top-2 right-2 z-10` + 半透明底），工具栏只剩附件/预览/发送。
- **截断修复**：根因不是 z-index 而是垂直溢出——选区在楼层末行时按钮定位于 `r.bottom+6` 超出 iframe 底边，而 iframe `overflow-y: hidden` 直接裁掉。注入脚本改为量取按钮实际宽高（`offsetWidth/offsetHeight`），贴底时翻转到选区上方（`r.top - bh - 6`），水平按视口双向钳制。
- **配色跟随主题**：原实现是 tooltip 式反色（浅色主题深底深景），观感「反了」；改为浅色主题白底深字、深色主题深灰底浅字，各带 1px 淡描边，阴影减弱。
- 脚本文本变更 → 重算 sha256（`CY1Zt5lsZwKtZ0ndP/OBgWcDN4C+bkNVxzSXUE9cZyc=`）同步内外两层 CSP（frame-height.ts + index.html）。

- 已验证：`pnpm smoke:shuiyuan` 通过（含 quote 路径 + 零渲染进程报错，CSP hash 无漂移）。待验证：实机选区悬浮钮的定位与深浅两套配色。

## 2026-09-29（第四轮）水源信息流改逐条卡片：对齐通知中心样式

用户认为列表整卡切行仍显丑，指定改为通知卡片的样式。信息流容器由「一张大卡 + divide-y 分隔行」改为通知中心同款逐条卡片（NotificationsView 规格）：容器 `flex flex-col gap-3`，每帖一张 `rounded-xl border bg-card shadow-xs hover:bg-accent/40` 卡（内边距 p-4、窄屏 p-3），置顶卡 `bg-muted/30`；骨架屏同步改卡片形（5 张）；行内内容结构（头像/标题/元信息/右簇统计）不变。第一轮的容器卡方案就此被用户裁决取代。

- 已验证：oxlint 0 警告、prettier、`pnpm build`、203 项单测、`pnpm smoke:shuiyuan` 通过。待验证：实机观感（卡片间距与密度、hover 反馈）。

## 2026-09-29（第三轮）水源阅读页交互精细化：选区引用、回复指向跳转、回复框归底

用户反馈四点：用户名与正文无排版区分；回复框从右侧弹出不符合直觉应自底部展开；选中文字应有「回复此内容」悬浮引用；回复指向（reply-to）显示不全且不可跳转。

- **用户名排版区分**：楼层头部用户名 `text-sm font-medium`→`text-xs font-semibold`（12px 加粗「标签」观感），与 iframe 内 15px/400 正文拉开字号+字重双层对比；头部行改 `items-center`。
- **回复框归底**：移除宽屏停靠右侧栏方案（`useDockedComposer`/340px aside/`variant` 双态全部删除，属改动产生的孤立代码），回复框固定在阅读区底部、自底边向上展开，收起态即底部安静入口；收起按钮由「收起」文字/PanelRightClose 图标统一为 X 图标钮（icon-sm ghost）。
- **选区引用**（Discourse 式「回复此内容」）：楼层是 `allow-scripts` 不透明源沙箱 iframe，父页面拿不到选区——复用 frame-height 注入脚本通道扩展：文档带 `data-dela-selection-quote` 属性时，iframe 内选中文字浮出「回复此内容」按钮（深浅主题各配色，mouseup 定位、selectionchange 消隐、mousedown preventDefault 保选区），点击 postMessage 上抛所选文本（折叠空白、截 200 字）；父侧新增 `frameQuoteFromEvent` 校验（source 校验同高度上报），插入 `> **@用户**（第 N 楼）：所选文本` 引用并展开回复框。**注入脚本文本变更 → 重算 sha256 并同步内外两层 CSP**（frame-height.ts + index.html，2234 字符，`hh85kTnQj03DBHF/...`），邮件正文不带属性不受影响，两视图仍共用一个 hash。
- **回复指向跳转**：reply-to 指示从「仅目标已加载时显示灰文本」改为常显可点按钮（图标+目标用户名，目标未加载时显示「第 N 楼」）：已加载→本地平滑滚动+1.5s `bg-primary/5` 高亮；未加载→按楼层号重新打开该帖（既有 postNumber 滚动定位接管），不再出现「被回复楼层看不到」。
- 冒烟脚本同步：分页断言从「点加载更多」改为「滚动触底自动加载」（上一轮无限滚动改造的遗漏补账），topic 桩补 `authorUsername`/`authorAvatarTemplate`。
- 已验证：oxlint 0 警告、prettier、`pnpm build`（含三端 typecheck）、25 个测试文件 203 项单测、`pnpm smoke:shuiyuan` 通过（信息流/自动翻页/阅读页/引用/通知/搜索 + 零渲染进程报错，CSP hash 无漂移）。待验证：实机观感——选区悬浮按钮的定位与深色配色、跳转高亮、回复框底部展开动线。

## 2026-09-29 修复新注册用户被存量未读刷系统通知（邮件 + 水源）

用户报告：新注册用户填完邮箱信息后不断收到未读邮件的系统桌面弹窗。根因是系统通知的"启动基线"（`armSystemNotifications`）在应用启动首轮刷新后即置位，而注册发生在应用运行中——首次邮件同步把服务器全部存量未读拉入缓存，每批入库都是通知表首见（`!existing.has(id)`），armed 已开于是逐批弹窗；老用户启动时存量未读在基线阶段入库，故无此问题。

- **邮件修复**（`notifications.ts` `refreshMail`）：以 `mail_accounts.created_at`（注册时刻）为界，仅 `date` 晚于注册时刻的未读首次入库才调 `systemNotifyItem`；存量未读仍 upsert 进通知列表（保持面板展示，`initializeNotifications` 既有语义），只是不弹桌面通知。`date` 缺失时保守不弹（通知列表仍可见）。
- **水源修复**（`refreshShuiyuan`，同口径）：以凭据自带的 `boundAt`（账号绑定时刻，绑定时 `toISOString()` 写入）为界，仅 `createdAt` 晚于绑定时刻的互动首次入库才弹；映射层 `createdAt` 可为空串，空串比较恒不晚于基线，自然不弹。实现上 `refreshShuiyuan` 改为直接读 `loadShuiyuanCredential()` 取 username 与 boundAt（损坏凭据吞异常视同未绑定，与 `currentAccounts` 口径一致）。
- 回归测试：`notifications.test.ts` 新增"存量未读不弹、注册/绑定后到达才弹"邮件与水源头两条用例（测试表 `mail_accounts` 补 `created_at` 列）。
- 已验证：`tsc -p tsconfig.main.json`、main 侧 14 个测试文件 140 项单测（notifications 11 项含新用例）、oxlint、prettier。待验证：真机新账号注册后的弹窗行为。renderer 侧 typecheck 因工作区未提交的水源改动报错，与本次无关。

## 2026-09-29（第二轮）水源列表减负 + 阅读页重构：对齐 Discourse/Flarum 设计共识

用户反馈列表仍拥挤、阅读页同样粗糙，要求先研究优秀开源实现再动手。两路联网调研取回 Discourse/Flarum/NodeBB 源码级规格（`_topic-list.scss`/`topic-post.scss`/`DiscussionListItem.less` 等）与 V2EX/中文排版规范（W3C CLREQ），按共识实施：

- **列表减负**：分类 badge 由「色底胶囊+白/深字」改回 **Discourse 现行式「12px 色方+灰字」**（颜色只做索引不做底色，消除整页色彩噪音），色底叠字 helper `categoryBadgeTextColor` 随之删除；标签去底色改纯文字；**列表去掉赞数**（Discourse 列表不显示赞、每行只留一个主数字=回复数）；行距 py-3→py-3.5。元信息一行排开：分类 · 作者 · 标签（纯文字弱化），标题保持唯一主角。
- **阅读页重构**（TopicReader）：
  - 新增**话题标题区**（Discourse 式）：大标题 `text-xl font-semibold` + 分类色方/标签/楼层数/浏览/发布时间一行弱化；顶栏随之精简为「返回 + 截断标题 + 收藏/加入项目/外链」，移除 OP 小头像与分类标签簇（Reddit 式顶栏小标题+正文大标题并存）。
  - 楼层改**固定头像沟槽布局**：40px 圆形头像独立左列（Discourse 45px 的贴近档，窄屏 32px），正文永不绕行到头像下方；用户名 `text-sm font-medium`，「你」徽章与回复对象跟排，`第 N 楼 · 时间` 右对齐到行尾。
  - 操作行 **全 ghost**（去掉「回复」按钮的底色），默认 `opacity-60`、悬停/键盘聚焦所在楼层时浮现（Discourse 0.7 淡入共识，触屏常显）。
  - 楼层间距 py-4→py-5 + 1px 淡线（Discourse 分隔手法：线或留白，无卡片包装）。
- 调研关键依据：Discourse 列表标题常规字重不加粗、已读只降灰度；分类=0.75em 色方+深灰文字；标签默认纯文字；操作按钮全 ghost 右对齐；正文列 690px/45px 沟槽；Flarum 16px 标题+11px 元信息行+hover 显操作；V2EX 单数字原则；中文正文行长 17–40 字（CLREQ）。
- 已验证：oxlint 0 警告、prettier、`pnpm build`（含三端 typecheck）、24 个测试文件 202 项单测。待验证：实机观感（列表密度、标题区层级、沟槽对齐、操作条浮现时机、深色主题），由用户审阅。

## 2026-09-29 水源信息流列表重构：头像行 + 分类 badge + 未读标记 + 自动翻页

用户认为水源列表样式粗糙。四路并行只读调查（列表实现 / 全局设计体系 / 数据层字段 / UX 截图像素评审）定位根因：信息密度低（约 92px 行高只装两行字、无作者头像锚点）、右侧统计不按列对齐且 k/万单位混用、宽窗约半幅死白、分类色点在白底不可辨（Discourse 色值本为色块设计）、元信息 11px 单一灰阶、任意值字号不随字号设置缩放（style-audit 点名重灾区）。按用户裁决实施：

- **数据层**：`mapTopicList` 与搜索映射捕获 topic_list 顶层 `users[]`，按 `posters[]` 中 Original Poster 联查，`ShuiyuanTopicSummary` 新增 `authorUsername`/`authorAvatarTemplate`（store 原样透传，零 IPC 改动）。
- **行重设计**（TopicFeed）：列表包 `rounded-lg border bg-card` 容器卡 + `divide-y` 分隔行（TodoView 范式）；行首 24px 楼主头像（复用 `avatarUrl` 管线，缺省退回首字母占位圆）；分类圆点升级 Discourse 式色底 badge，叠字色按亮度估算自动配白/深（浅黄等淡色分类不再隐形）；meta 行左簇=分类 badge+作者名+标签 chip、右簇=赞数（>0 才显示）+回复数（`min-w-14` 右对齐成列）+时间，数字统一 `tabular-nums`；置顶行淡底、已关闭加锁标、已收藏行实心书签角标；未读标题 `font-semibold`、已读降为 75% 前景。
- **已读持久化**：store 新增 `readMarks`（localStorage `dela.shuiyuan.read`，90 天保留期），`openTopic` 成功后写入该帖 lastPostedAt；未读=从未打开或打开后又有新回复。
- **格式统一**（shuiyuan-format，全局生效含阅读页）：`formatCount` 删 k 档、<1 万千分位、≥1 万用「万」；`formatListDate` 2 小时内显示「刚刚/n 分钟前/n 小时前」。
- **交互**：底部哨兵 IntersectionObserver 滑到底自动加载下一页（阅读页覆盖列表期间暂停、出错停住交由错误横幅重试）；首屏加载改 6 行骨架屏；浏览量列按用户决定移除。
- **顶栏**（ShuiyuanHeader）：刷新按钮移入中间「列表切换+筛选」簇，与右侧搜索分开；feed 分段控件与下拉之间加竖分隔线；头部 `border-b` 降为 `border-border/70`（向浮岛线条规则靠拢，第四轮遗留项之一收口）；头部与列表的 `text-[9px]/[13px]/[15px]/[11px]` 任意值字号全部 token 化（2xs/xs/sm），随用户字号设置缩放。
- 内容列 `max-w-3xl`→`max-w-4xl`，私信工具栏同步加宽。
- 已验证：三端 typecheck（pnpm build 内含）、oxlint 0 警告、prettier、`pnpm build`、24 个测试文件 202 项单测。待验证：实机观感——头像加载、badge 配色与深色主题表现、未读加粗/骨架屏/自动翻页的节奏，由用户亲自审阅；弱网下自动翻页连发行为。

## 2026-09-29 Agent 与工作区重构方向整理（计划，未实施）

- 将工具重构扩大为全业务覆盖盘点与接口重设计，明确 edit 只是其中一项；记录水源已有业务 API/引用读取但缺少自主工具链、课表与 Canvas 状态/同步语义等问题。计划补充按领域的缺口清单、共同契约和真实任务链验收，并调整前两阶段交付；未修改工具实现或扩大写入权限。
- 在重构计划文首增加醒目的工程组织要求：主动按职责拆分文件与目录，精简、解耦，方便独立调试和修改；明确本轮不能以少建文件为由继续堆积大文件，并将组织检查纳入各阶段。技术规划同步说明，本次仅更新文档。
- 明确将上下文自动压缩纳入第二阶段交付，替代固定截取最近 12 条消息：按模型预算触发，保留原始历史、近期完整交互和可追溯摘要；补充任务连续性、失败恢复、模型切换及长工具链的验证要求。本次仅更新计划，现有模型请求逻辑未改动。
- 新增 [Agent 与工作区重构计划](agent-workspace-plan.md)，汇总项目与会话导航、聊天/文档统一标签、灵活双屏与三屏、Pi Agent Core 复用、Codex 会话管理借鉴、工具组合、上下文和文档版本协作、MCP/Skills 接入及未来 sandbox 方向。
- 后续补充设置分类与入口重构：核查当前六个设置分区；用户结合现有界面反馈后，撤回抽象分组和过细拆页，改为保留现有分类侧栏与内容页结构。建议将工作目录迁入“工作区”、“数据与服务”收敛为业务“连接”，保留“模型服务”和“插件”，在插件页按 Skills、MCP、自定义指令区分内容；分类方案仍待原型审阅。设置搜索与直达、任务通知、全局/项目继承等选项随相关能力交付，迁移保留旧偏好与入口定位，本轮未修改设置页面或 API。
- 明确功能键以简洁、明确、高频为原则：自动保存正常时移除常驻保存按钮，失败与冲突保留处理入口；缩小按钮与图标的视觉占位，保留可操作性，具体尺寸经原型审阅确定。
- 区分已确定方向、建议方案和阶段待确认事项，列出渐进实施及迁移验证依据；技术规划增加入口并标明自研循环和原工具契约为当前实现。
- 本轮仅整理设计文档，未实施新布局、引入 Pi 依赖或验证 MCP/Skills/sandbox 能力。验证限于文档格式、引用与差异检查，不运行应用测试或构建。

## 2026-09-29 拖拽条紧贴浮岛卡片边框：高亮线与底色分界线合一

用户指出侧栏右侧的分隔线"有宽度且与背景分界线分离"。像素级排查确认那是两个元素的叠加：Resizer（悬停/聚焦态 `hover:bg-foreground/40` 呈 rgb(154) 灰线，静止态透明不可见）贴在侧栏边缘，而浮岛卡片左边框因 `ml-1.5` 右移 6px，两者之间夹着画布底色，视觉上连成一根错位的粗线。修复：AppShell 根网格由三列 `[sidebar_1px_1fr]` 改四列 `[sidebar_0.375rem_1px_1fr]`，浮岛左侧留白改由专用间隙列提供、`main` 去 `ml-1.5`，拖拽条列移到 `col-start-3` 紧贴卡片边框，高亮线与底色分界线重合；卡片几何位置不变，窄屏间隙列归 0 保持通栏，折叠态（间隙列+1px 空列）与原 `ml 6px+1px` 布局等宽。

- 已验证：三端 typecheck、oxlint 0 警告、prettier、`pnpm build`、24 个测试文件 202 项单测；构建 CSS 中确认宽屏 `.375rem` 与窄屏 `0px` 两套网格模板均已生成。待验证：实机观感——悬停拖拽条时高亮线与卡片边框的贴合度。

## 2026-09-28 目录开关回归侧栏头：折叠态展开入口回落标签栏

用户实机后反馈：目录开关放在标题栏右侧（第四轮决策）离它控制的面板太远，要求放回「tree view 上方」——即第四轮统一收纳前、侧栏头第一格的旧位置。按用户意见部分回退第四轮的「统一标题栏」：

- **展开态**：目录开关常驻侧栏头第一格（28px 按钮 + 14px PanelLeft 图标、灰底显式 `hover:bg-foreground/10`，与头部动作组一致）；`aria-expanded` 按视口取值（<md 抽屉开合、≥md 折叠列）。
- **折叠态**：面板归零隐藏时开关随面板消失，展开入口由标签栏左端的折叠态开关接管（恢复第三轮方案：常驻挂载 + 宽度/透明度 150ms 双向过渡，仅 `md:` 生效）——避免「有文件打开 + 折叠」时只剩 Ctrl/⌘B 一条不可见回流路径（第三轮消灭的死胡同不回归）。第三轮的 `ml-2` 对齐已被第四轮标签栏 `px-2` 取代——叠加会成 16px 双重边距（用户实机指出），现去 `ml-2` 后按钮与侧栏头开关同处 x=8px，收展切换原地淡入淡出、位置不动。空态「打开目录」按钮与移动端标签栏 Folder 按钮不变。
- **标题栏**：目录开关移除，保留编辑器布局与助手开关两钮。
- 已验证：三端 typecheck、oxlint 0 警告、prettier、`pnpm build`、24 个测试文件 202 项单测。待验证：实机确认展开/折叠两个方向的开关位置交替观感（侧栏头 ↔ 标签栏左端）。

## 2026-09-28（第五轮）响应式残余缺陷修复：断点锚定内容区实际宽度

同日四路只读响应式审查（全局外壳 / Chat·设置 / 邮箱·水源 / 项目·资料·TODO·课表）确认无 P0 崩坏，但指出系统性根因：**断点普遍锚定窗口宽度而非内容区实际宽度**——主导航侧栏可拖 200–360px，窗口断点与内容区最多偏差 160px。目录栏折叠与顶栏重构收尾后按清单落地修复，推广仓库既有的两种正确范式（MailView 的 ResizeObserver 实测、MonthCalendar 的 `@container` 容器查询）：

- **首页项目卡片网格（HomeView）**：网格列数由窗口断点改容器查询（`@container` 挂网格外层，`@xl`(576px) 起两列、`@2xl`(672px) 起三列）。原窗口 lg 断点在侧栏 360px 时仍三列、每列仅 ~160px；分档阈值按卡片实际舒适宽度（~213px 起）重定，不再直接沿用窗口阈值——网格本身受 `max-w-3xl`(768px) 封顶，直接平移 1024/768 会永远到不了三列。
- **设置对话框（PluginsSection/ConnectionsSection）**：`Dialog.Content` 补 `max-h-[85vh] overflow-y-auto`（对齐 LlmSection 既有写法），最小窗口 + 1.25 字号缩放下保存按钮不再被裁出视口。
- **ChatComposer 底部工具行**：思考强度按钮补 `min-w-0 shrink` + 文案 truncate（与模型按钮同为可收缩件，Button 基类自带 `shrink-0`），窄面板（助手 280px 最小宽）降级为仅剩图标，不再整行溢出；模型按钮补 `title`，截断到只剩箭头时悬停可见全名。
- **水源阅读页停靠回复栏（TopicReader）**：`useDockedComposer` 由窗口 matchMedia(≥1024) 改为阅读区根节点 ResizeObserver 实测（useLayoutEffect 挂载同步测量防首帧闪变）——窗口 ≥1024 但阅读区不足时退回底部折叠条，楼层正文不再被固定 340px 停靠栏挤到 ~284px。
- **预览工具栏（PdfReader/SheetPreview/DocxPreview）**：`justify-center` 改 `justify-center-safe` + `overflow-x-auto`——放得下时保持居中，放不下时对齐起点并横向滚动（居中溢出会把两侧按钮裁成不可达）。
- **助手并排判定（ProjectView）**：`agentInline` 由窗口 matchMedia 改壳宽实测（`shellWidth >= 1024`）——窗口 1024 + 侧栏 200 时壳仅 824px，仍并排会让目录栏最小宽优先、编辑器被压穿自声明的 320px 下限；1024 阈值与助手拖拽上限（壳宽 45%）共同保证并排时编辑器恒 ≥320px。shellWidth 观察改 useLayoutEffect + 挂载即同步测量（消除首帧按 0 宽布局的闪变）；助手面板的 `max-lg:*` 窗口断点类全部改为 agentInline 条件类联动（覆盖态 absolute 全宽遮罩 / 并排态宽度扣减共用同一判定）。
- **周课表（WeekCalendar）**：桌面网格/按日堆叠由窗口 md 断点改容器查询（`@min-[860px]` / `@max-[860px]`）——窗口 768–1050px 时内容区不足 860px 仍渲染桌面网格，必然横向滚动；现已写好的按日堆叠布局真正挂上。
- **P2 快修**：AppShell 侧栏折叠时 Resizer 由 `pointer-events-none` 改 `hidden`（键盘不再可聚焦、方向键不再产生看不见的假反馈；网格列为固定 1px 不影响布局，同 MailView 范式）；快捷键弹窗 label 补 `min-w-0 truncate`；标题栏死类 `user-select-none` 修正为 `select-none`；水源阅读页头部分类/标签链补 `min-w-0`/`shrink`/`truncate`，窄时先于标题收缩；文档面包屑末位（当前文档名）`shrink-0`，祖先层级先截断、当前文档保持可读。
- **审查项未修（非响应式或属其他待办）**：邮件正文 iframe 恒白底（暗色主题刺眼，属主题适配）；月历「+N」热区 20px（触控目标尺寸）；TODO 行尾三图标窄屏占位（上一轮已记待实机审阅）。
- 已验证：三端 typecheck、oxlint 0 警告、prettier、`pnpm build`、24 个测试文件 202 项单测；容器查询产物在构建 CSS 中确认——`@min-[860px]`/`@max-[860px]` 生成 `(width>=860px)` / `not (width>=860px)` 区间语法，完美互补无边界缝隙（避免小数宽度下两态同显或全隐）；`justify-content:safe center`、`container-type:inline-size` 均已生成。待验证：侧栏拖宽/窗口缩放时首页网格、周课表网格/堆叠、助手并排/覆盖的切换时机与观感（实机审阅）。

## 2026-09-28（第四轮）顶栏去线条化：浮岛内容卡片 + 标题栏功能收纳 + 圆角标签

用户指出工作区顶栏三条行带高度不一、边框线过多且无区分度、工作区名重复出现、图标无分组，整体观感粗糙；定调借鉴 VS Code（功能键入标题栏、图标缩小）与 Chrome/Edge 的圆角标签观感。确立线条规则：灰白相邻靠色差不画线、白上白保留一条淡线（编辑分栏、邮件列表/阅读）、全应用只保留浮岛卡片外圈一圈细边框。

- **浮岛画布（全局）**：AppShell 根色改 `bg-sidebar` 作画布，标题栏去 `border-b`；`main` 内容区变圆角卡片（`rounded-t-xl border border-b-0 border-border/70 shadow-xs`，上、右留 6px 画布缝，`max-md` 退化全铺），首页/项目/邮箱/课表/TODO/设置全部视图统一。导航栏宽 Resizer 透明化。
- **标题栏功能收纳（VS Code 式）**：header 右侧新增 `#titlebar-actions` portal 宿主，ProjectView 经 `TitleBarPortal`（mounted 后取宿主节点）挂目录开关、编辑器布局下拉、助手开关三个 size-7 按钮；目录头开关、标签栏左端折叠态开关、标签栏右端布局+助手按钮组全部移除，AgentPanel 的窄屏关闭钮（`onCollapse`）一并移除，统一由标题栏接管。
- **Chrome 式圆角标签**：标签带与目录列统一 `bg-muted` 灰色 chrome 区（去标签带 `border-b`/`bg-muted/20`、标签竖线与活动下划线）；标签改 h-8 圆角浮起 pill，活动态 `bg-background shadow-xs rounded-t-lg` 融入下方白色页面；标签栏末尾新增「+」新建按钮（与双击空白新建等价）；关闭钮 24→20px。
- **目录列收敛**：侧栏头 h-11→h-10；新建笔记/新建文件夹/导入收进「+」下拉（「全部收起」保留平铺）；搜索框改灰底白色胶囊（去边框）；树行 hover 由 `bg-accent/60`（与 muted 同值、灰底上不可见）改 `bg-foreground/5`；灰底上的 ghost 按钮（目录头、标签栏 +/抽屉开关、助手头部、资料列表行操作）hover 显式改 `bg-foreground/10`，否则 ghost 默认 `hover:bg-accent` 在 `bg-muted` 上同样无反馈。
- **文档工具栏**：去 `border-b`、字号 11px→12px；面包屑跳过顶层项目（与目录头重名不重复展示）；按钮 icon-sm(32px)→新增 `icon-xs`(28px、图标 14px)，按视图/内容/位置三组排列、组间 `gap-2`；保存状态「已保存」文字改 Check 小图标（保存中/只读/未保存仍为文字），Save 按钮保持常显、仅脏时可用——避免按钮出现/消失引起行内位移，偏离计划中「脏时才显示」的初稿。
- **配套**：Button 新增 `icon-xs` 尺寸；Resizer 默认 `bg-border`→`bg-transparent`（白上白处显式传 `bg-border/60`：编辑分栏、邮件列表与阅读区——列表白、阅读区灰染，此线兼作两侧底色分界）；AgentPanel 底色 `bg-muted/40`→`bg-muted`、头部去 `border-b`、按钮 icon-xs。
- **四路并行评审修复（同日）**：窄屏(<md)下标题栏目录开关原实现走 collapsed 分支毫无反馈——新增 `explorerDrawer` 断点状态，抽屉/折叠列按视口分流（空态「打开目录」按钮同修，aria-expanded 按视口取值）；标签「+」移出 `role=tablist`（ARIA content model 不容非 tab 子元素）；标签关闭钮视觉 20px 用 after 伪元素扩回热区；资料侧栏「Canvas 操作」「添加我的资料」两个漏改的 icon-sm ghost 下拉钮统一 icon-xs + hover 显式色；助手面板 bg-muted 全面化后内部三处同色失配（工具调用 pre、图片占位、引用 chip hover）改白底/foreground 叠加；ProjectSidebar 行操作 hover 与 SourceList 对齐；面包屑改跳「无父级的项目」，嵌套项目（原地升级保留父级）不丢层级；保存按钮 tooltip 恢复三态、状态文案只读优先于保存中（防御性对齐旧版）、Check 补 sr-only；panel-toggle 的 `inert` prop 因唯一调用方（标签栏开关）迁走成为死 API 而移除；标题栏动作区与窗口按钮间距 pr-1→pr-1.5；浮岛卡片补 ml-1.5 左缝对称。评审确认的误报：React portal 合成事件沿 React 树冒泡，portal 按钮聚焦时 Ctrl+\ 等工作区快捷键仍可达 `handleWorkspaceKeyDown`，无需焦点补丁。遗留决策：深色主题画布亮于卡片呈「嵌入」观感（与 VS Code 深色明暗关系一致），待实机确认是否接受；设置导航/月历图例/TODO·水源·课表头部的全强度 border-b 属其他视图内部样式，不在本轮范围。
- 已验证：三端 typecheck、oxlint 0 警告、prettier、`pnpm build`、24 个测试文件 202 项单测。待验证：实机观感——亮/暗主题下浮岛卡片边界、活动标签与页面融合、灰白分界在低对比屏幕上的可见度（若偏弱，目录列右侧可补 `border-border/40` 淡线兜底）、标题栏 portal 按钮与拖拽区互不干扰。

## 2026-09-28（第三轮）目录栏折叠重构：完全隐藏 + 标签栏开关 + Ctrl/⌘B

用户指出折叠态 48px 图标栏全高只放一个开关按钮既丑又浪费，且收展动画的中间帧会把完整面板挤进窄条（悬浮的工具图标、树行文字残影、挤出滚动条）——根因是「宽度参与动画、内容参与布局」：单一 DOM 靠 width 过渡挤过每个中间宽度，显隐靠 `invisible` 瞬时切换与 150ms 宽度动画错位。按对比（Obsidian/Notion 完全隐藏、VS Code/ChatGPT 功能图标栏、悬停暂现）选定「完全隐藏」方向：

- **折叠即隐藏**：`SIDEBAR_COLLAPSED_WIDTH(48)` 移除，折叠宽度归零，不再有图标栏；折叠态加 `inert` 移出焦点序，`border-r-transparent` 消除零宽残留边线。
- **壳动内容不动**：内容层宽度在折叠动画期间固定为展开宽度，由外壳 `overflow-hidden` 裁切并整体淡出（`transition-opacity`），不再跟随挤压 reflow——中间帧从「破碎挤压」变为「落幕/揭幕」。
- **开关位移淡化**：目录开关折叠后转移到编辑器标签栏左端（`PanelToggleButton` 常驻挂载，宽度+透明度随收展双向过渡，`overflow-hidden` 裁切图标），避免按钮在目录头与标签栏两处位置间跳变；展开方向同样平滑淡出，不产生标签页瞬移。移动端抽屉开关（Folder 按钮）不变。
- **配套**：空态（未打开文件）在折叠时出现「打开目录」按钮，消除「从左侧目录打开文件」的死胡同文案；新增 `Ctrl/⌘B` 切换目录栏（编辑器内让位给加粗：焦点在 `.cm-editor`/contenteditable 时不拦截）。
- 已验证：Prettier、Oxlint 0 警告、三端 typecheck、24 个测试文件 202 项单测。待验证：收展动画手感与开关淡入淡出（动画不做自动化视觉验证，实机审阅）。

## 2026-09-28（第二轮）TODO 详情回归为底部卡片：作业描述入 TodoItem 与行尾快捷操作

用户在上一轮「移除详情面板」基础上进一步提出：点击待办卡片自底部滑出详情卡片（与新建待办同壳），显示标题、DDL 与作业描述；行尾悬浮图标再加几个。

- **作业描述入缓存**：`TodoItem` 新增 `description`（仅 Canvas 作业，描述原始 HTML）。todo 同步本就请求作业列表、Canvas 响应自带 description，此前被丢弃——补齐字段零额外请求；旧缓存条目待下次同步（≤15 分钟轮询或手动刷新）补齐。agent 工具 query_todos/query_assignments 返回前剥离 description（HTML 不进模型上下文，正文需要时经 readCanvasSource）。
- **详情卡片**：底部滑出壳提取为 `TodoSheet`（遮罩+卡片+标题行+关闭），新建/编辑与详情共用。详情 = 标题、元信息行（BookOpen 课程·状态、CalendarClock 截止、CircleCheckBig 提交于、CalendarCheck 已写入日历）、元信息下 divider 接描述正文（Canvas 作业：无边框沙箱 iframe 渲染清洗后 HTML，链接点击转 openLink；个人待办：备注文本）、页脚操作（个人：删除/编辑；Canvas：在 Canvas 中打开）。初版描述为固定 288px 边框卡片内部滚动，用户实机反馈长文截断——根因是阅读器默认样式禁文档纵向滚动（`html{overflow-y:hidden}`，邮件场景为高度上报让外层滚动的约定），固定高度盒子因此必然裁切；改为 body 挂 ResizeObserver 量高、iframe 高度自适应（父侧测量，无需邮件那套 postMessage 脚本与 CSP hash 注入，sandbox 保持仅 allow-same-origin）。其后高度方案定稿：卡片固定为所在视图 85% 高（overflow-hidden，标题与元信息行固定不滚动，页脚钉底），描述区占卡片剩余空间、超出内部滚动——用户在知晓「固定整卡高度对短内容会有留白」的取舍后选定此组合；iframe 仍自适应高度，滚轮经不可滚动的文档链到描述区。HTML 清洗逻辑自 SourceDetail 提取为 `lib/sanitize-html.ts`，资料详情改为复用，行为不变。
- **行尾图标扩充**：个人待办 1→3（写入日历快捷开关 CalendarPlus/CalendarCheck、编辑、删除，均直接操作），Canvas 保持外链一个（本地无其他可动动作）。整行点击从「编辑/打开 Canvas」改为打开详情卡片并标记已读；搜索/通知深链（request.id）恢复打开详情（上一轮曾降级为仅落地列表）。
- 已验证：Prettier、Oxlint 0 警告（TodoDetail 渲染期 Date.now 触发 react purity 警告，改由 TodoView 传入分钟级 `now` prop）、三端 typecheck、`pnpm build`、24 个测试文件 202 项单测。待验证：详情卡片固定高度（85%）+ 描述区限高内部滚动的观感（含滚轮悬于 iframe 上的滚动链）、行尾三图标窄屏占位、深链滑出卡片的时机（实机审阅）。疑似同源隐患：资料详情（SourceDetail）的 Canvas iframe 同样受 `overflow-y:hidden` 约束而自身不增长，长文是否可滚动待实机确认，若确认截断可将同一量高机制移植。

## 2026-09-28 TODO 详情面板移除：行尾悬停操作 + 新建/编辑共用底部面板

用户反馈点击待办展开的右侧「待办详情」观感差：内容与列表行完全重复（标题/课程·状态/截止），占约半宽却大面积留白。按「行即操作」收敛，去掉第二栏：

- **详情面板整体移除**：selectedId、详情节与双栏布局拆除，列表恢复全宽。整行点击执行主操作并标记已读——Canvas 作业直接在 Canvas 中打开（原详情面板唯一动作即此外链，三步并一步），个人待办打开编辑面板。
- **行尾操作图标**：每行右侧悬停浮现单个图标（Canvas 作业 ExternalLink、个人待办 Pencil），图标始终占位（仅 opacity 过渡）避免行内容位移，键盘聚焦（group-focus-within）同样浮现，窄屏常显（max-md:opacity-100）。曾考虑行尾「完成」图标后否决：个人待办的完成开关即左侧圆圈，Canvas 状态由 Canvas 同步决定（未完成/已提交/已批改/需重交…），本地打勾会与同步冲突。
- **新建/编辑共用 TodoComposer**：详情面板内的编辑表单 TodoForm 移除；TodoComposer 接受可选 item，标题随「新建待办」/「编辑待办」切换。截止时间支持清除与重设（编辑无截止待办时出现「设置截止时间」按钮，原 TodoForm 能力保留）；编辑态页脚左侧新增删除（原详情面板动作迁移），新建默认截止时刻不变。
- **深链行为变化**：搜索/通知跳转（request.id）不再打开详情，落地 TODO 列表并标记已读；详情面板移除后无选中态，未加临时高亮。
- 已验证：Prettier、Oxlint、三端 typecheck、`pnpm build`、24 个测试文件 202 项单测。待验证：悬停浮现时机与行内容无位移、整行打开 Canvas 的手感、编辑/删除面板实机观感（实机审阅；悬停交互不做自动化视觉验证）。

## 2026-09-28 设置新增「通用」分区与开机自启动（默认开启）

设置导航在首位新增「通用」分区并成为设置页默认落点，当前包含「开机自启动」开关（描述「登录系统后自动启动 Dela」）。主进程经 `app.setLoginItemSettings`/`app.getLoginItemSettings` 读写系统启动项：仅打包版执行系统注册（开发运行不注册 electron.exe，读写本地偏好）；偏好存 `workspace_settings` KV `open-at-login`（'1'/'0'，键不存在视为开启，覆盖老版本升级场景）。打包版首次启动登记默认开启并注册启动项，之后不在启动时改写——避免覆盖用户在任务管理器或设置页的改动，状态以系统为准。

- **renderer**：新 `GeneralSection`（沿用外观分区的行式布局与独立保存态/失败提示）；TodoView 的私有 `Switch` 提取为共享 `components/ui/switch.tsx`（新增 `disabled` 属性，加载未完成与保存中时禁用），两处调用方。
- 已验证：三端 typecheck、oxlint 0 警告、vitest 197/197、`pnpm build` 三端产物构建通过、`pnpm smoke` 通过（开发运行不触及系统注册，行为与此前一致）。
- 待验证（需打包实机）：安装版首次启动写入 HKCU Run 键并在 Windows「启动应用」中可见；设置页开关与任务管理器的启停联动；UI 状态与系统注册项一致。
- 边界：`getLoginItemSettings().openAtLogin` 只反映 Run 键存在性，Windows 任务管理器的「禁用」走 StartupApproved 标记、不改 Run 键，届时设置页可能显示与实际启动行为不一致（Windows 平台已知差异，Electron 生态通行行为）；Linux 上 Electron 的 setLoginItemSettings 为 no-op（Linux 分发已暂停）；自启动拉起完整窗口，不做「启动到托盘」的隐藏参数。

## 2026-09-28 Canvas 资料 Office 文件预览（pptx / docx / xlsx）

资料面板的文件预览此前只支持 PDF/图片；本轮增加三类 OOXML 只读预览，覆盖 Canvas 课程文件与「我的资料」导入文件两个来源。docx/xlsx 为纯 renderer 渲染（新依赖 docx-preview 与 SheetJS——SheetJS 官方已不在 npm 发新版，按官方 CDN tgz 精确锁 `xlsx-0.20.3`，含 CVE-2023-30533 修复）；pptx 不直接渲染：Windows 经 `powershell.exe`（Windows 内置 5.1，脚本无 PS7 独有语法）调 PowerPoint COM 后台打开另存为 PDF（`SaveAs` 格式 32，输入/输出路径走环境变量防注入），macOS 调 `BrowserWindow.previewFile`（Quick Look）。均由确认卡片按钮触发，不自动执行。

- **格式识别**：Canvas 文件沿用魔数路线——`%PDF-` 之后增加 `PK\x03\x04` 嗅探，`resource-parse.ts` 新增只读 zip 中央目录条目名的分类助手（`word/document.xml`/`ppt/slides/`/`xl/workbook.xml`），文件按尾部读取识别（容忍 zip 末尾追加字节）；本地文件按扩展名。`DocumentContent.format` 增加 `'docx' | 'xlsx' | 'pptx'`。
- **受限协议放宽**：`dela-resource://` 的 canvas/workspace 主机从"仅 PDF"放宽为 PDF+三类 OOXML（`canvasPdfPath`/`workspacePdfPath` 改名 `canvasPreviewPath`/`workspacePreviewPath`），响应 content-type 按扩展名给出，仍不暴露磁盘路径。
- **pptx 导出与关联**：导出 PDF 存入「我的资料/预览导出」（固定文件夹，id 记在 settings、可重命名找回；条目 kind='imported' 可见可管理）。关联存 `workspace_settings` KV `preview-export:<canvas|workspace>:<id>`（值含 entryId/path/version/exportedAt；无新表无迁移）。重复导出覆盖同一文件（先写临时名再改名，失败不破坏上次导出）；in-flight Map 防并发重复。再点开源 pptx 直接在同一标签页内渲染导出的 PDF，顶部细提示「已打开导出的 A.pdf」；源版本变化（Canvas updatedAt / 本地 mtime-size）时提示可能过期并给「重新导出」。新 IPC：`workspace:export-office-pdf`、`workspace:quick-look`（后者需 sender 定位窗口，单独注册）。
- **renderer**：`DocxPreview`（docx-preview，`.docx-wrapper` 灰底覆盖为透明露出 bg-muted）、`SheetPreview`（SheetJS 读字节 + 底部工作表标签切换 + `sheet_to_html` token 化表格样式）、`OfficePrompt`（确认卡片/关联提示条，平台判断沿用 `navigator.platform` 模式）；`SourceDetail` 增加 docx/xlsx/pptx 分支，`ProjectDocument` 计算 officeRef（Canvas 用 sourceId、本地条目用条目 id）并传刷新回调。三组件均懒加载分包（xlsx 约 363KB、docx-preview 约 173KB 不进主包）。
- 已验证：三端 typecheck、oxlint 0 警告、prettier 通过、vitest 197/197（新增 OOXML zip 分类 2 例 + 导出关联 KV 读写/损坏容错/stale 判定 3 例）、`pnpm build` 三端产物构建通过且分包生效。
- **评审与实机反馈修复（同日第二轮，3 个并行评审 + jsdom 探针实证）**：
  - zip 分类尾窗 bug：EOCD 的中央目录偏移相对文件起点，>1MB 文件按尾部缓冲直接索引必然越界 → 全部误判"不支持"（绝大多数真实课件带图超过 1MB）。`classifyOfficeZip` 增加尾窗起点换算，补 1.5MB 随机数据 fixture 用例。
  - docx 内嵌图片不显示：探针实证 docx-preview 默认 blob 路径不产出 img src、`useBase64URL: true` 稳定输出 data: URL；统一切 base64（CSP 的 img-src/font-src 均放行 data:，顺带解决内嵌字体被 font-src 拦截的问题），并 `renderAltChunks: false` 关闭无 sandbox 的 srcdoc iframe 面。
  - xlsx 注入面：SheetJS 0.20.3 源码级确认富文本 `cell.h` 与 `data-z` 属性两处未转义（当前仅靠 CSP 兜底）；`cellHTML: false` 关掉 `.h` 生成 + `sheet_to_html` 输出经 DOMParser 清理（与邮件 HTML 预览同模式，剥 script/iframe/on* 属性/危险协议链接）。注意 HTML 序列化规范对属性值只转义 `&` 和 `"`——重新解析无注入元素才是正确判定，已按此写测试断言。
  - pptx 生命周期：超时改为 `taskkill /T /F` 连进程树杀掉（原实现只 reject，挂起的 PowerPoint 常驻后台）；失败清理 `.part.pdf` 临时文件；导出条目被删除后（仓库约定删条目不删文件）关联校验条目存在性、缺失回退确认卡片；条目被重命名后重新导出同步 `local_path`（原实现只改 name，渲染停留在旧文件）；PowerPoint COM 单实例冲突以 Promise 链串行化转换。
  - 体验：docx/xlsx 增加与 PdfReader 同款缩放工具栏（10% 步进、50%–300%、点击百分比重置，CSS zoom 缩放内容层）；xlsx 增加空工作簿提示与 2000 行截断提示；pptx 导出增加进度反馈——main 侧 `workspace:export-office-progress` 事件（准备/转换中/写入中三阶段，1.5s 轮询输出文件字节数），确认卡片显示旋转指示 + 阶段文案 + 已进行秒数 + 已写入 KB/MB。
  - 已验证（第二轮后全量）：typecheck、oxlint 0 警告、prettier、`pnpm build`、vitest 202/202（新增 >1MB 分类、条目删除回退、sanitizeTableHtml 四例）。
- **实机反馈修复（同日第三轮）**：
  - 导出状态随标签页丢失：`exporting/progress` 原存组件 useState，切标签页卸载组件后后台仍在转换但界面回到初始按钮（失败原因同样丢给已卸载组件）。导出状态移入模块级 zustand store（按 `ref` 键控），进度事件改为组件外常驻订阅、载荷附带 `ref`（`OfficeExportEvent`，并发导出进度可归属），切回页面即恢复「进行中」显示；已进行秒数由 `startedAt` 推算（重挂载跳到真实耗时而非从 0 计）。失败记录保留到下次发起，切走再切回仍能看到失败原因。
  - 导出的 PDF 在我的资料看不到：导出确实落盘并登记了 `workspace_entries`，但目录树只在 ProjectView 挂载时 `load()` 一次，导出完成后无人刷新。`onOfficeRefresh` 现在同时 `read`（文档进入关联渲染）与 `refresh()`（侧栏目录树出现「预览导出」）。
  - 已验证：typecheck、oxlint 0 警告、prettier、`pnpm build`、vitest 202/202。待实机复验：切标签页往返的进行中显示、导出完成后侧栏立即出现「预览导出/A.pdf」。
- **实机反馈修复（同日第四轮）**：
  - 触控板双指缩放：docx/xlsx 预览此前只有工具栏按钮。新 `use-pinch-zoom` 共享 hook（两个调用方，非 passive 监听拦下 Chromium 对捏合的整页缩放）——Chromium 把双指捏合派发为 ctrl+wheel，像素模式按 Mozilla 通用查看器同款公式 `exp(-deltaY/100)` 比例缩放，行模式（Ctrl+滚轮）按工具栏同款 10% 步进；普通滚轮不受影响保持原生滚动；仍受 50%–300% 边界约束。PdfReader 原生已支持（PDF.js `updateScale`）无需改动。
  - 导出完成到 PDF 打开之间的过渡：完成判定本就基于 PS 进程退出码（退出码 0 且输出文件存在；1.5s 轮询只上报已写字节数，不做完成判定）。原先成功后立即清掉进行中状态，卡片在文档重读翻转到 PDF 前会闪回「导出」按钮（误点会重复导出）。增加 `opening` 过渡态：退出成功 →「导出完成，正在打开…」保持旋转指示，待 `onExported` 的重读完成后才清除；期间重复触发被忽略。
  - 已验证：typecheck、oxlint 0 警告、prettier、`pnpm build`、vitest 202/202。待实机复验：触控板捏合手感（Windows 精确触控板 / macOS）、导出结束到 PDF 自动打开的衔接。
- 待验证（无法自动化，需实机/真实课件）：Windows PowerPoint 实际导出与未装 PowerPoint 时的报错文案（友好映射已写：0x80040154→提示安装）、PowerShell 5.1 实机运行、macOS Quick Look、Canvas 真实 office 文件的内容识别（CI 无样本）、docx/xlsx 复杂排版与合并单元格的渲染质量。
- 边界：只读不做编辑；不处理 .doc/.xls/.ppt 老格式与加密文档；Linux 无预览动作仅保留下载/外部打开。

## 2026-09-28 CI 暂停 Linux 安装包分发

暂时停止 Linux（Ubuntu 24.04 x64）平台的安装包构建与分发，两个 workflow 的 Linux 矩阵项注释停用（保留注释便于恢复），Linux 专属步骤（Xvfb 冒烟、AppArmor 放开、桌面运行时安装）以 `runner.os == 'Linux'` 条件原样保留、自然失效。连带调整：`check.yaml` 的 `pnpm format:check` 与 `pnpm lint` 原本只挂在 Linux 任务上，随矩阵停用会彻底消失，移至 Windows 任务执行一次。发布流程中的 prepare/release/publish-public 任务仍在 ubuntu runner 上运行——它们只做 tag 校验与 gh CLI 上传，不构建应用。

- 已验证：workflow 注释保持 YAML 结构有效（矩阵解析为 win-x64、mac-x64、mac-arm64 三项）；README 下载表、`docs/release.md` CI/发布/平台基线说明同步更新。
- 待验证：真实 GitHub Actions 运行（下次 PR/push 到 main 触发 `Check win/mac ×3`，下次发 tag 产出 `.exe` + 两个 `.dmg`）；若 main 分支保护将 `Check linux-x64` 设为必需检查，需在 GitHub 设置中移除，否则 PR 将无法合并。
- 恢复路径：取消两个 workflow 中的矩阵注释，并把 `check.yaml` 的 format/lint 条件从 Windows 移回 Linux。

## 2026-09-22 系统桌面通知与邮件已读状态打通

用户反馈两件事：希望通知能推到系统桌面（只显示标题，点击直接进入对应界面，如邮件通知落到那封邮件）；通知面板「全部已读」后邮件列表仍显示未读。根因：邮件通知的已读存在 `notifications.read_at`，邮件本身已读存在 `mail_messages.seen`（随 IMAP 同步），两套状态互不联动，双向都不同步。

- **邮件通知已读改为派生状态**：`notificationState` 的邮件行 LEFT JOIN `mail_messages`，已读与否直接取 `seen`（本地删除的邮件通知随之隐藏），不再维护第二份 read_at（水源仍用通知行 read_at，远端已读不回推的现状不变）。通知面板点单条 ✓ 委托 `markMailSeen`、点「全部已读」委托新增的 `markAllMailSeen`（一次 IMAP 连接给收件箱全部未读批量加 `\Seen` 再本地落库）——语义上通知面板标记已读即在**服务器**真正标为已读，手机/网页端同步变化；服务器不可达时保留未读，经既有来源错误行提示。`markMailSeen` 增加已读 fast-path，通知跳转与邮件视图自动标已读不再重复建连。派生切换后 `notifications.source_unread` 列在全仓只写不读（彻底变死是本次切断最后一处 SELECT 引用所致；删列需 schema 迁移，本轮不动，列为后续独立清理候选）。
- **反向同步（读邮件 → 通知红点）**：`mail/api` 新增 `onMailCacheChanged` 回调注册，读信、删除、恢复、同步完成（含他端已读）后触发，notifications 侧注册后立即重播 `notifications:state`。用回调而非直接互导是为避免 mail/api ↔ notifications 循环依赖。
- **系统桌面通知**：新模块 `src/main/system-notify.ts`，邮件/水源/TODO 新增通知三处接入（前两处在 refresh 时对已入库 id 做差集，TODO 在已知课程新增作业的 INSERT 分支）。守卫链：启动首轮刷新为基线不弹（armSystemNotifications 之后才弹）→ 未处暂停通知 → 主窗口未聚焦（聚焦时靠应用内红点，收起到托盘/后台正常弹）→ 只显示标题。点击恢复聚焦主窗口并发 `notifications:open`，preload 新增 `notifications.onOpen`，App.tsx 复用通知面板的 `openNotification`（跳转 + 标已读）。Windows 侧 `app.setAppUserModelId('io.dela.desktop')`（与 electron-builder appId 一致，开发运行同样需要）。
- 已验证：三端类型检查、oxlint 0 警告、vitest 192/192（新增派生已读、markAllMailSeen 批量范围与 fast-path、单条委托、服务器失败保留未读、本地删除隐藏通知等用例；通知测试补 mail/api 与 system-notify mock）、`pnpm build` 三端产物构建通过。
- 待验证（实机，用户审阅）：系统通知在 Windows 通知中心的弹出与点击跳转、聚焦抑制与暂停抑制、启动基线不弹；通知面板全部已读后邮件列表/文件夹未读数联动、读邮件后铃铛红点即时消失。系统通知聚焦策略与覆盖来源（三来源全覆盖、未聚焦才弹）为本轮采纳的推荐默认，实机体验后可调整。

## 2026-09-22 全仓架构深度清理（9 个并行切片）

9 个并行 code-clean 切片覆盖全部代码层：main 根模块、agent、mail、shuiyuan、canvas/timetable/workspace、renderer 外壳与 components/ui、chat/projects、mail/shuiyuan/sources features、其余 7 个 features、shared/preload/scripts。统一约束为**行为零变化**（不改 IPC 通道、数据库 schema、存储/凭据格式、错误文案、UI 语义），每处删除均经全仓 grep 确认零引用。合计 48 文件，+567/−887（净 −320 行）：

- 死代码：删除零引用的 `components/ui/separator.tsx`、dropdown-menu 4 个子组件、globals.css 的 `.page` 规则；shuiyuan store 三个死状态字段（`username`/`bookmarksLoading`/`notificationsLoading`）；timetable 遗留 `timeInput()`；mail `syncFolder` 死参数；MailView 死 prop `onComposeDirtyChange`；chat-smoke.cjs 三段调试输出。约 30 个仅模块内使用的导出收窄为非导出（`shared/api.ts` 契约面逐条核查后零改动）。
- 真实重复合并（均多处调用方）：credentials 四组凭据的加密密封样板收敛为 `writeSealed/readSealed/removeSealed`；通知已读 UPDATE 与 todo 同构模式对齐；mail 的文件夹排序/消息行查询/正文下载三组重复各收敛为单一函数；workspace 两处存储路径批量改写合并为 `rewriteStoredPaths`；timetable 三处学期解析收敛为 `resolveSemester`；TodoView 与 NewEventDialog 的调色板提取为共享 `EventColorRow`；AppearanceSection 四组 try/catch 收敛为局部 `useOptionSave`；LlmSection 两个同构句柄合并。
- 复杂度简化：mail `syncFolder` 去掉 IIFE 包装；AppShell 标题菜单类名、shuiyuan 预览 prose 类链等长字符串常量化；App.tsx 三处导航请求清理合并。
- 已验证：三端 typecheck、全仓 oxlint 0 警告、prettier 全通过、vitest 184/184、`pnpm build` 三端产物构建通过。
- 待验证：运行时冒烟未跑（本轮无 IPC/schema 改动，风险面小）。留档观察项：mail/shuiyuan/sources 三套 HTML 消毒逻辑重复（跨 feature，需单独切片）；`errorText` 寄居 `features/projects/workspace` 但被 76 处跨 feature 引用；timetable 与 mail 的 IPC 通道仅部分调用 `checkWorkspaceSender`，来源校验策略不一致；`scripts/capture-preview.mjs` 零接线待用户裁决去留。

## 2026-09-22 编辑器非核心功能产品审查修复（已 stage 待提交）

以产品视角审查编辑器的标签/分屏/拖拽/面包屑与右栏助手交互，修复确认的缺陷：

- 分屏焦点可见性：非焦点编辑组的标签文字降透明度，「下一个文件会开进哪组」可预判（VSCode 行为）；标签右键菜单新增「在另一栏打开」，布局按钮提示补充 Ctrl+\ 快捷键。
- 标签栏溢出时激活的标签自动 `scrollIntoView`，新开标签不再落在视口外毫无反馈；后台脏标签保存失败导致关闭静默无效时，经全局错误横幅告知。
- 标签拖拽落点扩展到整个编辑组（正文区松手 = 移入该组末尾），悬停组高亮，不再只能命中 40px 标签栏；资料树定位（面包屑 reveal）后选中行自动滚入可见区。
- Canvas 课程资料补齐与本地条目一致的 Alt+单击与「在另一栏打开」（`SourceList` 透传 `onOpenToSide`，直接以 `source:` 键开进副组）。
- 助手面板修复四处：已配置用户每次进项目闪现 Key 表单（等待 `chat` 就位再判定）；composer 内联图片在切换视图时被静默销毁（仅新对话时剥离释放，视图切换保留，重启由启动 GC 回收）；删除正在流式输出的当前会话产生僵尸忙碌态（`deleteChat` 先走停止按钮同路径的中断）；历史面板首次结果返回前不再闪现「还没有历史对话」。
- 全局搜索打开会话的 `chatRequest` 闩锁：`openProject`/`goBack`/`goForward` 补清理，切项目或往返导航不再把用户拉回旧会话、覆盖「新对话」状态。
- 已验证：三端类型检查、全仓 lint 与格式检查通过，`pnpm build` 三端产物构建通过。交互手感（拖拽高亮、焦点组透明度）待用户审阅。
- 后续裁决（用户授权按项目现状择优）：预览标签机制确认为死代码后整体删除——`EditorGroup.preview` 字段、`open()` 的 pin/替换/释放分支、「编辑即转正」effect、`pinTab`/`pinEntry` 与标签、资料树的 onDoubleClick 链一并移除（默认固定为 09-21 既定产品决定且 README 已承诺；旧 localStorage 布局中的 preview 键在下次持久化时自然淘汰）；`goBack`/`goForward` 补齐与 `navigate` 一致的 mail/chat/settings 请求清理；文档「重新载入」的脏草稿确认从原生 `window.confirm` 换为应用内 Dialog（邮件/课程资料区仍有 4 处原生 confirm，属各自视图内部一致，未动）。`smoke:workspace` 在本机因 rolldown 打包 `@napi-rs/canvas` 平台 `.node` 失败（与本轮改动无关，待单独排查）。

## 2026-09-22 响应式布局全面审查修复

四个并行审查覆盖工作区/首页聊天/课表待办/邮件引导与共享组件，窗口尺寸假设：最小 600×440（主进程 minWidth/minHeight）至 4K/超宽，含 Windows 贴边 1/4 屏与竖向半屏。已修复：

- 工作区（高）：分屏两组 inline `minWidth/minHeight` 与 sash 的 `splitMinimum` 对齐，窄/矮窗口副编辑组不再被静默裁切（宽屏开的分屏缩窗必现）；768-1023px 助手为覆盖层时侧栏宽度不再按并排扣减，开合助手不再引起侧栏跳变。
- 课表（高）：周视图内容窄于 860px 出现横向滚动时，表头首格与时间刻度列 sticky 左缘常驻；月视图日格过窄时 pill 先隐藏时间前缀把宽度让给标题（容器查询 `@min-[120px]`，120px 为时间前缀 + 最短可读标题的实测和）；事件详情弹窗超高时可内部滚动；步进器五列过窄时自动换行。
- 编辑器：CodeMirror 正文限宽 60rem 居中（与富文本一致，超宽窗口行宽不无限拉伸）、字号随 `--font-scale`；文档工具栏截止时间可截断，窄编辑组不再换行堆积。
- 聊天：用户气泡补 `overflow-wrap:anywhere`（长 token 不再溢出气泡并引发横向滚动）；composer 输入字号随 `--font-scale`；历史列表去掉低价值「N 条」计数，288px 面板内标题宽度约增加四成。
- 邮件（高）：写信正文 `min-h-[220px]` 改为可收缩，440px 矮窗口附件行与发送错误不再被裁掉且不可达；链接编辑行错误提示可截断，不再把 URL 输入框挤没。首页问候语窄窗口 padding 与 composer 对齐。
- 共享组件：tooltip 默认 `max-w-80`，dropdown/select/context-menu 补 radix `available-width` 上限（与既有 available-height 对称），长文本换行而非裁切。
- 审查确认但未修：首启 Intro 在 ≤520px 高度 CTA 与署名重叠（仅首次启动 10 秒内缩窗触发，动画编排页留给用户裁决）；邮件列表 `max-[1080px]` 视口断点按项目 MagicNumber 约定上报（窄侧栏 + 宽视口仍占 128px 搜索框）；课表超宽无最大宽度与其他视图策略不一致（可接受）。
- 已验证：三端类型检查、全仓 lint 与格式检查通过；各断点实际渲染待用户在 600×440 / 960×540 / 1366×768 半屏与超宽下抽查。

## 2026-09-21 助手栏 composer 精简与历史对话面板统一

- 项目右栏助手去掉 composer 上方分隔线与底部「内容会提供给模型服务」说明文字。
- 助手栏「历史对话」从居中 modal 改为与首页对称的悬浮面板：`ChatSessions` 增加 `side` 参数（`left` 从左缘、`right` 从右缘滑出，镜像边框与位移动画），锚定同一内容区 `#app-main`；原居中 dialog 形态已无调用方，连同 radix `Dialog` 依赖一并移除，组件收敛为面板单形态。
- 对话历史删除改为二次确认：点垃圾桶在原位变成红色「确认删除」按钮，点它才执行删除，按外面其他位置即还原；首页面板与助手面板共用同一列表组件，同时生效。
- 已验证：三端类型检查、全仓 lint 通过。面板滑出与确认交互待用户审阅。

## 2026-09-21 课表新建事件面板复用待办样式

- 新建事件从居中对话框（背景变暗 + 缩放淡入）改为与新建待办一致的底部滑出面板，不再背景变暗；开始与结束时间均使用五列步进选择器（`DateTimeStepper` 增加可选 `aria-label` 参数，默认值保持待办处「截止时间」不变）。
- 结束时间默认比开始晚一小时（月视图整日点击等 `end === start` 的 draft 场景兜底）；此后调整开始时间时结束时间随差值整体平移，保持时长，用户无需回头改结束时间；提交时仍校验结束晚于开始。
- `roundToMinute` 从 TodoView 提取到 `timetable-format.ts`（与 `dateKey`/`timeInput` 等日期工具同处，TodoView 已有对该文件的跨特性引用）；`NewEventDialog` 不再使用 `DateInput`/`dateKey`/`timeInput`（`DateInput` 仍被 SemesterStartDialog 使用，未删除）。
- 修复步进器按住连发失效：`useHoldRepeat` 的 interval 原持有按下时刻的旧闭包，连发只会基于旧值原地重复；改为经 ref 转发最新回调，待办与事件两处同时受益。
- 已验证：三端类型检查、改动文件 lint 通过。滑出动画与步进手感待用户审阅（涉及动画，未用探针自查）。

## 2026-09-21 工作区页头与标签布局

- 移除独立文件名行，布局与助手入口移至标签行右端；文件默认追加标签，已打开文件直接激活，旧预览标签恢复为普通标签。
- 面包屑使用统一 11px 小字档位并跟随字体缩放，按用户后续决定恢复原有单行路径截断，不再追加当前文件名或换行；文档更多菜单操作全部展开为右侧图标按钮，保留提示与可访问名称。
- 编辑器布局使用一个状态图标与单选菜单，明确显示单栏、左右分栏、上下分栏；合并保留全部标签并清空副组，恢复布局允许同一文档出现在两个组。助手在标签栏保留同一个展开/收起按钮，图标随状态切换，右栏复用左栏 150ms ease-out 宽度过渡；拖拽时禁用过渡，遵循减少动态效果设置，收起内容不可聚焦。窄屏覆盖模式将关闭入口放在面板左上角。
- renderer 类型检查、相关 lint 与格式检查通过；未构建或打包，桌面布局、窄屏与拖动手感待用户审阅。新增右栏过渡不使用自动化录帧，留给用户审阅。

## 2026-09-21 中文 IME 输入热修复

- 富文本编辑器不再在组词结束或卸载时写回暂存的旧正文；组词期间保留本地输入，结束后发布当前 Markdown。本地 onChange 回传不触发整篇替换，Milkdown 延迟通知读取当前正文，避免旧拼音覆盖已提交中文。
- 源码编辑器立即记住本地提交，只在 value 真正变化时接收父组件值，避免光标状态重渲染和 compositionend 同步把中文清空；保留正常外部修改同步。富文本保存快捷键在稳定宿主上监听，并避开 IME 按键。
- 已验证：新增两项 React + 实际编辑器内核的回归测试，在旧代码上分别复现“你变回 ni”和“中文清空”，修复后连同既有测试共 7 项通过；renderer 类型检查、相关 lint、格式与 diff 空白检查通过。
- 用户已确认修复有效；未逐项记录候选、连续输入、取消组词及代码块输入的覆盖情况。jsdom 事件模拟不等于系统 IME 全面验收。
- 发布版本递增至 0.7.1；按用户要求不重复运行本地检测、构建或打包，推送版本 tag 后由现有发布工作流构建安装包。

## 2026-09-21 待办新建面板与「写入日历」

- 新建待办改为 workspace 区域底部滑出的面板：标题、备注、步进式截止时间（年/月/日/时/分五列，列上方 ^ 增、下方 v 减，按住连发；默认取创建时刻并取整到分钟）、日历候选色与「写入日历」开关。编辑表单同步改用步进器，可补改颜色与写入日历，保留清除截止时间入口。
- 开启「写入日历」的个人待办在课表周/月视图按截止时刻渲染为 30 分钟色块（止于截止时刻，颜色随待办，未选则石墨色），随待办状态广播实时增删改；点击色块详情提供「在 TODO 中查看」跳转，日历侧不可删除。月视图 pill 显示截止时刻。
- 数据仍只存 todo_items（calendar/color 字段），日历为渲染层派生（事件 id 用 `todo:` 前缀命名空间），不写 calendar_events，因此 LLM 的日程查询不重复计入待办；关闭开关或删除待办即从日历消失。
- 已验证：三端类型检查、全仓 lint、182 项测试（含新增 calendar/color 持久化用例）通过。面板滑出动画、步进连发手感和桌面视觉待用户验收。

## 2026-09-21 TODO 与 Canvas 作业完成状态

- 新增水源下方的 TODO 入口，统一展示个人待办与 Canvas 作业；个人待办可创建、编辑、删除、完成和重开，Canvas 状态只读同步。
- 新增作业专用分页轮询，启动/连接后及每 15 分钟同步；按连接隔离缓存，失败保留数据并显示错误。新增 SQLite 迁移，不修改已有表。
- 已读与完成独立：课程首次导入无历史通知，后续新增作业只通知一次，反复轮询不重置已读。接入全局搜索、通知详情跳转、LLM 查询与个人待办写入工具。
- 不包含作业提交、个人待办定时提醒、截止时间推送；未访问真实账号或提交任何作业。界面与真实 Canvas 状态仍待用户验收。
- 已验证：5 个相关测试文件共 30 项通过，三端类型检查、全仓 lint 和 diff 空白检查通过；未执行打包、真实 Canvas 同步或桌面视觉验收。

## 2026-09-21 单实例与托盘唤起修复

- 在主进程初始化前请求 Electron 单实例锁，未获得锁的进程退出，并阻止其初始化数据库、主窗口和托盘。
- `second-instance` 唤起已有主窗口；显式保存主窗口引用，避免激活时误选校园登录等辅助窗口。窗口创建入口复用已有窗口，防止启动与 activate 重叠时重复创建。
- 保留托盘左键单击显示/恢复/聚焦主窗口，以及右键原生上下文菜单。Windows 快捷方式连续启动与实际托盘点击仍需桌面实测。
- 已验证：main/preload/renderer 类型检查、主进程代码格式和 lint、diff 空白检查通过。本次未打包或执行桌面点击测试。

## 2026-09-21 首启引导判定修复

- 移除开发模式强制重播；首次启动改由 main 在建库前判定，经 preload 传递布尔值，已有数据库的升级和重启不受页面 localStorage 缺失影响。
- 播放前保存 started，首次动画或向导中途退出后不再重播；兼容旧版 completed、splash.seen 和 step。此规则取代此前的断点恢复行为。
- 增加状态回归测试，覆盖首次播放、重复读取、刷新、已有安装但页面存储为空、旧标记、冒烟与完成清理。动画视觉效果留给用户审阅，不使用自动化录帧。
- 已验证：9 个状态测试、main/preload/renderer 类型检查、相关代码格式与 lint 检查通过。未执行构建、安装包升级/重启实测；动画视觉效果未验收。

## 2026-09-20 主进程测试目录整理

- 已完成：将 `src/main/` 根目录及 `agent/`、`mail/`、`timetable/` 下混杂的单元测试分别移动到对应的 `test/` 子目录，并修正测试相对导入路径。
- 已验证：主进程类型检查通过，15 个测试文件共 134 个单元测试通过，格式检查和 diff 空白检查通过。

## 2026-09-09 工程初始化

- 固定基线：Electron 44.3.0、TypeScript 7.0.2、Vite 8.2.2、pnpm 12.3.4、better-sqlite3 13（使用随包预编译模块，关闭源码重建）。明确不采用 electron-vite（Vite 支持范围不含 8）。
- 开发工具安装在被忽略的 `.tools/`，经 `scripts/use-local-tools.ps1` 启用。
- 已验证：锁文件安装、三组类型检查、生产构建、开发/生产启动与 Windows 可执行目录冒烟。

## 2026-09-10 前端骨架、自定义标题栏与邮箱 v1

- 前端重构（原 `frontend-refactor-plan.md`，已完成并移除）：`main.tsx` 只负责挂载，`App.tsx` 承担外壳；设计 token 与 reset 收进 `styles/`；页面拆分到各自 feature，样式迁移为 CSS Modules；引入 clsx、framer-motion、highlight.js。
- 自定义标题栏：`titleBarStyle: 'hidden'`，窗口操作经 preload 受控 IPC；后续补齐后退/前进（与邮箱离开确认共用守卫）与应用菜单（文件/资料/视图/帮助，`Ctrl/⌘1–5`、`Ctrl/⌘,` 等快捷键）。
- 邮箱 v1（首个真实业务）：SQLite v1（账户/文件夹/邮件）、`safeStorage` 加密凭据、ImapFlow 同步每文件夹最近 300 封窗口、HTML 正文在无脚本 sandbox iframe 渲染。已用真实账号验证 7 个文件夹同步与 HTML 阅读。
- 邮件阅读改进：页面按组件拆分，正文优先 HTML、CID 图片（2 MB 总预算）、远程图片开关、链接经校验后系统浏览器打开；SQLite v2 新增正文版本，迁移前自动备份。
- Shell 视觉统一（中性灰阶 + 深青绿 token）、lucide-react 图标、修复浏览器预览中 `window.dela` 可选性。

## 2026-09-11 邮件收发闭环与课表接入

- 邮件发送：Nodemailer SMTP（465）、受限富文本写信（加粗/斜体/链接/正文图片 CID/附件）；投递成功后同一 MIME 经 IMAP `APPEND` 归档到 `\Sent`；附件流式下载并每次弹系统保存对话框；打开未读邮件即时更新列表与未读数。
- 课表接入：教学信息服务网只读接口 + 独立持久 Electron Session + 无 preload 模态登录窗（jAccount 扫码回跳、SSO 重定向、非标准 Content-Type 等问题逐项修正）；不使用无法取得的开放平台 `client_id`。
- 课表日历化：8:00–20:20 周时间轴 + 月历 + 本地事件；修复 `globals.css` 中损坏的 `@custom-variant dark`（暗色工具类全局失效）并给主进程加 `--lang=zh-CN`。
- 界面语言统一：`resizer` / `panel-toggle` / `desktop-only-notice` 提取为共享组件并推广到各页面；窄屏改覆盖式抽屉；设置页重构为分区导航。

## 2026-09-12 Canvas 资料与项目工作区成型

- 资料与项目从示例转真实工作区：Canvas Access Token 接入（`safeStorage` 保存），按学期分组、按需同步课程/目录/文件/模块/作业；数据库 v5 新增 Canvas 快照、工作区条目、笔记与来源引用；文件本体首次打开才下载。真实账号验证 48 门课程、6 学期。
- 磁盘目录约定：Canvas 文件按 `Dela/courses/term-*/课程名 [ID]/files/...`、笔记按 `Dela/workspace/项目/子文件夹/` 保存（次日统一为英文路径段）；旧数据迁移前自动备份数据库；删除应用内项目保留磁盘原件。
- 磁盘笔记 + Markdown 编辑器：CodeMirror 6，GitHub Light/Dark 配色以 `--syntax-*` token 跟随主题；600ms 空闲自动保存、外部修改冲突检测。
- 文档区对齐 VS Code：预览标签（斜体、编辑转正）、中键关闭、脏点/关闭按钮字形切换、面包屑定位、情境化工具栏；目录 HTML5 拖拽移动（主进程循环校验）、双击空白新建。
- `workspace.ask` 问答雏形：用户手选正文 + 最近 12 条对话发给所配模型，回答可存为笔记。
- 课表：月历拖拽跨天创建任务、开学日期应用内手动设置（同步成功后覆盖手动值）、8 色低饱和事件配色与选色（数据库 v6）。
- 品牌：关于页重排 + 赞赏弹窗（微信/支付宝码）；应用图标与窗口图标统一为 `assets/Dela_*_bg`，黑底可选（重启生效）。

## 2026-09-13 Agent 闭环、邮箱本地化与首页改版

- Agent 业务闭环：`src/main/agent/`（api/ipc/loop/tools）承接对话，17 个业务工具（查课程/资料/邮件/日程，建条目/写笔记/关联来源/复制文件/建日程/备邮件草稿）；写入类工具直接执行并校验 revision，邮件只备草稿由用户手动发送；12 轮上限、上下文只含所选资料。
- 主进程按业务域拆分（`mail/ canvas/ timetable/ workspace/ agent/` 各 `api.ts`+`ipc.ts`），聊天调度移出项目业务。
- PDF 预览性能重构：完整字节不再经 IPC/Zustand/Blob 复制，改用受控 `dela-resource` 协议按 Range 流式读取（完整 200、区间 206）；Canvas 下载流式写临时文件、校验后原子登记。
- 邮箱本地化：草稿箱与已删除改为本地功能（服务器 `\Drafts` 经用户授权一次性清理）；回收站支持恢复/彻底删除/清空与保留期自动清理（数据库相关 8 项新单测）。
- 本地草稿：写信随时保存草稿（含富文本与附件快照），关闭/切页/退出三选一确认；Agent 草稿与编辑器草稿相互独立。
- 邮件回复（预填收件人/`Re:`/引用正文）；设置新增页面缩放与字号档位；修复 CodeMirror 中文输入法组文被打断；笔记不再强制追加 `.md` 后缀。
- 首页两状态改版：闲置态（问候 + composer + 建议胶囊 + 最近项目）↔ 会话态（消息流 + 钉底 composer，智能吸底）；多会话落库（数据库 v9 `chat_sessions`）；Agent 循环强化：每轮独立 120s 超时、429/5xx 退避重试、工具结果截断至 20000 字符、第 12 轮注入收尾提示、`max_tokens` 8192。
- 已验证：真实账号读取课程资料、Qwen 合成笔记问答、工作区冒烟扩展；当时待验证：真实模型工具调用兼容性。

## 2026-09-14 多提供商、校园会话持久化与 PDF.js 阅读器

- LLM 提供商自定义配置：预设致远一号/DeepSeek/MiniMax/智谱/自定义，密钥只存主进程加密文件，旧单凭据自动迁移；「检测连接」经 `/models` 端点导入真实模型列表；设置新增「模型服务」分区。
- 校园登录会话跨重启保存：无有效期会话 Cookie 以 `safeStorage` 加密快照（`campus-session.bin`），三进程模拟测试覆盖恢复/覆盖/断开清除。
- 课表体验：重叠课程并排分列（first-fit 布局纯函数）、悬浮提示换 Radix Tooltip、自建事件删除、跨多天事件连续条、课程详情弹窗、自定义 Select 与三段数字日期输入；月历 `+N 更多`。
- 首页视觉层次对齐 ChatGPT 网页版：快捷入口（新建项目/近期作业/今天的日程，后两者单击直发）、两列 Provider/模型选择面板、英文问候语轮播（遵循减少动态效果）；重启后默认进入新对话。
- 资料页导航改版与 PDF.js 阅读器：采用官方 `PDFViewer`（pdfjs-dist 6.3.289）取代自制渲染器——可见页优先队列、LRU 画布缓存、缩放保留画面、单页 4×1024² 像素上限；经 `PDFDataRangeTransport` 分段读取；Worker/字体/CMaps 随包发布，无运行时 CDN。`pnpm smoke:pdf` 以合成 300 页文档回归。
- 水源：以 Discourse User API Key 协议完成只读授权全流程手工验证（签发 → 读会话 → 撤销），确认不依赖 OpenClaw 白名单。

## 2026-09-15 首启引导、水源接入与对话时间线

- 首次启动引导：开场动画 → 五步配置向导（邮箱/教学信息服务网/Canvas/水源/模型服务，每步实时验证连接）→ 完成动画；支持断点恢复；开发模式每次重播、正式构建只播一次；`?smoke-test=1` 短路引导供自动化使用。
- 水源授权绑定：主进程生成一次性 RSA 密钥对，独立窗口完成 jAccount 登录与授权，粘贴密文回贴绑定；key 经 `safeStorage` 保存，解绑先远端 revoke 再清本地。
- 水源信息流（`read,write` scope）：单列信息流（最新/精品、类别/标签筛选、搜索）、楼层阅读、收藏/私信/通知、帖子「添加到项目」（数据库 v10 `shuiyuan_topics`）；楼层 HTML 服务端消毒 + 沙箱 iframe 渲染；新增 `pnpm smoke:shuiyuan`。
- Agent 对话时间线 v1：说明与动作按真实顺序交错、动作可展开原始输入/输出；Streamdown 渲染未完成 Markdown；智能贴底跟随。
- 课表 hotfix：连接检查与同步改用 `net.request`，绕开 Electron 内部构造 Response 的未捕获状态码异常。
- 首页历史会话改为左上角悬浮面板（搜索/打开/删除，乐观移除 + 重取收敛）。

## 2026-09-16 搜索、通知与 Agent 过程可视化

- 全局搜索：`Ctrl/⌘K` 跨项目名、会话、邮件缓存与课程资料文件名，每类限 10 条；数据库 v11 通知中心——邮件/水源通知聚合、来源筛选、单条与全部已读（仅本地状态）、暂停 30 分钟/1 小时/至次日 9 点；运行期邮箱每 5 分钟、水源每 60 秒刷新，关闭应用即停。
- Agent 动作时间线：运行中占位步骤（有输入无输出）、完成自动收起、失败单独标识；思考过程流式展示（解析 `reasoning_content`/`reasoning` 双字段，仅展示不回灌模型）；工作过程完成后整体折叠为一行摘要（Codex 式）；推理强度档位（`reasoning_effort` 全链路）；输入草稿按会话范围持久化到 localStorage。
- 水源阅读器两轮改版：双栏阅读 + 右侧回复栏 → 按需展开（楼层级回复目标准星、收起保留草稿）；楼层 cooked HTML 全量内容块阅读样式；站内图片改经 `dela-resource` 认证代理（显式 Cookie 头绕开 SameSite 限制）；附件上传写 `upload://` 链接；修复 srcDoc iframe 在打包版被 CSP 拦截的高度上报脚本（sha256 精确放行）。
- 引导向导 UX 改版：Canvas/水源两段式编号引导（含获取 Token 的站内路径）、模型步骤三段式分组、上一步回退、顶部锚定排版。

## 2026-09-17 前端风格一致性审查

- 对 `src/renderer` 全部 111 个文件做静态审查（未改源码），结论与整改优先级见 [frontend-style-audit.md](frontend-style-audit.md)：系统性漂移集中在字号任意值不随设置缩放、`workspace.ts` 私有全局 store、`window.dela` 三种处理流派、错误转文案与日期格式化多份平行实现、弹窗无统一封装。

## 2026-09-18 Composer 多模态、联网能力与编辑器可靠性

- Composer 输入模型重构：textarea 换 CodeMirror 6；图文混排（图片以 `dela-img:` token 内联，主进程暂存 + 启动 GC 回收孤儿，发送转 OpenAI 兼容 image parts）；文本类附件（≤1MB）进当轮上下文；`/` 指令合并设置 › 插件的自定义指令；修复 `@` 空查询无候选。
- 时间线/思考流/停止修正：折叠行去动态数字（改去重动作类别）；思考块自动展开/收起且不回灌；点停止后 `ask` 正常返回并标记 `stopped`（不再抛 AbortError）；修复拖拽蒙版不消失（CM6 drop 阻断冒泡）。
- 与 `origin/feat/chat-UI` 合并（合作者同期重复实现）：时间线采用远端 WorkedBlock 架构 + 本地去动态化；思考存储统一为远端 `reasoning` parts；停止采用本地实现；保留远端 reasoning_effort、草稿持久化与水源/搜索/通知/引导，采用本地 CM6 Composer。
- 联网搜索与文档解析（零新增依赖）：`web_search`（DuckDuckGo lite）与 `fetch_page`（重定向逐跳校验、2MiB/15s 上限、拒绝内网地址含 IPv6）；PDF 经 pdfjs 在主进程解析（Worker 挂 `globalThis`）、DOCX/PPTX 用自写最小 zip 读取器提取文本层；扫描件明确报告不可读。
- VS Code 式编辑器可靠性：草稿按文档 key 共享、编辑器组按 `editorStateKey` 保留各自光标/滚动/撤销；保存请求按文档串行化，失败保留脏草稿；修复预览转正覆盖新 scope 布局的竞态；标签拖拽跨组移动、右键批量关闭；面板宽度收敛为命名常量。
- 聊天滚动改为「新回合贴底 + 流式跟随 + 上滚脱离」（取代 09-15 顶部回合锚定）。
- 稳定性：全局竖向滚动条槽位常驻（内容增长不再引发宽度抖动）；邮件/水源 iframe 禁内部纵向滚动，修复宽表格邮件折行振荡闪烁；水源图片代理修复三条破图分支（协议相对/路径相对/未列举媒体路径）。
- 已验证：Prettier、Oxlint、三组类型检查、构建、123 项单元测试与各冒烟全部通过；Windows 目录打包通过。**长期待验证**：真实推理模型的思考流与工具调用兼容、真实多模态提供商的 vision 支持、NSIS/DMG/AppImage 实机安装、邮箱凭据解密错误（见技术规划书「仍需实测的事项」）。

## 2026-09-18（第三轮）工作过程时间线改版：DeepSeek 式单层折叠

- 消除 tool call 层级冗余：原「已工作 > 动作组（类别摘要行）> 步骤」与「已深度思考」各自带折叠行，展开需多次点击。现整段工作过程收敛为单一 `WorkingSection`——思考段落（圆点 + 弱化文字）、动作行（每工具独立图标 + 动词 + 输入摘要 chip）与中间说明按发生顺序平铺在一条左侧竖向连线上，只有区域折叠与单步详情两层。
- 开合策略：运行中自动展开、时间线不限高随内容生长（贴底跟随由外层消息流负责）；尾部公开正文开始后整段自动收起（回答阶段头部保持静态「正在工作」）；完成后折叠为「已工作 · X」（失败以红色计数保留）；手动开合后尊重用户选择。原「正在深度思考/动作组类别摘要」中间层移除。单步详情以 `overflow-x-hidden` 根治展开瞬间的水平滚动条闪现抖动。
- 附带改进：`prepare_email` 的「检查并发送邮件」入口在工作完成即刻出现，不再等待整条消息结束。
- 验证：格式、Oxlint、三组类型检查、`pnpm build`、123 项单元测试、`pnpm smoke` 与重写断言后的 chat-smoke（平铺时间线、自动开合、连线布局、失败行内错误、单步详情、旧会话回退、贴底滚动）全部通过；明暗主题冒烟截图核对布局。收起/展开过渡与流式观感按约定由作者在真实应用中审阅。

## 2026-09-18（第四轮）聊天排版修正

- Composer 图文混排的内联图片 chip 由垂直居中改为底部对齐（`vertical-align: bottom`），文字与图片沿行底阅读。
- 聊天区 Markdown 去除代码块的双重容器：Streamdown code-block 外层自带 `rounded-xl border bg-sidebar p-2`，与 `markdownStyles` 给内层 `pre` 的 `bg-muted rounded-md` 叠成两层圆角矩形；现以属性选择器覆盖将外层盒样式清零，保留语言标签与内层代码框，块内容直接展示。
- 列表改为标准悬挂缩进：移除与 Streamdown 冲突的 `[&_ul]/[&_ol]` 重复配置，覆盖其 `list-inside` 为 `list-outside` 并统一 `pl-5`，换行文本与首行对齐。
- 后续修正：代码块仍有第二层盒样式来自 `code-block-body`（`rounded-md border bg-background p-4`），一并覆盖清零，仅保留内层代码框。聊天区代码高亮此前从未生效——Streamdown v2.6 把 shiki 拆为可选插件包，新增精确依赖 `@streamdown/code 1.1.1`，经 `plugins={{ code: createCodePlugin({ themes: ['github-light','github-dark'] }) }}` 注册（共享配置收敛到 `features/chat/markdown.ts`，含 `markdownStyles`）；token span 自带 `dark:text-[var(--shiki-dark,…)]`，双主题跟随应用既有 dark 变体，无需额外样式。
- 验证：格式、Oxlint、三组类型检查、构建、单元测试与 chat-smoke 通过；chat-smoke fixture 新增 bash 代码块并断言 token 携带 `--shiki-dark`（防高亮回归）与 code-block/body `border-style: none`（防盒样式回归）；截图核对单层灰底框与 GitHub Light 语法配色。实际观感由作者实机审阅。

## 2026-09-18（第五轮）PDF 页图像支持（视觉模型）

- `read_resource` 新增可选 `pages` 参数（每次至多 6 页）：pdfjs + `@napi-rs/canvas` 把指定页整页渲染为白底 JPEG（最长边约 1600px、质量 0.85，LRU 缓存 12 页），覆盖扫描件、内嵌插图与矢量图表；扫描件不带 pages 调用的返回新增 hint 引导模型改走图像路径。无视觉门控（用户决策）：工具描述与 system prompt 注明需要视觉模型，非视觉模型调用时的请求失败行为与现有贴图一致。
- 传输：`role:'tool'` 消息只接受字符串，页图像在本轮工具消息之后以一条合成 user 消息（`image_url` data URL parts，带《标题》第 N 页标签）附给模型；base64 在进入 tool 消息、数据库与时间线之前剥离，持久化输出只留 `pageImages` 页码元数据；单次运行附图上限 12 张，超出降级为文字说明。
- 依赖与打包：`@napi-rs/canvas` 1.0.9 由 pdfjs-dist 的 optional 传递依赖升为直接依赖（锁文件未新增下载）；`vite.main.config.ts` 标记 external，electron-builder `asarUnpack` 覆盖主包与平台二进制包（与 better-sqlite3 同等待遇）。注意 pnpm 不会自动安装传递平台包：Windows x64 构建已含 `canvas-win32-x64-msvc`，macOS/Linux 出包需在对应平台补齐相应 optional 平台包。
- 打包坑（重要）：rolldown 把 pdfjs 内部 `createRequire(import.meta.url)` 的 `import.meta` 置空（产物中字面量为 `{}.url`），pdfjs 自带的 Node 画布工厂与 DOMMatrix/Path2D polyfill 在打包后全部静默失效——纯文本路径不触发所以此前未暴露。修复为显式注入：`getDocument({ CanvasFactory })`（pdfjs 官方参数）传入按 create/reset/destroy 协议实现的 @napi-rs/canvas 工厂，并自行补 `globalThis.DOMMatrix`（进程内 worker 与显示层共用同一 globalThis）。
- 已验证：Prettier、Oxlint、三组类型检查、构建、131 项单元测试（新增页渲染、工具 pages 模式、loop 附图剥离与上限用例）、`pnpm smoke`、Windows 目录打包与打包产物 `--smoke-test` 启动；另在打包后的 pdfjs chunk 上直接运行渲染（注入工厂 + polyfill）产出合法 JPEG。**待验证**：真实视觉模型对页图像的理解效果、各 OpenAI 兼容端点对合成 user 图片消息的接受度、真实扫描件的识别质量。

## 2026-09-18（第六轮）renderer 全面 React 审查：useEffect 反模式与竞态修复

- 以 6 个并行审查代理覆盖全部 renderer（34 个含 effect 的文件、约 100 处 useEffect/useLayoutEffect 逐个判定），标准为 React 官方「You Might Not Need an Effect」+ StrictMode 双执行 + 竞态/泄漏。总体结论：外部系统同步（CodeMirror、pdf.js、IPC 订阅）cleanup 纪律良好；薄弱点集中在「await 后无条件 set」竞态、effect 重置派生状态与少数死代码。
- 竞态修复（P0）：ChatSessions 搜索防抖与删除后旧列表复活；ProjectView `open()` 在 submit await 后用旧闭包布局回写（与 closeTab 统一改读 `editorLayoutRef`）；MailView 冷启动 folders 窗口拽回收件箱与静默拆脏编辑器（后者接入既有 leaveComposer 确认流，openDrafts/openTrash 补导航计数）；MailComposer 卸载释放附件推迟一个宏任务（跳过 StrictMode 假卸载，生产全量释放不变；主进程仅发送路径释放暂存附件的现状由注释固化）；shuiyuan store loadMorePosts/submitReply/toggleBookmark 的 reading 身份守卫（toggleBookmark 回滚改 id 守卫 + 仅回退 bookmarked，引用守卫因乐观 apply 永不命中）；TimetableView loadSemester/loadEvents 请求计数守卫（loadEvents 依赖保持 `.getTime()` 内联形式，具名 deps 会触发 preserve-manual-memoization 告警）；`<img src="#">` 使 `new URL` 渲染期抛异常白屏（img 仅 http(s) 走代理，其余走既有 fallback）。
- 冗余消除：ToolTimeline 开合改 `override ?? autoOpen` 派生（删 touched ref + 重置 effect，自动收起不再晚一帧）；ChatComposer 候选高亮重置移入事件现场；ProjectView rootId/scope 重置改渲染期调整模式（消除切项目旧高亮与旧 tab 栏闪帧，E14 转正链顺序已复核）；AgentPanel 永不命中的 useMemo 删除；TopicReader 死代码重置 effect 删除（key 重挂载已承担）；AppShell 全局快捷键改「ref 存最新回调 + 空依赖注册」；App 内联 onFinished 导致 CompletionOverlay 定时器被通知推送重置。
- 卫生与一致性：workspace.load in-flight 去重（StrictMode 双 IPC）；ProjectView 高频宽度持久化 300ms 防抖 + setItem 统一 try/catch；MarkdownEditor placeholder 改 Compartment 热替换（修复 ReplyComposer 切换回复目标占位文案不更新）；ProjectDocument link() 改点击时刻 `getState()` 实时快照；MailView notify 单定时器接管 onSent、loadDrafts 竞态守卫、媒体查询常量化；MailReader 附件下载补 catch；LlmSection 挂载加载对齐 PluginsSection；ConnectionsSection 初始加载补错误展示；NotificationsView 首开不再闪「暂不可用」；resizer 卸载复位 resizing；ShuiyuanHeader 防抖不再覆盖显式点击（store 增 listSelection 序号）；markNotificationsRead 失败改 refreshList 而非旧快照还原；ReplyComposer 上传项 key 加序号；Timetable 同步不再重置选中教学周；WeekCalendar 当前时间线 60s 刷新；ChatComposer 批量插图计数改本地自增（消除 stale closure 绕过上限）。
- 已验证：Prettier（仅 `scripts/chat-smoke.cjs` 为本轮之前既有不合规，未动）、Oxlint 0 告警、三组类型检查、构建、131 项单元测试全部通过。**待实机验证**（时序类按约定由作者审阅）：冷启动邮箱快速点已删除/草稿不被拽回、脏编辑器深链弹确认、dev StrictMode 重开带附件草稿可保存发送、切项目无旧 tab 闪帧、楼层懒加载中快速切帖不复活、快速切学期/翻周不回跳、含 `#` 图的帖子显示占位而非白屏。
- 审查后明确不改、留待决策：AppShell 侧栏宽度不持久化（功能新增）；SourceList 全部课程「未标注学期」时非归档列表为空（产品语义）；MonthCalendar 拖拽鼠标窗口外释放（需 pointer capture 重写）；水源深链目标楼层不在首批时只滚一次（需核对主进程取楼窗口）；media.ts 会话级图片预览缓存只增不减（有意设计）；ProjectView 分栏 ratio 拖拽仍即时落盘（防抖会连带 tab 布局耐久性回归）。

## 2026-09-19 聊天区 Markdown 渲染增强：公式、图表、代码块控件与表格原生展示

- LaTeX 公式：启用 `@streamdown/math`（KaTeX，含单美元行内公式以贴合 LLM 输出惯例；`\(...\)` 不被 remark-math 解析）；`katex 0.16.47` 由传递依赖升为直接依赖以引入 `katex.min.css`（字体随包分发），块级公式超宽横向滚动。CSP 补 `font-src 'self' data:`——Vite 会把 KaTeX 小字号字体（Size3/4，括号/积分符号）内联为 data: URL，此前被 `default-src 'self'` 拦截（pdfjs 的内联字体同样受益）。
- mermaid 图表：启用 `@streamdown/mermaid`，但插件对象自带懒加载 `getMermaid`（首张图表渲染时才动态 import 真正的 mermaid 库，构建产物确认主 chunk 不含图表库）；主题经 `mermaid` prop 按当前明暗缓存配置，主题切换时引用变化触发重绘。
- 代码块：开启内置复制按钮（streamdown controls，中文文案），`markdownStyles` 以 grid 重排头部——语言标签与复制按钮并到右上角同一行，按钮悬浮/聚焦时才显示（透明度切换不占布局），sticky 跟随长代码块滚动；移除 `pre` 的 `overflow-auto`，横向滚动条从内容绝对底部回到 body 可视窗口边缘（纵向本就在 body 内，`codeBlockMaxHeight` 默认 400px）。
- 表格：`components.table` 换成自定义组件——去掉 streamdown 默认的卡片容器（边框 + bg-sidebar + 双层滚动盒），原生表格直接展示，外层仅留一个 `overflow-x-auto` 滚动容器承担水平滚动。
- 结构收敛：`markdown.ts` 升级为 `markdown.tsx` 并新增 `ChatMarkdown` 统一入口，ChatThread 三处与 ToolTimeline 说明文字共四处调用点共享插件/控件/表格/文案配置（此前说明文字不带 markdownStyles，本次顺带统一排版）。
- 已验证：Prettier、Oxlint、三组类型检查、构建、131 项单元测试、`pnpm smoke`；另以一次性 fixture 脚本（未提交）断言 KaTeX 节点渲染、代码块 grid/justify-end/按钮透明度/滚动条位置、复制按钮可点击、表格无 table-wrapper、mermaid 懒加载出 SVG、零控制台错误。悬浮显示与 sticky 跟随的实际观感由作者实机审阅。

## 2026-09-19（第二轮）Agent 输出上限提升与提供商降级

- 起因：用户遇到「模型输出达到长度限制，未执行未完成的工具调用」。根因是 2026-09-16 循环加固时写死的 `max_tokens: 8192`——它只是 DeepSeek 一代的输出上限，对长文档、长代码与大段工具参数而言很快触顶，且该分支会把已经流出的正文替换为中断说明，等于整段回答丢失。
- 改动：该值提取为常量 `MAX_OUTPUT_TOKENS = 32768`，与主流模型的输出量级对齐。
- 降级保护（关键）：部分提供商（模型上限 8k 等）对超过自身上限的 `max_tokens` 直接返回 400，硬提上限会把「回答更长」变成「整轮失败」。现在 400 响应体会被读一次并按 `max_tokens` 字样判定，命中即退回 `FALLBACK_OUTPUT_TOKENS = 8192` 重跑一次；降级重试不占用瞬时错误（429/5xx）的退避预算。无法识别的 400 仍按原样失败，不吞参数错误。
- 代码结构：原 `requestCompletion` 拆为只管退避重试的 `sendCompletion` 与负责降级的 `requestCompletion`，退避语义未改动。
- 已验证：Oxlint 0 告警、三组类型检查、134 项单元测试（新增「每轮请求携带 32768」「提供商拒绝后降级为 8192 并成功」「降级后仍被拒则如实失败」三条）。既有用例「不重试永久性 4xx」在实现中抓到一个标志位判定 bug（`in` 判存在而非判值，导致空响应体 400 也触发降级），已修正。
- 仍待决策：`finish_reason === 'length'` 目前无条件抛错，正文回答只是被截断（无未完成工具调用）时也会丢弃已生成内容并替换为中断说明。是否改为「无待执行工具调用时保留截断正文」属于产品行为选择，未擅自改动。

### 测试与验证

- 新增 `jsdom` devDependency（30.1.0，精确锁定，仅测试用）；新增 `blockCommands.test.ts`：真实 Editor 实例上的事务级回归测试（转换/列表归并与下标映射/引用往返/代码内容保留/移动往返/副本 id/缩进出入 Toggle），重点守住「块操作不得毁文档」。
- 已验证：Prettier、Oxlint 0 告警、三组类型检查、构建、152 项单元测试、`pnpm smoke`。**待实机验证**（作者审阅）：斜杠菜单手感、拖拽自动滚动、链接弹层、代码块 Enter/Esc 焦点往返、图片对齐按钮。
- 已知取舍：嵌套容器内部（如 Toggle 子块上）的 Mod+↑↓/Mod+D/转换仍作用于顶层祖先容器（Notion 作用于子块），属块操作层的下一轮范围；斜杠菜单内 Tab 确认、Cmd+Shift+↑↓ 键位未做。

## 2026-09-20（第五轮）Block 编辑器：全面 UX 复查与修复

流程：5 个并行审查 subagent（编辑器内核/块交互/斜杠与格式化/NodeView/主进程集成）复查前两轮全部 diff，关键结论对照 node_modules 内 tiptap/prosemirror/remark 源码或最小复现实证；随后按文件边界拆 4 个并行修复集群落地（互不触碰对方文件，集成后统一验证）。

### 数据安全级修复

- **外部内容同步计入撤销历史**：tiptap 的 `setContent` 只挂 `preventUpdate` 不设 `addToHistory`，外部重载后一次 Ctrl+Z 整篇回退，且该 undo 触发自动保存把旧内容写盘（静默覆盖刚接受的外部修改）。修复：chain 内 `setMeta('addToHistory', false)`，并按块 id 锚点保存/恢复光标（顺带改善分栏同文档对侧光标跳顶）。
- **空字符串 `.dela` 直接进错误面板**：新建空笔记默认 `.dela` 但落盘空串，parse 抛错且「重试」永远失败。`parseDelaDocument` 空/全空白返回空文档；`children: []` 兜底空段落。
- **相邻不同链接被并成一个范围编辑**（mark 只比类型不比 href，保存/移除互相覆盖）：改 `mark.eq` 比较。
- **InlineMathView 未用 NodeViewWrapper**：每个 mutation 批次抛未捕获异常并中断同批 mutation 处理。改 `NodeViewWrapper as="span"`。
- **atom 块句柄菜单命令作用到相邻块**（`from+1` 越过 nodeSize=1 的 atom，选区落到下一块）：菜单命令改为显式目标地址，删除绕道选区的 `menuSelectInto`。
- **Markdown 导出三连**：有序列表嵌套子块 2 空格缩进重解析逃出列表项（第 10 项起需 4 空格）；导出完全不转义（「费用$5 押金$10」往返变公式、`2*3*4` 变斜体）；导入 GFM 表格单元格连体。**导出整体迁移 remark-stringify**（remark 15 内置 stringify，零新增依赖）：Dela 树 → mdast → stringify，转义/缩进/标记宽度交给库；导入侧表格显式按行分段、单元格 `" | "` 连接。

### 块操作内核：深度感知（上轮已知遗留的根治）

- 操作单元（unit）从「顶层块」升级为「最近容器的直接子块」（列表→listItem、引用/Toggle→直接子块）：Mod+↑↓/Mod+D/转换/删除在同级兄弟数组内操作（listItem 连子树移动/复制、子树换新 id）；嵌套块转普通类型提升出容器（空容器级联移除）、转列表保持嵌套；句柄/＋菜单同样按悬停 unit 定位与操作。**拖拽落点仍为顶层粒度（下一轮）**。
- 转列表时子块不再粘连/丢弃：children 保留为列表项子块（代码/公式子块完整保留）。
- 块操作替换区间从整篇 `[0, size]` 收敛到受影响顶层区间（差异下标 + 列表归并段边界对齐 + 前后不动点锚定）：Mod+↑ 不再导致全文档 CodeMirror 实例重建（块内撤销史/滚动/语言加载保留）；新增测试断言局部替换与整篇替换产出 doc JSON 相等。
- 删除块后焦点归还相邻块（此前落在隐藏 trigger 上打字无反应）；文档删空兜底空段落。

### 编辑器会话与同步

- **切标签不再丢撤销历史/光标**：照 MarkdownEditor 的 sessions 模式缓存 Tiptap Editor 实例（按 `editorStateKey`，卸载不销毁、`forgetDocumentSessions` 时销毁；弃 `useEditor` 因其卸载必 destroy）。jsdom 测试覆盖 卸载→重挂载 历史保留、StrictMode 单实例。
- IME 组文期间到达的外部同步不再丢弃（pendingValue + compositionend 后应用，`setTimeout(0)` 等 PM 冲完组文事务）。
- 每键全文档序列化改 200ms 尾随去抖（blur/卸载/beforeunload/Ctrl+S 前 flush；Ctrl+S 先冲盘再保存）。
- 挂载首轮不再 emit：手工整理过的 `.dela`（键序/缩进不同）不再一打开就「未保存」被规范化重写。

### NodeView / 代码块 / 媒体

- readOnly 门控内嵌编辑器：CodeMirror（editable Compartment）、公式/说明/Toggle 摘要输入框、语言下拉统一随 `editor.isEditable`（此前只读视图里 CM 照常可改文档但不保存）。
- 代码块：`js/`ts 别名规范化（语言下拉不再空白）；末行 ↓/首行 ↑ 跳出代码块；写属性 300ms 去抖 + `addToHistory:false`（块内撤销由 CM 自管，不再双轨）。
- blockId 补号只扫事务变更区间（打字不再每键全文档遍历；拆块/粘贴复制 id 仍会命中全量补号）。
- 数学块 hover 展开源码导致整页跳动（违反动画稳定规则）：改为选中/双击编辑态展示源码，失焦/Esc 提交回渲染态。
- 图片加载失败占位卡片 + 重试（cache-bust query）；粘贴/拖入按主进程白名单 + 20MB 预检，失败显示错误条（不再静默）；粘贴后立刻切标签的 `isDestroyed` 守卫；斜杠插图片取消对话框零残留（改为选完文件再插）。
- KaTeX 错误信息放 title；容器内空段落不再显示大占位文案。
- 主进程：媒体写盘 `fs/promises` 化 + media 目录缓存（不再每请求查库+建目录）；协议缓存改 `immutable`（uuid 文件名不可变，不再每次重验证全量读盘）；HEAD 不建 body；svg MIME 复用白名单映射（`image/svg+xml`）；**更换存储目录 best-effort 复制旧 media 目录**（此前切目录后所有图片 404）。

### 定位与依赖（成熟库优先）

- 浮动层（文本工具栏/块工具栏/链接弹层）从手写 clamp 迁移 `@floating-ui/dom` 的 computePosition + flip/shift/offset/autoUpdate（滚动/resize 自动贴住选区，链接编辑滚动不再丢输入）；`@floating-ui/dom@1.8.0` 由传递依赖升为直接精确依赖，手写 clamp 常量（12/-150/320/8/-48/+6）删除。
- Markdown 导出迁移 remark-stringify（见上，零新增依赖）。

### 已验证

Prettier、Oxlint 0 告警、三组类型检查、构建、**182 项单元测试**（上轮 152 + 30：嵌套 unit 操作 13、编辑器会话 6、行内公式输入规则 6、Markdown 往返/表格 5 等）、`pnpm smoke`。**待实机验证**（作者审阅）：flip 翻转观感、数学块双击编辑、拖拽自动滚动渐变、链接弹层滚动跟随、Tab 确认手感、切标签后撤销历史。

### 已知取舍 / 遗留

- 拖拽落点仍只有顶层粒度（无法拖进列表项之间/引用内部），Notion 的左右缩进落点提示同属下一轮。
- 分栏同文档双窗格是「整篇替换同步」而非增量 diff（撤销/光标已不破坏，但打字高峰对侧整篇刷新）。
- 媒体孤儿 GC 未做（删块/删笔记/换封面后文件残留；需先决定 md 副本引用语义）。
- CM 内输入后 300ms 内直接关窗可能丢最后几字符（beforeunload 冲盘读 PM 属性，改它需动别人的文件）。
- 网页选区/图片 URL 拖入仍被丢弃（需主进程 `net.fetch` 转存）；远程图 src 无白名单（隐私考量待产品决策）。
- readOnly 下图片对齐/宽度拖拽、Toggle 折叠按钮仍可改 attrs（不保存，同此前的只读漏洞同源）。
- choose-directory 对话框文案仍写「已有文件不迁移」，而媒体现在会 best-effort 复制，文案待定夺。
- `preview.ts` 的 mediaMime 与 api.ts 的 mediaExtensions 是两份相同映射，未合并。

## 2026-09-20 系统托盘

- 主窗口关闭改为隐藏至系统托盘，进程、通知和后台同步继续运行；移除 Electron 默认原生菜单的退出入口后，仅托盘右键菜单中的“退出”会真正关闭应用。
- 托盘菜单提供打开主窗口、新建首页对话、新建项目和退出；前两项通过受限 preload 事件复用既有 renderer 导航与创建逻辑，不新增窗口或通用 IPC 通道。
- 已验证：Prettier、三组类型检查、生产构建与 `pnpm smoke`；`pnpm package:dir` 命令成功结束。
- 待验证：Windows 实机上托盘图标在浅色/深色任务栏中的可见性，以及关闭、菜单新建与退出的完整交互。当前 `dist/win-unpacked/resources/` 为空，产物仅含通用 `electron.exe` 且启动即退出，故暂不能以该包验证；该打包产物问题不由本次改动引入。

## 2026-09-20 Markdown 笔记编辑器方向调整（规划）

- 用户确定以笔记制作和阅读为重点，采用 Markdown 所见即所得方向，常见代码文件提供预览与 VS Code 外部打开入口。
- 新增根目录 [plan.md](../plan.md)，记录格式契约、开源候选、架构边界、旧分支和依赖清理策略、实施阶段及验收。
- 当前仅完成规划和官方资料核对，未替换编辑器或更改依赖；Milkdown/Crepe 为首选验证方案，尚未完成本地集成验证。

## 2026-09-20 Markdown 所见即所得笔记编辑器（实施）

按 [plan.md](../plan.md) 四阶段完成实施。探针结论已转换单元测试长期保留，探针脚本本身删除。

### 阶段一：内核选型（已验证）

- 选定 **Milkdown/Crepe 7.22.1**（MIT，ProseMirror + remark），经 `@milkdown/kit` 7.22.1 组装；无需 fork 内核。中文界面文案经 `featureConfigs` 以 DeepPartial 覆盖（工具栏/斜杠菜单/链接/图片/代码块搜索）。
- 往返保真（jsdom 单测固化）：标题/列表/任务列表/表格/代码块/引用/行内与块级公式语义保留，第二遍稳定；原始 HTML、HTML 注释、脚注原样保留。序列化存在风格规范化：`-`→`*`、`---`→`***`、setext→ATX、缩进代码→围栏、裸链接→`<...>`、尾空格换行→反斜杠。
- **内核缺陷与修复**：image-block 默认把标准 Markdown 的 alt 当宽高比数字（`![截图](x.png)` 会序列化成 `![1.00](x.png)`）。在 `create()` 前覆盖 `imageBlockSchema` 的 parseMarkdown/toMarkdown runner，改为 alt↔caption 往返并保留 title（`NoteEditor.tsx` 的 `fixImageBlockSchema`，导出供单测复用）。
- **frontmatter 会被破坏**（分隔线化 + setext 标题化）：`shared/note-files.ts` 用正则检测，识别到即整篇停留源码模式并提示，正文原样保存。

### 阶段二：笔记闭环

- 新建笔记默认补 `.md`（用户显式带扩展名时尊重）；文档区按笔记/文件三态路由：**所见即所得**（Crepe）/ **阅读态**（Crepe 只读）/ **源码模式**（原 CodeMirror），会话内按文档记忆。
- `NoteEditor` 封装：Crepe 实例按 `note:${documentKey}:${viewId}` 缓存，切换标签时 DOM 移入隐藏暂存节点保活（撤销历史/光标/滚动），彻底关闭由 ProjectView 的 forget 清理；IME 组文期间推迟外部值整篇同步，组文结束补一次；跨分栏对侧同步 200ms 尾随去抖 + `replaceAll` + 光标按新文档大小收敛；Mod+S 保存，常规输入沿用 store 600ms 自动保存与 revision 冲突检测（与 Agent 写笔记同一路径）。
- 图片：`onUpload` 把图片写进笔记目录 `assets/`（重名加序号，上限 20MB，扩展名白名单），Markdown 里保存相对路径；显示经 `proxyDomURL` 改写为 `dela-resource://note-asset/<ref>?id=<entryId>`，主进程按条目目录解析（防 `..` 穿越、仅图片 MIME、不暴露磁盘路径）。CSP 已含 `dela-resource:`，无需放宽。
- 导入/本地 Markdown 菜单新增**创建可编辑副本**：复制为笔记（根级图片引用收进 `assets/`、子目录引用保留目录结构、正文引用随之改写），无法访问的图片按路径上报提示；副本创建后直接打开。
- 笔记移动到其他目录：按原相对路径复制携带图片、**正文不改写**（revision 不变，草稿不冲突）；工作区外的引用不携带。

### 阶段三：代码文件与清理

- 本地/导入的文本与代码文件内嵌**只读 CodeMirror** 预览（语法高亮按扩展名异步加载、Mod-f 搜索面板、原生复制）；只读用 `EditorState.readOnly`（保留可聚焦，搜索/键盘选择可用）。
- 文档标题栏新增外部打开入口：文本/代码文件为**在 VS Code 中打开**（`where/which code` 探测 CLI，Windows `.cmd` 经 shell 引号启动，5s 超时视为已拉起；失败提示改用"在文件夹中显示"），PDF/图片等为**在默认应用中打开**（`shell.openPath` 并检查错误）。
- `.dela` 数据核查（只查元数据，未读内容）：本机仅 `workspace/Dela开发/test.dela` 一个文件（2026-09-20 生成的开发测试文件），数据库 0 条引用。按计划不开发迁移，原文件保留未动。
- 依赖清理：无孤儿依赖；新增 `@codemirror/search` 6.7.2（搜索面板）、devDep `jsdom` 30.1.0（编辑器单测）。`@milkdown/kit` 在 pnpm 下需按 peer 变体锁定锁文件 importer 条目。

### 阶段四：验证

- **已验证（自动化）**：Prettier、Oxlint 0 警告、三组类型检查、生产构建、`pnpm smoke`、`package:dir` 及打包产物 `--smoke-test` 启动；18 个测试文件 154 项单测（新增 20：共享 note-files 9、主进程工作区/图片/副本/移动/冲突 7、Crepe 往返保真 4）。测试过程抓出并修复真实 bug：`buildMarkdownImage` 依赖 `encodeURIComponent` 编码括号，但括号属 RFC2396 unreserved 不被编码，Windows 常见"文件 (1).png"会破坏 Markdown 语法。
- **性能记录（诚实边界）**：jsdom（无真实布局引擎）下 Crepe 创建 0.4KB 笔记 151ms、22KB 笔记 3.2s、getMarkdown 82ms，数字仅作量级参考；renderer 主分片 3096KB minified（含 Crepe；改动前精确值未留存），语言/主题懒加载分片来自既有 `@streamdown/*` 与本次无关；`win-unpacked` 975MB 以 Electron 自身为主。
- **待验证（用户实机审阅，不用 Playwright/探针替代）**：中文 IME 输入与粘贴、表格/公式编辑交互、阅读态与模式切换动画、冷启动与长笔记真实输入延迟、VS Code 打开在实机的行为。

## 2026-09-21 所见即所得编辑器实机反馈打磨

用户实机审阅后反馈三类问题，本轮处理：

- **书写区靠左**：取消 `.milkdown` 自动居中，并把主题默认内层 60px/120px 大内边距收为零，水平留白统一由 `.milkdown` 的 32px 提供；`max-width: 46rem` 维持可读行宽。
- **链接输入规则缺失（支持不完整的确证）**：核对 `@milkdown/preset-commonmark` 源码，其输入规则仅覆盖加粗/斜体/行内代码/引用/列表/标题/代码块/分隔线，没有链接——逐字输入 `[文本](地址)` 不会转换（从 Markdown 源加载则正常）。在 `NoteEditor` 补一条 ProseMirror `InputRule`（键入 `)` 触发，替换为带 link 标记的文本），jsdom 测试经 `handleTextInput` 模拟键入固化。
- **对比度与边界**：标题 h1–h5 加粗到 600；块引用改深色竖条 + 浅底圆角；行内代码改不透明浅底 + `--syntax-constant` 色；分隔线由 outline 透明 80% 改为实色 border；列表标记/行号改中层灰（原 outline=border 色几乎不可见）；列表标签列 24px→20px、间距 10px→4px 收紧缩进；`--crepe-color-outline` 从 border 色改为 muted-foreground，勾选框等边界随之加深。
- **代码块与公式美化**：代码块容器（块公式同构）改 muted 底 + 1px 边框 + 8px 圆角，内部 CodeMirror 背景透明化；公式预览区加留白、分隔线加深。
- 已验证：Prettier、Oxlint 0 警告、三组类型检查、18 个测试文件 155 项单测（新增链接输入规则 1）、生产构建与 `pnpm smoke`。
- 待验证：用户实机复看样式观感与输入体验（动画不作自动化判定）。

### 第二轮反馈（交互反馈与配色回调）

- **复制按钮点击反馈**：Crepe 复制组件无已复制状态（`onCopy` 仅回调无视觉），在会话根上委托监听 `.copy-button` 点击，把 `.milkdown-icon` 临时换成同规格对勾 SVG（同 viewBox/尺寸，样式规则自动复用）后 1.5s 还原；不拦截组件自身复制逻辑，`dataset.copied` 防连点重入。
- **活动行号徽章减淡**：截图中的深色徽章来自 CodeMirror 基础主题的 `&dark .cm-activeLineGutter`（#222227），来源（为何暗色变体生效）未查明但不影响修复——直接以更高优先级覆盖为主题蓝 14% 半透明晕染 + 4px 圆角。
- **选中文字改蓝**：`--crepe-color-selected` 从 accent 灰改为 `--syntax-caret` 30% 半透明（影响 ::selection、选中节点、工具栏按下态）。
- **悬浮工具栏对比度**：容器加 1px 边框并升级为 shadow-2；悬停底色改前景色 12% 半透明（明暗主题都明显加深）、图标同步加深，均带 120ms 过渡。
- **行内代码回调**：撤销上一轮改动——删除 `.ProseMirror code` 覆盖块，`--crepe-color-inline-code` 恢复映射到 destructive，回到主题默认方案（红字 + inline-area 40% 透明底）。
- **书写区左 padding**：32px→48px。
- 已验证：Prettier、Oxlint 0 警告、三组类型检查、155 项单测、生产构建。待验证：复制按钮动效、工具栏悬停过渡等动效观感（实机审阅，不作自动化判定）。

### 第三轮反馈（代码块黑底与书写区回中）

- **代码块改黑色背景**：整卡固定为 GitHub Dark 深色（#0d1117 底 + #30363d 边框），明暗主题下一致；上一轮的浅蓝行号晕染撤销。实现分两层：`--syntax-*` 在 `.milkdown-code-block` 上局部覆盖为 GitHub Dark 色板，经 `CodeMirror` featureConfig 的 `extensions: [syntaxHighlighting(...)]` 注入 lezer `HighlightStyle`（引用同名 CSS 变量）替换 basicSetup 的浅色 fallback 高亮；`--crepe-*` 同域重映射（surface/on-surface/outline/hover 等）让工具行、语言搜索框、公式预览面板整体转深色。当前行高亮改白 8% 叠加带、行号白 14% 带并提亮，矩形整行（去掉此前的圆角"药丸"形）；CM 自绘选区/光标跟随主题蓝。CM 原生选区与光标由 drawSelection 以 `Prec.highest + !important` 隐藏，因此只需样式化 `.cm-selectionBackground`/`.cm-cursor`。
- **书写区回中**：应用户改需求撤销左对齐，`.milkdown` 改 `margin: 0 auto`，max-width 46rem→60rem 减少宽屏两侧空白。
- 已验证：Prettier、Oxlint 0 警告、三组类型检查、19 个测试文件 164 项单测（含他人新增的 onboarding 测试）、生产构建。待验证：黑底代码块在明暗两主题下的观感、语法高亮配色、居中后行宽手感（实机审阅）。

### 第四轮反馈（行内公式溢出与代码块头部统一）

- **行内公式确认按钮溢出**：主题把 `.milkdown-latex-inline-edit` 确认按钮固定为 24×24（为图标设计），中文"确定"折成竖排；改为 `width: auto + nowrap` 随内容展开（min-width 24 保持图标兼容）。
- **代码块头部两按钮统一**：语言徽章与复制按钮原样式来源不同（4px 直角 vs 100px 药丸、20px vs 24px 高、不同内边距，语言徽章还有 8px 下边距错位）。统一为 24px 高、6px 圆角、同底色（surface-low）的头部芯片；复制按钮改纯图标（`font-size: 0` 隐藏文字节点，"复制"文本保留给读屏）；数学块的预览切换按钮本就是纯图标，同规则自然一致。
- 注意点：crepe 的 `:first-child/:last-child` 药丸规则在 CSS 级联中后于本文件加载（组件样式后导入），同特异性会胜出，覆盖时需带 `.copy-button` 类提高特异性。
- 已验证：Prettier、Oxlint 0 警告、三组类型检查、164 项单测、生产构建。待验证：确认按钮展开观感、头部芯片对齐与纯图标复制（含点击对勾反馈）实机审阅。

### 第五轮反馈（代码块双主题）

- **代码块 GitHub Light/Dark 跟随应用主题**：撤销固定黑底方案。语法高亮 `--syntax-*` 不再局部覆盖，直接继承全局 token（globals.css 的 `:root` 为 GitHub Light、`.dark`/系统深色为 GitHub Dark，两套 Primer prettylights 色板现成），HighlightStyle 里的 `var()` 引用随元素解析自动翻转。中性表面色（卡片、边框、文字、crepe 组件重映射、行高亮叠加带）拆为浅/深两套，深色作用域镜像 globals.css 的双选择器（`@media prefers-color-scheme: dark` 下 `:root:not(.light)`，及手动 `:root.dark`）。行高亮叠加从写死的白 8%/14% 改为局部变量 `--code-line-overlay`/`--code-gutter-overlay`（浅色黑 4%/8%，深色白 8%/14%），避免规则级重复；CM 选区改 `color-mix(var(--syntax-caret) 30%)` 与正文选区同一公式，自动明暗翻转；活动行号提亮色改用 `--crepe-color-on-surface`。
- 浅色值取 GitHub Light/Primer：卡片 #f6f8fa、边框 #d0d7de、前景 #1f2328、芯片 #eff2f5、次级文字 #59636e、图标/边线 #8c959f、悬停黑 6%。
- 已验证：Prettier、Oxlint 0 警告、三组类型检查、164 项单测、生产构建。待验证：明暗切换（手动与跟随系统两条路径）下代码块两套观感与可读性（实机审阅）。

### 水源社区 Header 窄屏两行化

- 窄屏（lg 以下）原为纵向三行（个人入口 / 筛选器 / 刷新+搜索），改为两行：首行=收藏/通知/私信 + 刷新/搜索（操作类），次行=最新/精品、类别、标签筛选（过滤类）；宽屏三区网格（左入口/中筛选/右搜索）不变。
- 实现方式：首行加包装 div 管两行布局，`lg:contents` 在宽屏把包装拆散（display: contents），三个功能区成为网格直接子项并显式 `lg:col-start/row-start` 定位；刷新/搜索组窄屏 `flex-1 + justify-end`（搜索沿用 min-w-32/max-w-56 伸缩），宽屏 `lg:ml-0 + justify-self-end` 恢复原三区。DOM 顺序即窄屏视觉与读序（入口→刷新/搜索→筛选）。
- 已验证：Prettier、Oxlint、类型检查、164 项单测、生产构建。待验证：窄屏两行观感与极窄宽度下筛选器折行（实机审阅）。

### 资料树减噪与缩进对齐线

- **目录 icon 分层**：`Explorer` 通用树中目录（含项目 FolderKanban）icon 只保留到树的第二层（课程资料里=学期与课程目录，我的资料里=项目及其子目录），第三层及更深目录只留折叠箭头与文字；叶子文件的类型 icon（FileText/自定义）不受影响。若要把"一级目录的子目录"也去 icon，把 `showIcon` 的 `level <= 2` 改为 `<= 1` 即可。
- **缩进对齐线（VS Code 风格）**：每行按层级渲染绝对定位的 1px 竖线（不参与 flex 布局，原 padding/gap 几何零改动），线居中于各 16px 缩进列；亮段跟随选中项的祖先链（含选中项自身），非链上为 border 色。选中为空时全部用暗线，仍提供层级参照。
- 已验证：Prettier、Oxlint、类型检查、164 项单测、生产构建。待验证：树层级观感、对齐线明暗对比（实机审阅）。

### 资料文件管理：隐藏平铺「文件」目录与课程归档

- **隐藏「文件」平铺目录**：各课程同步数据中的 `${courseId}:files` 根目录是 Canvas 全部文件的平铺集合，与课程模块等组织视图重复。SourceList 渲染时按祖先链过滤该分支（同步数据保留，磁盘目录与下载路径不受影响）；代价是未被任何模块引用的文件在树中不可见（按"上游文件皆已组织"的暂时约定接受）。
- **课程归档**：`CanvasCourse` 新增 `archived` 字段（随课程 JSON 持久化，课程列表重同步时保留）。课程"更多"菜单新增"归档/取消归档"，归档走 `window.confirm` 二次确认（应用既有确认模式）；归档课程展开不触发自动同步、徽章显示"已归档"替代错误 "!"，菜单随时可取消归档。新增 IPC `canvas:archive-course` → `archiveCanvasCourse`。
- **刷新范围**：`refreshCourses` 本就只同步最新学期课程，现再排除已归档课程，避免令牌失效的旧课程反复报错。
- 已验证：Prettier、Oxlint、三组类型检查、20 个测试文件 170 项单测（含并行新增文件）、生产构建。待验证：归档流程与「文件」目录隐藏的实机表现（实机审阅）。

## 2026-09-21 水源标题 emoji 短代码渲染与信息流元信息分区

用户实机反馈两类问题：标题里 `:ocean:` 一类 Discourse emoji 短代码以原文显示；卡片底部元信息（分类/标签/回复/浏览/时间）一行平铺显得繁杂。

- **标题 emoji 补全**：Discourse 列表接口的 `title` 就是含短代码的原文，站内网页靠前端替换。Dela 侧新增 `shuiyuan-emoji.tsx`：标准短代码经 `gemoji`（1913 个名字，新增依赖，纯数据）映射为 Unicode emoji 字符（Chromium 原生彩色渲染）；站点自定义 emoji 取自 `site.json` 的 `custom_emoji`（随既有 `siteStructure` 缓存下发，`ShuiyuanSiteStructure` 新增 `customEmoji` 字段），渲染为行内 `<img>`（1.1em，基线对齐；CSP `img-src` 已放行 https，与头像同机制）。`ShuiyuanTitle` 组件接入四处标题：信息流卡片、阅读页头部、收藏列表、项目来源卡。已知边界：gemoji 与 Discourse 命名存在少量差异（如 `female-student` 等较新名字），此类短代码保持原文；通知句子里的 `fancyTitle` 为纯字符串上下文（无法内联图片），暂不处理。
- **短代码识别边界**：`(?<![a-zA-Z0-9]):([\p{L}\p{N}_+-]+):(?![a-zA-Z0-9])`，前后不接 ASCII 字母数字，避免误吃 `14:30:00`、`3:2:1`；未注册短代码保留原文（与 Discourse 对未注册名一致），不做剔除。
- **信息流元信息分区**：底部一行改为左右两簇——左侧分类（色点+名）/私信徽章/标签（可折行），右侧回复数/浏览数/时间（`shrink-0`），去掉居中的 `·` 分隔符。
- 已验证：Prettier、Oxlint 0 警告、三组类型检查、20 个测试文件 170 项单测（新增短代码解码 6 项）、生产构建。待验证：自定义 emoji 行内图片的基线对齐与加载表现、左右分区在窄屏折行下的观感（实机审阅）。

### 归档行为收敛：归档课程移入「归档」区平铺展示

- 上一轮归档课程仍留在学期目录下、以「已归档」徽章区分；按用户反馈改为**直接移出上层目录**：SourceList 的学期树不再渲染已归档课程，归档课程统一平铺挂在底部既有「归档」折叠区（原学期归档视图）顶层，与旧学期课程并列；展开可见已同步内容，且不触发自动同步。
- **恢复入口**：「归档」区内的课程节点保留「更多」菜单，取消归档后课程回到其原学期目录（确认文案同步更正；原「随最新学期刷新」表述不准确——旧学期课程取消归档后仍归旧学期）。
- **归档后自动展开**：SourceList 新增可选 `onArchive` 回调，上层视图传入 `() => setArchiveOpen(true)`，归档成功后底部「归档」区自动展开，课程直接可见。原先的「已归档」徽章随之移除（归档区内语境已明确，也不再需要错误 "!" 抑制逻辑）。
- 已验证：Prettier、Oxlint、三组类型检查、170 项单测、生产构建。待验证：归档→自动展开→恢复全流程实机表现（实机审阅）。

### 树视图拖拽区域高亮与选中态加深（VS Code 式）

- **拖拽落点区域化**：Explorer 的拖拽模型从"行级落点"改为"目录区域落点"。目标目录行与其全部可见后代行连成一块高亮（去圆角、整色 `bg-foreground/10`），内部拖拽与外部文件拖入共用该模型。悬停叶子行时落点经 `anchorBranch` 解析到所属目录，扫过子项不再丢失高亮，整块区域都是可落点（drop 时同样解析到所属目录，顶层叶子行仍交给树根）。原行级 `onDragLeave` 移除：行间移动由各行 `onDragOver` 接力更新目标，指针离开整棵树时由树根 `onDragLeave` 无条件重置（原来只覆盖外部文件拖拽），消除 dragleave/dragover 交界的闪烁。
- **选中态加深**：原选中行 `bg-accent`（浅色主题 L0.97，比侧栏背景 L0.955 还浅，几乎不可见）改为 `bg-foreground/10`（浅色 ≈ L88，深色 ≈ L28，两主题均明显）。悬停态 `bg-accent/60` 未动。
- **取舍说明**：VS Code 的落点高亮是蓝色，但 Dela 主题交互色全部为中性灰（primary/accent/ring 均无彩度），未为拖拽单独引入蓝色 token，落点区域与选中态同用 `bg-foreground/10`，靠"整块矩形区域 vs 单行圆角"区分；若需要蓝色落点需新增主题 token。
- 已验证：Prettier、Oxlint、三组类型检查、170 项单测、生产构建。待验证：拖拽区域高亮的实机观感与落点准确性、选中态加深程度（实机审阅，拖拽交互不做自动化视觉验证）。

## 2026-09-21（第二轮）楼层交互：喜爱 / 引用 / 回复入口强化（贴表情经实测不可行后收敛）

用户反馈阅读页交互太弱：常见动作（贴表情、回复、引用）里贴表情缺失、喜爱只能看不能点、回复入口是标题行里悬停才出现的小图标。初版按 discourse-reactions 插件实现了贴表情（回应 chips + 表情弹层），实机返回 404；经用户授权用其 key 实测确认**水源没有安装 discourse-reactions 插件**（全部路由变体 404，楼层序列化无 `reactions` 字段），贴表情在服务端不存在支撑，功能整体移除并收敛为标准 Discourse 点赞。

- **楼层操作行**：每楼正文下新增常驻操作行（官方 Discourse 同位）——喜爱（heart，含计数；已喜爱红色填充且按钮禁用，悬停提示「取消点赞需到水源网页端」）、引用、带文字底色的「回复」按钮。原标题行的悬停小按钮与纯数字赞展示移除，触屏/窄屏不再依赖 hover。底部回复安静入口 h9→h10 并加悬停描边。
- **数据与接口**：`ShuiyuanPost` 以 `liked`（`actions_summary` id=2 `acted`）替代原 `reactions` 字段；新增 `shuiyuan:set-liked` IPC。点赞端点经真实 key 实测：`POST /post_actions.json`（`{id, post_action_type_id: 2}`）200；`DELETE /post_actions/:id.json` 被站点 403 拒绝（write scope 不含 post_actions#destroy），故客户端只支持点赞、不支持取消，取消引导去网页端。store 乐观翻转 + 计数 ±1，失败回滚到 reading 前值。
- **已验证**（2026-09-21，用户授权其私信贴 518172 实测）：点赞写入生效（实测楼层 like `{"count":1,"acted":true}`，该测试赞保留在帖上、可在网页端撤销）；重复点赞 403；read 侧 `actions_summary` 形状确认。Prettier、Oxlint 0 警告、三组类型检查、20 个测试文件 170 项单测、生产构建。待验证：操作行/回复按钮观感（实机审阅，交互按钮不做自动化视觉验证）。

### 拖拽提示收窄到目录区与落点强调色区分

- **覆盖层收窄**：拖入本地文件时的变暗覆盖层原挂在 ProjectView shell 上（`absolute inset-0` 盖住编辑器在内的整个视图），移入 `workspace-explorer` 容器（补 `relative`），只在目录区域内变暗并显示「释放以导入到项目」提示；树的滚动容器本就是唯一 drop 入口（shell 无 drop 处理），行为与视觉自此一致。
- **落点强调色独立**：落点区域由 `bg-foreground/10`（与选中态同色）改为新增主题 token `--drop-target`（浅色 oklch(0.935 0.022 250)、深色 oklch(0.297 0.036 255)，取值同日历蓝，经 `@theme inline` 映射为 `bg-drop-target` 工具类）；选中态保持中性灰 `bg-foreground/10`，两者以色相区分（VS Code 同款灰选中/蓝落点模型）。
- 已验证：Prettier、Oxlint、三组类型检查、170 项单测、生产构建。待验证：落点蓝色在明暗主题下的观感、覆盖层范围（实机审阅）。

### 移除拖入变暗覆盖层，仅保留落点区域高亮

- 用户反馈变暗覆盖层与「释放以导入到项目」浮块遮挡内容。整体移除该覆盖层（含 `draggingFiles` 状态、`onDragEnter`/`onDragLeave` 处理器与孤立的 `DragEvent` 类型导入）；拖入本地文件时唯一的视觉反馈即 Explorer 的蓝色落点区域高亮（`--drop-target`）。树的滚动容器仍是唯一 drop 入口（`onDragOver` 的 Files 分支保留 preventDefault 以允许落点），行为不变。
- 已验证：Prettier、Oxlint、三组类型检查、170 项单测、生产构建。待验证：无覆盖层后拖入引导是否足够直观（实机审阅）。

## 2026-09-22 关于页致谢名单数据化（credits）

关于页 Author 区此前全部硬编码（姓名/链接/头像/收款码写死在 `AboutSection.tsx`），无法扩展协作者、赞助者等栏目。改为声明式数据驱动，为后续栏目预留结构。

- **数据模型**：新增 `features/settings/credits.ts`，`CreditSection`（title/people）→ `CreditPerson`（name/avatar/links?/sponsor?）→ `SocialLink`（kind/url/label?）与 `SponsorChannel`（kind/qr/label?）。数据与类型同文件、随源码打包进渲染产物：更新名单走 PR + 发版，用户端无法修改（不走外部 JSON 运行时读取；若未来需要免发版更新名单，升级路径为同一 schema 挪远端 + Ed25519 签名校验 + 内置公钥，UI 不动）。
- **素材组织**：作者与赞赏素材从 `assets/` 根目录移入 `assets/credits/changyo/`（avatar.jpg、wechat.png、alipay.png），按 `credits/<人物id>/` 约定扩充；纯 JSON 无法引用打包资产，故数据文件用 TS 模块静态 import 图片。
- **图标注册表**：`socialLinkMeta`/`sponsorChannelMeta` 按 kind 映射图标与默认文案（`Record<SocialLinkKind, …>` 穷举，新增 kind 未注册图标时类型报错）；lucide 无品牌图标，GitHub/知乎标记内联自 simple-icons。
- **渲染泛化**：赞赏弹窗参数化为 `SponsorDialog`（按人渲染通道与备注，note 缺省时不渲染描述行）；栏目统一渲染为「标题 → 标题下分隔线（`pb-2`）→ 成员行」（成员行 = 左头像姓名 `PersonIdentity`、右链接图标+「赞赏」按钮 `PersonActions`），栏目间距放大（根 gap 5→8）形成分组亲密性。布局经两轮实机审阅收敛：初版 chips、其后 featured/grid 双布局均被推翻，按用户示意稿定稿为单一格式，`CreditSection` 的 `id`/`layout` 字段因与 title 重复/不再需要而移除。新增栏目 = 数据文件加一个 section，不碰组件。
- **示例数据**：Sponsors 栏目加入首位赞助者「冰啤史莱姆」（知乎链接，暂无收款通道）。
- 已验证：Prettier、Oxlint、三组类型检查、单测、生产构建。待验证：标题下划线与栏目间距观感（实机审阅）。

## 2026-09-29 web_search 后端切换到自建 SearXNG

用户在阿里云 ECS 部署了 SearXNG（`http://47.117.158.218:8778`），`web_search` 从抓取 DuckDuckGo lite HTML 改为调用其 JSON API。

- **实现**：`searchWeb` 改为 GET `/search?format=json`（region 映射为 SearXNG `language` 参数），15s 超时；DDG 专用代码整体移除（Cookie 复用、lite 结果页/跳转链接解析、防机器人检测）。`fetch_page` 与 URL 安全校验不变。
- **错误语义**：HTTP 非 200 明确报错，403 单独提示服务端 `search.formats` 未含 json；结果为空且 `unresponsive_engines` 非空时报「全部引擎无响应」并列出引擎名，不静默返回空结果。
- 已验证（客户端）：web-search 单测（JSON 映射、请求参数、错误路径）、Oxlint、三组类型检查。待验证：实例搜索能力——2026-09-29 实测该实例所有查询（含 `q=test`）瞬时返回空 `results` 且 `unresponsive_engines` 为空，即服务端未选中任何引擎（疑似引擎被禁用或容器出网受阻，需服务端排查 `settings.yml` 引擎配置与出网）；实例修好后客户端无需改动。另注意该实例无鉴权、公网可访问。

## 2026-09-29（第二轮）右键菜单、用户消息复制/编辑、composer 光标与代码块头部

- **右键菜单**：应用菜单为 null 时全应用没有任何剪切/复制/粘贴入口。新增 `attachContextMenu`（`src/main/ipc.ts`）挂到主窗口与水源授权/教务登录两个窗口：按 `editFlags` 动态出项（撤销/重做/剪切/复制/粘贴/全选），链接处追加「复制链接地址」；无可操作项时不弹。
- **用户消息操作**：气泡下新增悬停操作行（`group/user`，与回答的 MessageActions 同款显隐）——复制（所有用户消息）；最新一条用户消息另有「编辑并重新发送」。编辑为内联 textarea（Enter 发送、Shift+Enter 换行、Esc 取消，IME 组词中的 Enter 不触发），确认后走新增 `editAsk` IPC：主进程在 `ask()` 内定位最后一条用户消息并截断其后内容（含该消息），以新文本重跑原流程——仅改内存快照，持久化仍发生在流式输出阶段，失败时数据库保持原样。原图经 token 按原样补回（`message.images` → `dela-img` token），附件与 @ 引用不保留、需重加；截图中的媒体文件在截断到重新持久化之间仍被旧消息引用，无 GC 风险。
- **composer 光标**：CM6 内置 `placeholder()` 是 pos 0 上的 side-1 原子 widget，空文档点击时光标视觉上落在占位文字右侧而实际插入点在文档开头。改为自绘覆盖层（`pointer-events-none` 绝对定位，随 `value` 为空显隐），与 `.cm-scroller` 内边距共用同一常量；光标始终停在行首，点击行为与 ChatGPT 一致。
- **代码块头部**：原版式把语言标签挤在整行空白头部的右端（容器 gap-2 + body 内 pre 的 my-2 叠加出约 80px 空带）。参照 DeepSeek 网页版改为无界一体化卡片：容器只用 `bg-muted + rounded-lg` 描面，并显式 `border-0` 压掉 streamdown 自带边框类（只删自己的覆盖类压不住它）；头部与代码之间不画分隔线。头部（左侧语言标签）自身 `sticky top-2 z-10 bg-muted`，与 streamdown 复制按钮（同为 sticky top-2 z-10、经 `-mt-8` 负 margin 叠到头部行）同位同层——长块滚动时语言标签和复制按钮一起钉在块顶，代码从其下滚过。语言标签经 header `px-2` + span 自带 `ml-1` 与代码 `p-3` 左缘对齐，复制按钮行加 `pr-3` 与代码右缘对齐。容器不用 `overflow-hidden`（破坏 sticky），圆角由 header（上）/pre（下）分担。
- **代码块布局踩坑（grid 塌缩）**：第一版用 grid（`grid-cols-[1fr_auto]` + header/body `col-span-2` + actions `col-start-2 row-span-2`）重排，实机整块错乱（语言标签/复制按钮/代码整体右移，左侧大片空白）。用构建产物 CSS + streamdown 真实 DOM 搭最小复现页实测：code-block 容器带 streamdown 自带的 `content-visibility: auto`，其上 grid 的 `auto` 列塌缩为 0px，`span N/span N` 型放置（tailwind `col-span-2`）还会落进隐式第 3/4 列；去掉 content-visibility 也不恢复正确列数。结论：不要在这个容器上用 grid 重排，旧版式一直靠 flex-col + 复制按钮包装层的负 margin 叠加工作。最终版回归该机制，仅把 `-mt-10` 收紧为 `-mt-8`（配合 body 内 pre `my-0`，正好叠住 h-8 头部行）。复现页已删除。
- 已验证：Prettier、Oxlint 0 警告、三组类型检查、202 项单测；DeepSeek 式代码块另经真实浏览器复现页测量与截图验证（无边框无分隔线、语言标签与代码左缘对齐、滚动 400px 后 header 与复制按钮行同位钉在 y=8）。待验证（实机审阅）：右键菜单各项在实际选区/可编辑区的出项、用户消息编辑重发的端到端（含带图消息）、空 composer 点击光标位置、代码块在明暗主题下的观感与长块滚动钉住效果。

## 2026-09-29（第三轮）mermaid 全屏查看、复制按钮轻量化与 mermaid 字体

- **mermaid 全屏**：streamdown 的 mermaid 块自带全套查看能力（右上角按钮 → portal 全屏：拖拽平移、滚轮/按钮缩放 0.5–3.0、Esc/按钮/点击遮罩退出，全屏期间锁定页面滚动），此前被 `controls.mermaid: false` 整体关闭。改为 `mermaid: { copy: false, download: false }`——fullscreen 与 panZoom 未设置即默认开启，只关掉用不到的复制/下载；工具文案补中文（全屏查看/退出全屏/放大/缩小/重置视图）。复现页实测：放大按钮 1→1.1、拖拽 translate +130/+100、滚轮 1.1→1.2、X 与 Esc（document keydown）退出、点击全屏层内容不误关。注意 streamdown 默认行为：非全屏的内联查看器上滚轮是缩放而非滚动页面（min 0.5–max 3）。
- **复制按钮**：streamdown 自带的底色小胶囊（border + bg-sidebar/80 + backdrop-blur + px/py）在无界卡片上突兀且偏大。压成纯图标：容器 `border-0/bg-transparent/p-0`，按钮图标 16→`size-3.5`（14px，贴近 cpp 标签字号）+ `rounded-md`，悬浮才显 `bg-foreground/10`；点击反馈用 `:has(output)`——streamdown 复制成功时会短暂渲染 sr-only 的 `<output>` 播报元素，据此把按钮染成绿色（明 `text-emerald-600`/暗 `text-emerald-400`，与消息气泡复制按钮一致；图标 svg 无 class，无法直接定位 check 图标）。选择器用 `div[data-streamdown=…]` 提高特异性，压过自带的 `supports-[backdrop-filter]` 变体。mermaid 块的动作胶囊保留底色（其头部不 sticky，浮动在图上需要可读背景）。
- **mermaid 字体**：默认 trebuchet ms 一族与界面割裂。`MermaidConfig.fontFamily` 显式设为应用 sans 栈 `Inter, 'Segoe UI Variable', 'Microsoft YaHei UI', sans-serif`（与 globals.css `--font-sans` 手工同步，那边改动需带这边）；复现页实测 svg text 计算字体已是该栈。
- 已验证：Prettier、Oxlint、三组类型检查、202 项单测；交互经真实 `ChatMarkdown` 组件的 vite 复现页端到端验证（复现页已删除）。待验证（实机审阅）：全屏查看与复制按钮的实机观感、mermaid 图内中文字体。

## 2026-09-29（第四轮）实机反馈修复：sticky 头部漏字、复制无反应与 composer 光标偏移

- **sticky 头部漏字**：钉住用 `top-2` 时，头部上方留 8px 缝，代码从缝里滚过（用户截图实锤）。header 与复制按钮行统一改 `top-0`，钉在滚动容器裁剪缘，上方无暴露区。
- **复制按钮无反应**：主进程 `src/main/index.ts:330` 起把全部权限请求/检查一律拒绝，`navigator.clipboard.writeText` 所需的 `clipboard-sanitized-write` 也被拒，复制静默失败（check 图标永远不出现，消息气泡的复制同样受害）。改为仅放行 `clipboard-sanitized-write`，其余维持拒绝；绿色 check 反馈按用户要求撤掉，保持正常配色（图标 Copy→Check 交换即反馈）。
- **composer 光标偏移**：CM6 基础主题自带 `.cm-content { padding: 4px 0 }` 与 `.cm-line { padding: 0 2px 0 6px }`，使光标/正文相对自绘占位符整体偏移（下 4px、右 6px）。主题里把两者归零，正文、光标与占位符共用同一原点。
- 已验证：Prettier、Oxlint、三组类型检查、202 项单测、`pnpm build`、`pnpm smoke`；top-0 规则确认编译进产物。待验证（实机审阅）：长代码块滚动不再漏字、复制按钮点击出 check 且剪贴板真实写入、composer 空态光标与占位文字对齐。
- **代码块取消高度上限（用户裁决）**：streamdown 默认 `codeBlockMaxHeight: 400` 让块体内部滚动，块内自带滚动条在钉住头部右上露出，顶部缝隙仍会漏内容（用户第二轮截图实锤）。`ChatMarkdown` 显式传 `codeBlockMaxHeight={0}`（falsy 即不加 maxHeight 与 `overflow-y-auto`）：代码块完整展开、随外层聊天区滚动，块内不再出现自己的滚动条；钉住头部的 sticky 保留（外层滚动时仍有用）。超宽代码仍横向滚动。
