# 全业务工具盘点（重构第一阶段产出）

日期：2026-09-29。本文档是 [Agent 与工作区重构计划](../agent-workspace-plan.md) §5.2 第一阶段的盘点结果：按领域核对「用户任务—业务能力—现有工具—缺口—处理决定」，作为第二阶段按领域重设计工具的输入。所有「业务能力」「现有工具」均逐函数核对代码；「处理决定」为建议，标注依据。schema 细节留到实施阶段，本文只定名称、边界与契约方向。

## 0. 现状基线（核实结果）

- `src/main/agent/tools.ts` 当前定义 **20 个**工具（`agentTools` 对象 20 个键）：`prepare_email`、`query_schedule`、`query_todos`、`save_todo`、`refresh_todos`、`query_assignments`、`search_mail`、`find_courses`、`sync_sources`、`search_sources`、`search_workspace`、`web_search`、`fetch_page`、`read_resource`、`create_entry`、`update_entry`、`write_note`、`link_source`、`copy_file_to_project`、`create_event`。
- 统一执行结果外壳：`{ok:true,result} | {ok:false,error:{code,message}}`，错误码仅 `UNKNOWN_TOOL` / `INVALID_INPUT`（Zod 校验失败）/ `OPERATION_FAILED`（`tools.ts:431-446`）；`INVALID_JSON` 由 `agent/loop.ts:298` 产生。
- 工具结果回灌上限 20000 字符（`loop.ts:156`）；PDF 页图像 ≤6 页/次、单次运行 ≤12 张（`loop.ts:158`）。
- 资源引用 `src/shared/resources.ts` 的 `resourceRefSchema` 只支持 **workspace / canvas / mail / attachment** 四种，**没有 shuiyuan 变体**（详见 §1 与 §8.2）。

**与计划书/技术规划的出入**：

1. 任务描述与技术规划附录称「现有 18 个工具」，附录契约表也只列 18 个——代码实际 20 个。附录表缺少 `query_todos`、`save_todo`、`refresh_todos` 三行（技术规划 §6「TODO 与作业状态」一节倒是提到了它们）。附录表需在实施时补全。
2. 技术规划附录称 `shared/resources.ts`「严格校验 workspace/canvas/mail/attachment/shuiyuan 引用」，并给出 `{type:'shuiyuan-topic', id}` 示例——**与代码不符**：schema 无 shuiyuan 变体。水源引用实际以 `sourceId` 字符串 `shuiyuan-topic:<id>` 存在于 workspace source 条目（`workspace/api.ts:395`），不经 `resourceRefSchema` 校验。
3. 计划书其余待核实点均属实：Canvas `connected` 仅为本地 token 存在性（`canvas/api.ts:86`）；`query_schedule` 无学期发现；附件正文需先导入（`tools.ts:253-254`）。详见各领域表。

---

## 1. 水源社区

Agent 工具覆盖：**零**。唯一入口是 @ 显式引用：`agent/api.ts:226-232` 把 `source:shuiyuan-topic:<id>` 上下文键路由到 `readShuiyuanSource`，且要求该主题已被用户从水源页加入项目（`AddToProjectDialog` 先写 `shuiyuan_topics` 引用行）。模型自己无法发现、搜索或续读任何水源内容。

| 用户任务                     | 业务能力（main 侧函数，核实）                                                                                                                                                                    | 现有 Agent 工具                                                                                                               | 缺口                                    | 处理决定（依据）                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 知道水源是否绑定             | `getShuiyuanState`（`shuiyuan/api.ts:46`，connected=本地凭据存在，未在线验证）；`bindShuiyuan`(:102)/`unbindShuiyuan`(:160) 仅 UI                                                                | 无                                                                                                                            | 无状态诊断                              | **补充** `shuiyuan_status`（计划 §5.2「状态诊断」）                                                        |
| 按关键词搜帖子               | `listShuiyuanTopics` feed=`search`（`shuiyuan/api.ts:478,484-497`），page 参数分页                                                                                                               | 无                                                                                                                            | 完全未覆盖                              | **补充** `search_shuiyuan_topics`（只读；计划明确补齐搜索）                                                |
| 浏览最新/精品/分类/标签      | `listShuiyuanTopics` latest/featured/category/tag（:478,499-512），`moreUrl` 远端 cursor 分页（`ShuiyuanTopicPage`）                                                                             | 无                                                                                                                            | 完全未覆盖                              | **补充** `list_shuiyuan_topics`（feed + cursor 分页）                                                      |
| 看分类树与标签               | `getShuiyuanSiteStructure`（:425，10 分钟内存缓存）                                                                                                                                              | 无                                                                                                                            | 未覆盖                                  | **补充** `list_shuiyuan_categories`（输入容易构造：分类 id 需要发现入口）                                  |
| 读主题与楼层                 | `getShuiyuanTopic`（:552，返回 stream 全量 post id + 前段 posts，postNumber 定位）；`loadShuiyuanPosts`（:579，按 post id ≤50 楼续读）                                                           | 仅 @ 引用（需用户手动加入项目；且 `agent/api.ts:233` 只放行 markdown/text/html 全文，水源 html 满足，但断网回退只剩 excerpt） | 模型无法自主读取；无法楼层级续读        | **补充** `read_shuiyuan_topic` + `read_shuiyuan_posts`（计划验收场景「读取后续楼层」）                     |
| 把主题关联进项目             | `addShuiyuanSourceRef`（:869，写引用行+实时拉取）；`createWorkspaceEntry` 支持 `shuiyuan-topic:` 前缀（`workspace/api.ts:395-402`）                                                              | `link_source` 描述只说 Canvas；实现对 shuiyuan 前缀也放行，但前提是引用行已存在（模型无法创建）                               | 闭环断裂：搜到→读到的结果无法沉淀进项目 | **补充** `link_shuiyuan_topic`（组合 addShuiyuanSourceRef + createWorkspaceEntry；补齐「可引用结果闭环」） |
| 读已关联主题正文             | `readShuiyuanSource`（:911，实时拉取，断网回退 excerpt）                                                                                                                                         | @ 引用间接覆盖；`read_resource` 不支持                                                                                        | 与统一读取路径割裂                      | **调整**：read_resource 增加水源引用形态（同时修正附录 §8.2 的类型出入）                                   |
| 看收藏                       | `listShuiyuanBookmarks`（:593）                                                                                                                                                                  | 无                                                                                                                            | 未覆盖                                  | **补充（候选，第二批）**：只读、低频，可随首批只读一起或延后                                               |
| 看通知/未读数                | `listShuiyuanNotifications`（:626）、`getShuiyuanCounts`（:649）、`markShuiyuanNotificationsRead`（:644）                                                                                        | 无                                                                                                                            | 未覆盖                                  | **暂不开放**：通知聚合属通知中心职责（technical-plan §8），标记已读有副作用；待通知与 Agent 边界裁决       |
| 看私信列表                   | `listShuiyuanMessages`（:616）                                                                                                                                                                   | 无                                                                                                                            | 未覆盖                                  | **暂不开放**：隐私敏感，只读接入价值待评估                                                                 |
| 回复/点赞/上传/私信/收藏写入 | `createShuiyuanReply`（:671）、`setShuiyuanLiked`（:699，取消点赞实测被 403 拒绝）、`createShuiyuanUpload`（:728，端点未实测）、`createShuiyuanMessage`（:781）、`setShuiyuanBookmarked`（:807） | 无                                                                                                                            | 全部未开放                              | **暂不开放**：计划明确「回复、私信等写入单独评估，不随只读接入自动开放」                                   |

**缺口结论**：业务 API 完备（发现/搜索/主题/楼层/引用行/写入全套），Agent 侧零覆盖，只有用户手动 @ 引用一条窄路；补齐只读链路 + 项目关联闭环是本领域全部工作。

---

## 2. 课表与日程

| 用户任务               | 业务能力（核实）                                                                                                                                                                                                                                                                 | 现有 Agent 工具                     | 缺口                                                            | 处理决定                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 知道课表连接/同步状态  | `getTimetableState`（`timetable/api.ts:497`，connected=真实在线试探 `isConnected`(:212)，与 Canvas 语义不同）；`syncRow` 本地表含各学期 `last_synced_at`/`semester_start`                                                                                                        | 无                                  | 无状态查询                                                      | **补充** `get_timetable_status`（连接、学期、同步时间、学期开始日期）                                                   |
| 发现已有哪些学期       | 本地 `timetable_sync` 表（无枚举函数）；`currentSemester`(:124) 按本地时钟推断；教务接口不返回学期列表                                                                                                                                                                           | 无                                  | **学期发现缺失**：模型只能猜 `YYYY-YYYY-[123]` 格式或依赖默认值 | **补充**：`get_timetable_status` 附带已同步学期列表；是否做「可用学期」发现待裁决（§8.4）                               |
| 同步课表               | `syncTimetable(semester)`（:340，单学期全量，失败返回 {ok:false,error}）                                                                                                                                                                                                         | 无                                  | 模型无法刷新课表，只能提示用户去 UI                             | **补充** `refresh_timetable`（目标明确：单学期，不是全量）                                                              |
| 查时间范围内的课与事件 | `querySchedule`（:425）+ `lessonOccurrences`（`shared/schedule.ts:20`）：课程按周次×节次展开为实际日期，个人事件合并；coverage `{courseSyncedAt, complete, warnings}`；警告含缺学期开始日期（schedule.ts:35）、单课周次无效（:54）、学期未同步（api.ts:440）；时区 Asia/Shanghai | `query_schedule`                    | UTC 输入边界需模型手算；`complete` 为布尔+警告数组，粒度可用    | **保留并调整**：输入约定统一（见 §7）；coverage 字段并入统一形态；「没有课」与「未同步」已有区分（warning），保持并强化 |
| 创建个人日程           | `createCalendarEvent`（:466，支持 color）                                                                                                                                                                                                                                        | `create_event`（schema 省略 color） | 颜色不可指定                                                    | **保留并调整**：补 color（API 已支持）                                                                                  |
| 删除/修改个人日程      | `deleteCalendarEvent`（:491）；**无更新函数**                                                                                                                                                                                                                                    | 无                                  | 不能删除；不能修改                                              | `delete_event` **补充**（本地写）；`update_event` **暂不开放**（API 缺失，需先补业务函数，不预建）                      |
| 修正学期开始日期       | `setSemesterStart`（:508）                                                                                                                                                                                                                                                       | 无                                  | 数据修复无入口                                                  | **待裁决**（§8.5）：开放给模型属本地写，但改错会让全部课程日期错位；至少 status 工具要在缺失时明确指引                  |
| 登录教务               | `openLoginWindow`（:223）；会话持久化 `timetable/session.ts:23`                                                                                                                                                                                                                  | 无                                  | 不适用                                                          | **暂不开放**：登录是 UI 交互（弹窗），工具无法承载；状态工具返回 NOT_CONFIGURED 指引即可                                |

**缺口结论**：查询与创建已有，缺学期发现、状态诊断、课表刷新与事件删除；`connected` 在此领域本是真实在线检查（与 Canvas 不同），新契约要把两种语义分开命名。

---

## 3. Canvas

| 用户任务               | 业务能力（核实）                                                                                                                                                        | 现有 Agent 工具                                                                                    | 缺口                                                            | 处理决定                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 知道连接与内容同步状态 | `getCanvasState`（`canvas/api.ts:77`）：`connected = Boolean(loadCanvasToken())`（**:86，纯本地 token 存在性**）；全局 `syncedAt`、每课程 `syncedAt`/`error`/`archived` | `find_courses` 返回 connected+syncedAt+coverage（混合在列表结果里）                                | 状态分散；connected ≠ 可访问（token 可能已失效）                | **拆分** `get_canvas_status`：区分「已保存凭据 / 课程列表同步时间 / 各课程内容同步时间与错误」；名称不再暗示已验证（计划 §5.2 明确此点） |
| 找课程                 | `getCanvasState().courses`（含 term/code/archived）                                                                                                                     | `find_courses`（query 子串匹配）                                                                   | 名称看似通用实则 Canvas；未标 archived 语义                     | **调整**为 `list_canvas_courses` / `search_canvas_courses`（合并为一个带 query 的 `list_canvas_courses` 亦可，见 §7 命名规范）           |
| 同步课程列表           | `syncCanvasCourses`（:98，保留历史课程，失败不删数据）                                                                                                                  | `sync_sources`（courseId 缺省=列表）                                                               | 与课程内容同步混在一个工具                                      | **拆分** `sync_canvas_courses` 与 `sync_canvas_course`（计划：「课程列表与内容同步含义不同」）                                           |
| 同步单课程资料         | `syncCanvasCourse`（:145，files/assignments/discussions/modules 四分支，分支失败保留旧缓存并记入 course.error，:189-208）                                               | `sync_sources`（指定 courseId）                                                                    | 返回只带 courses+syncedAt，error 藏在 course 对象里             | **拆分并调整**：`sync_canvas_course` 返回明确的部分成功结构（各分支状态）；沿用 refresh_ 前缀（`refresh_canvas_course`）见 §7            |
| 按标题找资料           | `getCanvasState().items` 过滤（sourceId 去重）                                                                                                                          | `search_sources`（query+courseId+kind，返回可传 read_resource 的 ref）                             | 只搜缓存标题，无正文检索（工具描述已如实声明）                  | **保留**（改名 `search_canvas_sources`）；coverage 已有 `cached_titles`，统一字段形态                                                    |
| 读正文/文件            | `readCanvasSource`（:580）：page/assignment/discussion 按需拉 HTML 并缓存（:603-619）；file 走 `cachedFile`(:408) 下载缓存，返回 bytes/previewUrl 不返回 text           | `read_resource`（canvas ref；PDF/DOCX/PPTX 由 resource-parse 提取文字，扫描件提示改走 pages 图像） | 图片文件 bytes 被丢弃、`readable:false` 无提示；正文无 revision | **调整** read_resource：统一版本字段（无版本来源标 `revision:null`）；图片输出路径待裁决（§8.6）                                         |
| 读作业描述             | 同步时随 `canvas_sources` 存 html                                                                                                                                       | `query_assignments` 剥离 description，经 read_resource 读                                          | 无（设计合理）                                                  | **保留**现状                                                                                                                             |
| 归档课程               | `archiveCanvasCourse`（:390，归档不参与自动同步）                                                                                                                       | 无                                                                                                 | 未覆盖                                                          | **待裁决**（§8.5）：影响同步范围与可见性，属本地写，倾向先不开放                                                                         |
| 配置/断开              | `configureCanvas`（:93，验证后才保存）/ disconnect                                                                                                                      | 无                                                                                                 | 不适用                                                          | **暂不开放**：凭据属「连接」设置页职责                                                                                                   |
| 作业提交               | **无 API**                                                                                                                                                              | 无                                                                                                 | 不适用                                                          | **暂不开放**（既有边界，两份规划一致）                                                                                                   |

**缺口结论**：检索与读取链路基本成形；核心缺口是「状态诊断」与「列表/内容同步」两种 refresh 拆分、部分成功的显式表达，以及 connected 语义修正。

---

## 4. TODO

| 用户任务          | 业务能力（核实）                                                                                     | 现有 Agent 工具                                                                               | 缺口                                                           | 处理决定                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 看混合待办清单    | `getTodoState`（`todo.ts:53`，items 含个人+Canvas 作业，connected=token 存在，syncedAt/error）       | `query_todos`（query 匹配 title/notes/courseName + completed 筛选，返回 page+syncedAt+error） | 无 coverage 字段                                               | **保留并调整**：补统一 coverage；明确它是「统一视图」入口                                                                                                                                                                   |
| 按课程/时间查作业 | 同一缓存（source==='canvas' 过滤）                                                                   | `query_assignments`（courseId+dueAt 范围+completed，coverage:'cached_assignments'）           | 与 query_todos 的 completed 语义重复实现（两处同一段过滤逻辑） | **保留并明确分工**：`query_todos`=个人待办为主的统一清单（关键词）；`query_assignments`=Canvas 作业（课程/截止时间范围）。两者结果形状对齐，完成语义共用一份定义（unknown/offline 不归为未完成，与 technical-plan §6 一致） |
| 新建/修改个人待办 | `saveTodo`（:84，仅个人；改 Canvas 条目抛错；支持 calendar+color）                                   | `save_todo`                                                                                   | 无                                                             | **保留**                                                                                                                                                                                                                    |
| 删除个人待办      | `removeTodo`（:117）                                                                                 | 无                                                                                            | 未覆盖                                                         | **补充（候选）** `remove_todo`：本地写、API 已有；与 save_todo 对称                                                                                                                                                         |
| 刷新作业缓存      | `refreshTodos`（:151）→ `syncCanvasTodos`（:168，在读未归档课程，仅作业+submission，新作业生成通知） | `refresh_todos`（描述明确「只读操作，不会提交作业」）                                         | 无                                                             | **保留**；注意它有副作用（系统通知），契约需标注（见 §7 副作用分级）                                                                                                                                                        |
| 标记已读          | `markTodoRead`（:124）                                                                               | 无                                                                                            | 未覆盖                                                         | **暂不开放**：已读是 UI 状态，模型标记会造成用户未看先消的效果；待通知边界裁决                                                                                                                                              |
| 提交作业          | **无 API**                                                                                           | 无                                                                                            | 不适用                                                         | **暂不开放**（固定边界）                                                                                                                                                                                                    |

**缺口结论**：查询/保存/刷新齐备，主要工作是 query_todos 与 query_assignments 的分工表述、统一 coverage，删除为低成本补充。

---

## 5. 邮件与附件

| 用户任务                  | 业务能力（核实）                                                                                                                                                                            | 现有 Agent 工具                                                                                                  | 缺口                                            | 处理决定                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 搜索邮件                  | `searchMail`（`mail/api.ts:817`，主题+snippet 缓存搜索，from/folderId/时间筛选；coverage `{scope:'cached_subjects_and_snippets', uidWindowPerFolder:300, completeMailbox:false, folders}`） | `search_mail`                                                                                                    | coverage 形态与其它领域不一致（对象 vs 字符串） | **保留并调整**：coverage 并入统一契约；folders 附带全部文件夹 id/name/syncedAt（folderId 未指定时），这是目前唯一的文件夹发现途径                                                          |
| 浏览文件夹                | `listMailFolders`（:984，total/unread/lastSyncedAt）                                                                                                                                        | 无（仅 search_mail coverage 附带）                                                                               | 无独立入口                                      | **补充（候选）** `list_mail_folders`：模型构造 folderId 筛选需要它；或维持 coverage 附带，二选一（倾向独立，语义清楚）                                                                     |
| 读正文                    | `readMailMessage`（:896，缺正文时 `fetchMissingBody`(:696) 联网拉取；2MB 正文预算；CID 内联图）                                                                                             | `read_resource`（mail ref；不标记已读，属实）                                                                    | 读正文隐含联网拉取+缓存写，「只读」不纯粹       | **保留并调整**：freshness 标注 cached→realtime 的按需拉取；副作用分级归 read（含按需拉取）                                                                                                 |
| 列邮件                    | `listMailMessages`（:878，按文件夹）                                                                                                                                                        | 无                                                                                                               | 未覆盖（search_mail 空 query 可近似）           | **暂不开放**：search_mail 空 query+folderId 已覆盖；避免双入口                                                                                                                             |
| 读附件正文                | `withResourceFile`（`resources.ts:11`，attachment 经临时目录+`saveMailAttachment`）；`parseDocumentFile` 可提取文字                                                                         | `read_resource` 对 attachment **直接抛错**（`tools.ts:253-254`：需先 `copy_file_to_project` 导入）；导入后即可读 | 底层机制存在，工具层挡住                        | **待裁决（§8.7）**：新增 `read_mail_attachment`（零拷贝直接提取）vs 保持先导入。计划要求「评估附件直接读取和资料流转的缺口」——倾向补充直接读取（临时文件已能承载），导入仍作为沉淀路径保留 |
| 准备邮件草稿              | `prepareEmail`（`drafts.ts:153`，存 `email-draft:<id>`；附件 ref 在用户打开草稿时经 `openEmailDraft`(:172) 加载，70MB 上限；拒绝整封邮件作附件）                                            | `prepare_email`（不发送，属实）                                                                                  | 无                                              | **保留**（计划：「明确草稿/发送边界」，现状即边界）                                                                                                                                        |
| 发送邮件                  | `sendMessage`（`mail/api.ts:1195`，真实发送+存已发送）                                                                                                                                      | 无                                                                                                               | 不适用                                          | **暂不开放**（外部发布，既有边界）                                                                                                                                                         |
| 同步邮箱                  | `startMailSync`（:793，全量：所有文件夹 300 UID 窗口+30 封正文预取）                                                                                                                        | 无                                                                                                               | 模型不能触发刷新，只能报告缓存时间              | **待裁决（§8.3）**：`refresh_mail` 是全局全量动作，与「刷新目标与查询目标一致」冲突；倾向先不开放，缓存过期由 UI 轮询负责                                                                  |
| 标记已读/删除/恢复/回收站 | `markMailSeen`(:1013)/`markAllMailSeen`(:1051)/`deleteMailMessage`(:1113，本地删除)/`restoreMailMessage`(:1140)/`purgeMailMessage`(:1166)/`emptyMailTrash`(:1174)/`listMailTrash`(:1179)    | 无                                                                                                               | 未覆盖                                          | **暂不开放**：已读/删除是用户邮箱状态，外部副作用明显；缓存新鲜度工具先行                                                                                                                  |
| 配置邮箱                  | `configureMailAccount`(:730)/`disconnectMailAccount`(:772)                                                                                                                                  | 无                                                                                                               | 不适用                                          | **暂不开放**（「连接」设置页职责）                                                                                                                                                         |

**缺口结论**：搜索-读取-备稿链路完整且边界清晰；缺口集中在附件直接读取（底层已支持、工具层拦截）与文件夹发现，以及 coverage 形态统一；写入类维持不开放。

---

## 6. 工作区与网页

| 用户任务             | 业务能力（核实）                                                                                                                                                                                                           | 现有 Agent 工具                                                            | 缺口                                                                                                             | 处理决定                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 浏览/搜索工作区条目  | `getWorkspaceState`（`workspace/api.ts:345`，全量 entries）                                                                                                                                                                | `search_workspace`（query+parentId；空 query+parentId 即事实上的目录浏览） | 「浏览」与「搜索」共用一个工具，名称只表达搜索                                                                   | **调整**：拆分或改名 `list_workspace_entries`（浏览）与 `search_workspace`（检索）——倾向合并为一个 `list_workspace_entries` 带 query（现实现即如此，只改名义） |
| 创建条目             | `createWorkspaceEntry`（:380，folder/project/note/source；source 校验 canvas_sources 或 shuiyuan_topics 行存在）                                                                                                           | `create_entry`（kind: project/folder/note）；`link_source`（source）       | `create_entry` text 上限 1000000 < API 2000000（不一致）；`link_source` 描述只提 Canvas 但实现放行 shuiyuan 前缀 | **保留并调整**：上限对齐；`link_source` 描述修正；水源关联改走新 `link_shuiyuan_topic`（§1）后，`link_source` 收敛为 Canvas 专用并改名 `link_canvas_source`    |
| 重命名/移动/升级项目 | `updateWorkspaceEntry`（:442，name/parentId/kind folder↔project）                                                                                                                                                          | `update_entry`（无 kind）                                                  | 不能做文件夹↔项目转换                                                                                            | **保留并调整**：补 kind                                                                                                                                        |
| 删除条目引用         | `removeWorkspaceEntry`（:640，只删应用引用，不删磁盘文件）                                                                                                                                                                 | 无                                                                         | 未覆盖                                                                                                           | **待裁决（§8.5）**：本地写但低风险（不删文件）；倾向补充 `remove_entry`                                                                                        |
| 导入外部文件进项目   | `importWorkspaceFiles`（:484，按磁盘路径）+ `copyResourceToProject`（`resources.ts:33`，canvas/attachment/workspace→导入副本）                                                                                             | `copy_file_to_project`                                                     | 用户本地任意路径文件不能由模型导入（只有资源间复制）                                                             | **暂不开放**：模型拿不到磁盘路径（renderer 不暴露、工具无路径输入），属 UI 拖拽/选择器职责；跨业务资源流转已覆盖                                               |
| 读文档               | `readWorkspaceEntry`（:553）：note→markdown/text+revision(sha256)；source→canvas/shuiyuan；local/imported→pdf/image/markdown/text/office/unsupported（>128MB 抛错）；`saveWorkspaceNote`(:623) revision 冲突报「外部修改」 | `read_resource`（workspace ref）                                           | 图片 bytes 丢弃、xlsx 无法提取（resource-parse 仅 pdf/docx/pptx）                                                | **保留并调整**：见 §3 read_resource 项；xlsx 提取列为后续能力，不预建                                                                                          |
| 编辑笔记             | `saveWorkspaceNote`（整篇替换+revision）                                                                                                                                                                                   | `write_note`                                                               | **无局部修改**（计划 §6.2 重点补齐项）                                                                           | 见 §7 之后的 edit 清单                                                                                                                                         |
| 笔记插图             | `saveNoteImage`（:98，≤20MB 白名单格式）                                                                                                                                                                                   | 无                                                                         | 模型不能往笔记里插图                                                                                             | **待裁决（§8.8）**：依赖多模态产出链路（模型生成图片或引用资源图片），先记录不实施                                                                             |
| 联网搜索             | `searchWeb`（`web-search.ts:37`，自建 SearXNG；全部引擎无响应明确报错）                                                                                                                                                    | `web_search`                                                               | 无                                                                                                               | **保留**                                                                                                                                                       |
| 读网页               | `fetchWebPage`（:76，公网 http(s)、≤5 跳重定向、2MB/20000 字符截断并报告、PDF 直链提取文字）                                                                                                                               | `fetch_page`                                                               | 无分页续读（超 20000 字符直接截断）；无来源引用结构（返回无 ref）                                                | **保留并调整**：截断时给出续读途径（如 hash/offset 不可行则如实报告）；结果补 `source` 元数据（url+抓取时间），供引用沉淀                                      |
| 外部打开/导出        | `openEntryExternally`(:178)/`exportOfficePdf`/`quickLookFile`                                                                                                                                                              | 无                                                                         | 不适用                                                                                                           | **暂不开放**：属宿主 UI 交互                                                                                                                                   |

**缺口结论**：名称语义（浏览 vs 搜索）、create/update 参数对齐与低风险删除是主要调整项；真正的能力缺口只有局部修改（见下）与附件/图片读取表达。

---

## 7. 文档编辑（edit，重点补齐项）

| 用户任务   | 业务能力（核实）                                                                                     | 现有 Agent 工具                                     | 缺口                                                          | 处理决定                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 整篇写笔记 | `saveWorkspaceNote`（:623，sha256 revision 校验，冲突报「外部修改，草稿仍在」）                      | `write_note`（必须先读、带 revision、冲突指引重读） | 无                                                            | **保留**：整篇替换仍是新建/大改的正确形态                                                                                                                                                                                                 |
| 局部修改   | **无业务函数**（计划 §6.2 要求：基于明确版本提交一组文本修改、校验匹配与重叠、返回新版本+差异+定位） | 无                                                  | 大改场景模型被迫整篇重写：token 成本高、易丢内容、diff 不可审 | **补充** `edit_note`：输入 `{id, revision, edits:[{oldText,newText},…]}`，校验唯一匹配与重叠，返回新 revision+diff；命名与语义对齐 Pi edit 工具（计划参考依据已列）；实施阶段处理编辑器草稿未保存的版本问题（§6.2「Agent 所依据的版本」） |
| 冲突恢复   | revision 不匹配即失败                                                                                | write_note 错误信息已指引                           | 无重读工具化表达                                              | **调整**：错误码 `VERSION_CONFLICT`（见 §9），消息保持现有指引                                                                                                                                                                            |

**缺口结论**：edit_note 是唯一的新能力项，其余是错误表达标准化。

---

## 8. 统一契约约定草案

按计划 §5.2 六条约定给出具体规则。**与现有外壳的关系**：`{ok:true,result} | {ok:false,error:{code,message}}` 外壳保留（loop 与持久化都依赖它），变化在内部——错误码细化、结果对象新增统一字段（freshness/coverage/pagination），旧字段（如 `coverage:'cached_courses'` 字符串）迁移为对象形态。

### 8.1 动作命名规范

| 前缀/动词                                                                      | 语义                           | 约束                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------- |
| `get_<domain>_status`                                                          | 连接与同步状态诊断             | 只读、无网络副作用（如实报告「凭据已保存但未验证」）                        |
| `list_<noun>`                                                                  | 枚举/浏览（可带 query 弱过滤） | 空结果=真的没有；分页用 offset                                              |
| `search_<noun>`                                                                | 关键词/条件检索                | 结果必须可衔接（带 ref）；明确覆盖范围                                      |
| `read_<noun>`                                                                  | 读取正文/详情                  | 分页续读；不改变业务状态（缓存写除外，见副作用）                            |
| `refresh_<noun>`                                                               | 主动刷新缓存                   | 目标必须显式（单课程/单学期），不允许隐式全量                               |
| `write_note` / `edit_note`                                                     | 文档写入                       | revision 必填（可写文档）                                                   |
| `create_` / `update_` / `delete_` / `remove_` / `save_` / `prepare_` / `link_` | 实体与草稿操作                 | 名称含领域限定（`create_event` 例外：日程是独立领域，`event` 已够明确）     |
| `sync_`（弃用）                                                                | —                              | 统一改为 `refresh_`，避免「同步」歧义（现 `sync_sources` 同时承担两种刷新） |

命名体现业务范围：Canvas 一律含 `canvas`，水源含 `shuiyuan`；`read_resource` 保持跨业务通用名，靠 ref 类型区分。

### 8.2 资源引用

- `resourceRefSchema` 增加水源变体（建议 `{type:'shuiyuan-topic', id:number}`，与附录描述对齐）；`attachment` 保持现有形态。
- 搜索/列表结果一律带 `ref`，可直接传 `read_resource`——现状 `search_sources`/`search_mail`/`search_workspace` 已满足，水源新工具沿用。
- 来源元数据（url、抓取/同步时间）随结果返回，供「来源引用」沉淀。

### 8.3 分页对象形状

| 场景                | 形状                                                       | 说明                                                                  |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| 本地列表            | `{items, total, nextOffset}`                               | 沿用现 `page()` helper（tools.ts:32）；nextOffset=null 即末页         |
| 远端 cursor（水源） | `{items, nextCursor}`                                      | nextCursor 为不透明字符串原样回传（对应 `moreUrl`）；**不伪造 total** |
| 正文分页            | `{text, totalCharacters, nextOffset}`                      | 沿用 read_resource 现状                                               |
| 楼层续读（水源）    | read 结果带 `stream`（post id 全量），续读工具按 id 段请求 | Discourse 语义，不压平成 offset                                       |

### 8.4 新鲜度与覆盖范围

统一字段（各领域按适用裁剪，不强制全有）：

- `freshness: { kind: 'cached' | 'realtime', syncedAt?: string }`——cached=本地缓存查询；realtime=当次联网（水源、fetch_page、按需拉取的邮件正文）。
- `coverage: { scope: string, complete: boolean, warnings?: string[] }`——scope 描述数据窗口（如 `cached_subjects_and_snippets:uid300`、`cached_titles`、`cached_assignments`），complete=false 时 warnings 说明缺口。
- **空结果 vs 未连接/未同步**：未配置/未连接/未同步一律走 `ok:false` + 对应错误码（§9），不得返回空 items 让模型误判「没有数据」；缓存窗口外（如邮件 300 UID 之前）返回空 items + coverage 说明，这是「确实没搜到」与「窗口外不可见」的区别。

### 8.5 错误码分类表

| code               | 含义                                                           | 现状对应                                        |
| ------------------ | -------------------------------------------------------------- | ----------------------------------------------- |
| `INVALID_INPUT`    | schema 校验失败                                                | 已有（ZodError 映射）                           |
| `INVALID_JSON`     | 工具参数非 JSON                                                | 已有（loop.ts:298）                             |
| `UNKNOWN_TOOL`     | 工具不存在                                                     | 已有                                            |
| `NOT_CONFIGURED`   | 未连接/未绑定/未配置（Canvas token、邮箱、水源 key、教务登录） | 现混入 OPERATION_FAILED 的「请先连接 Canvas」等 |
| `AUTH_EXPIRED`     | 凭据失效（401/403、登录重定向）                                | 现为普通 Error 消息                             |
| `NOT_FOUND`        | 资源不存在/未同步/邮件不在缓存                                 | 现「资料尚未同步」等                            |
| `VERSION_CONFLICT` | revision 不匹配                                                | 现「笔记已在外部修改」                          |
| `RATE_LIMITED`     | 上游 429（水源已实现识别）                                     | 现为普通消息                                    |
| `NETWORK_ERROR`    | 超时/连接失败                                                  | 现「无法连接…请检查网络」                       |
| `UPSTREAM_ERROR`   | 业务服务端错误（含部分同步失败）                               | 现 OPERATION_FAILED 兜底                        |
| `OPERATION_FAILED` | 兜底                                                           | 保留                                            |

实施方式：各领域 api 抛带 code 的错误类型（或错误工厂），`executeAgentTool` 统一映射；消息保持现有中文可读文案。部分成功（如 sync_canvas_course 分支失败）保留 `ok:true` + 结果内 per-branch 状态 + warnings，不用统一失败掩盖（计划：「部分成功保留已取得的结果」）。

### 8.6 副作用分级

| 级别             | 定义                                                         | 工具                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 只读 read        | 查询；可联网但只读远端（允许顺带缓存写，如邮件正文按需拉取） | 全部 get_/list_/search_/read_、query_*                                                                                                                                                           |
| 刷新 refresh     | 显式拉取远端写本地缓存                                       | refresh_todos、refresh_canvas_courses/course、refresh_timetable（新增）                                                                                                                          |
| 本地写 local     | 改本地数据/文件/草稿                                         | save_todo、remove_todo（新增）、create_event、delete_event（新增）、create_entry、update_entry、remove_entry（候选）、write_note、edit_note（新增）、link_*、copy_file_to_project、prepare_email |
| 外部发布 publish | 对外产生可见效果                                             | **无**。发送邮件、回复/点赞/私信水源、提交作业均不开放；未来新增按计划单独设计                                                                                                                   |

注意：`refresh_todos` 会产生系统通知（todo.ts:240-249），分级为 refresh 但契约中要声明该次级副作用。工具 description 统一标注级别（现状已在文字上做了，如「只读操作，不会提交作业」）。

---

## 9. 每个领域的新工具名清单

名称与边界（schema 实施阶段定）；「保留」的工具名不变或仅按 §8 调整字段。

**水源（全部新增）**

- `shuiyuan_status` — 绑定状态与账号；输入无；结果 connected/username/boundAt。
- `search_shuiyuan_topics` — 关键词搜索主题；输入 query(+页码)；结果主题摘要列表+topicId 引用。
- `list_shuiyuan_topics` — 按 feed（latest/featured/category/tag）浏览；输入 feed+nextCursor；结果主题列表+nextCursor。
- `list_shuiyuan_categories` — 分类树与常用标签；无必填；结果分类/标签（构造 category feed 的前提）。
- `read_shuiyuan_topic` — 主题详情与首段楼层；输入 topicId(+postNumber 定位)；结果元信息+stream+posts。
- `read_shuiyuan_posts` — 按 post id 续读楼层；输入 topicId+postIds；结果楼层列表。
- `link_shuiyuan_topic` — 关联主题到项目；输入 topicId+parentId；结果引用行+workspace ref（写 shuiyuan_topics + source 条目）。

**课表与日程**

- `get_timetable_status` — 连接/学期/同步时间/学期开始日期/已同步学期列表（学期发现）。
- `query_schedule` — 保留：时间范围内的课程与个人事件（来源标记 course/event，coverage 告警）。
- `refresh_timetable` — 同步指定学期课表（输入 semester，必填，避免误刷）。
- `create_event` — 保留+补 color。
- `delete_event` — 删除个人日程（仅自建事件）。

**Canvas**

- `get_canvas_status` — 凭据已保存（不称 connected）、课程列表同步时间、各课程内容同步时间/错误/归档。
- `list_canvas_courses` — 课程列表（含 query 弱过滤、archived 标记）。
- `search_canvas_sources` — 保留 search_sources（改名）：缓存标题检索，返回 ref。
- `refresh_canvas_courses` — 仅课程列表。
- `refresh_canvas_course` — 单课程内容，返回各分支部分成功状态。
- `read_resource`（canvas ref）— 保留，见通用。

**TODO**

- `query_todos` — 统一待办清单（个人+作业，关键词/完成筛选）。
- `query_assignments` — Canvas 作业（课程/截止范围筛选）；与 query_todos 的分工写进两者 description：清单 vs 作业截止视图。
- `save_todo` / `refresh_todos` — 保留。
- `remove_todo` — 删除个人待办（候选，待裁决 §10.5）。

**邮件与附件**

- `search_mail` — 保留，coverage 统一为对象。
- `list_mail_folders` — 文件夹发现（候选；或维持 coverage 附带，二选一）。
- `read_mail_attachment` — 直接提取附件正文（待裁决 §10.7；实现走 withResourceFile+parseDocumentFile，临时文件不留存）。
- `prepare_email` — 保留（草稿边界不变）。

**工作区与网页**

- `list_workspace_entries` — 浏览+弱检索（现 search_workspace 语义正名）。
- `create_entry` / `update_entry`（补 kind）/ `link_canvas_source`（原 link_source 收敛 Canvas）/ `copy_file_to_project` — 保留调整。
- `remove_entry` — 删除条目引用，不删文件（候选，待裁决）。
- `web_search` / `fetch_page` — 保留；fetch_page 补来源元数据与截断说明。

**文档编辑**

- `write_note` — 保留整篇替换。
- `edit_note` — **新增局部修改**：一组 {oldText,newText}+revision，校验唯一匹配与重叠，返回新 revision+diff（计划 §6.2 与 Pi edit 参考）。

**通用**

- `read_resource` — 保留跨业务读取（workspace/canvas/mail/attachment/shuiyuan-topic ref；字符分页；PDF pages 图像路径），按 §8 统一 freshness/coverage/版本字段。

---

## 10. 风险与待裁决项

1. **工具数量与注册策略**：重设计后工具约 27–30 个（现 20）。全部常驻注册会增加上下文占用并降低模型选择准确率。计划 §5.2 已有「能力启用、模型可发现的工具、执行权限分别处理」的原则，但首批注册集合（是否水源全套常驻、get_*_status 是否合并为一个 `get_status(domain)`）需要裁决。
2. **水源分页形态**：Discourse 是 stream+post_ids，与统一 offset/cursor 都不同（§8.3 已按 cursor/stream 设计）。若架构师希望更强的表面统一（全部 offset），需明确「不为一致性伪造分页」的豁免范围。
3. **refresh_mail 是否开放**：邮件同步无窄化 API，任何刷新都是全文件夹 300 UID 窗口全量。与「刷新目标与查询目标一致」冲突，本盘点倾向不开放（§5 表）；若要开放需先给 mail/api 增加按文件夹/按邮件的拉取能力，属业务层改造。
4. **学期发现的数据来源**：教务接口不返回学期列表，只能枚举本地 `timetable_sync` 已同步学期 + `currentSemester` 时钟推断（系统时间错误会出错，如 9 月初跨学期）。是否需要在 get_timetable_status 中做「时钟推断+显式标注推断依据」，以及是否允许模型请求未来学期（触发一次必失败的同步来探测），需裁决。
5. **低风险本地写的开放范围**：`remove_todo`、`remove_entry`（不删文件）、`set_semester_start`（改错会让全部课程日期错位）、`archive_canvas_course`（影响同步范围）。本盘点建议：前两者开放、后两者暂不；需架构师确认。
6. **read_resource 的图片输出**：canvas/workspace 图片文件现在 bytes 被丢弃、readable:false 无提示。是否扩展为像 PDF pages 那样以图片消息附给视觉模型（需要控制在运行 ≤12 张的预算内），还是维持仅 PDF？建议扩展，但会增大请求体风险，需裁决。
7. **附件直接读取 vs 资料流转**：`read_mail_attachment` 直接读取减少摩擦，但绕过「导入项目」留下的可见痕迹（用户可在项目里看到导入副本）。本盘点建议两者并存（读=临时提取不留存，导入=沉淀），需确认这符合「资料流转」预期。
8. **笔记插图（saveNoteImage）**：依赖模型产出图片或引用资源图片的链路，超出本轮只读+文本编辑边界，建议不排期，仅记录。
9. **旧工具名兼容**：会话历史持久化了工具调用记录（含旧名如 `sync_sources`）；重命名后旧会话续跑（重放）会 UNKNOWN_TOOL。是否需要别名兼容期（新旧名并存一个迁移窗口）或接受断档，需裁决。
10. **query_schedule 的 UTC 输入**：现要求模型传 UTC ISO 边界（上海时区周次展开在 main 侧做）。新契约可考虑接受日期（`YYYY-MM-DD`，上海时区解释）降低构造成本，但会引入两种时间语义并存，需裁决是否值得。

---

## 附：本盘点核对的文件清单

`src/main/agent/tools.ts`（20 工具）、`src/main/agent/web-search.ts`、`src/main/agent/api.ts`（@ 引用路由）、`src/main/agent/loop.ts`（错误码/回灌上限）、`src/main/canvas/api.ts`、`src/main/mail/api.ts`、`src/main/mail/drafts.ts`、`src/main/timetable/api.ts`、`src/main/timetable/session.ts`、`src/main/todo.ts`、`src/main/shuiyuan/api.ts`、`src/main/workspace/api.ts`、`src/main/resources.ts`、`src/main/resource-parse.ts`、`src/shared/resources.ts`、`src/shared/api.ts`、`src/shared/schedule.ts`、`docs/agent-workspace-plan.md` §5.2、`docs/technical-plan.md` 附录。
