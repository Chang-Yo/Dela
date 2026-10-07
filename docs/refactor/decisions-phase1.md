# 阶段一验收裁决

日期：2026-09-29。本文是架构师对阶段一四份产出（[tools-inventory.md](tools-inventory.md)、[state-model.md](state-model.md)、[pi-integration-report.md](pi-integration-report.md)、[structure.md](structure.md)）的验收结论与待裁决项的最终决定，是阶段二及后续实施批次的任务契约。与各设计稿冲突处以本文为准。

## 总裁决

四份产出验收通过，相互一致，可作实施依据。总体路线确认：

1. **Pi Agent Core 0.87.1 替换 `loop.ts`**（探针 8/8 通过，无关键不成立项）。
2. **Dela 自有持久化是唯一会话事实来源**；不使用 Pi 的 SQLite Session 后端做持久层（其 entry 账本/branch 树不引入）。Pi 会话对象是 Run 生命周期内的内存执行态，从 Dela 持久历史重建。据此**移除** `@earendil-works/pi-session-backend-sqlite-node` 依赖（`pi-agent-core` 与 `pi-ai` 保留）。
3. 实施顺序遵循 structure.md §6 的分步：先做**行为零变化的机械重组**（shared/preload 拆分、agent 目录立起、工具平移到领域目录），再做语义切换（Pi 运行时、Session/Run 新身份、DB v13、压缩、新工具）。每步独立可构建、测试通过。

## 状态模型裁决（state-model.md §6 十项）

| #   | 决定                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------ |
| 1   | 采纳推荐：新增 `projects` 档案表（PK = workspace_entries.id，CASCADE），保留 project kind 作资源挂载点 |
| 2   | 采纳：`sessions.messages` 保留 JSON 列                                                                 |
| 3   | 采纳：`runs.steps` 轻量索引 JSON，全文留消息                                                           |
| 4   | 采纳：删除项目 → 会话 `project_id` SET NULL（不 CASCADE 删对话）                                       |
| 5   | 采纳：旧 `home`/`sources`/`projects` scope 会话并入通用池                                              |
| 6   | 采纳：视图状态阶段三统一 renderer localStorage 按 project_id；DB `view:%` 键届时废弃                   |
| 7   | 采纳：`note_versions` 挂 `note_id`                                                                     |
| 8   | 采纳：`waiting_input` 状态入模型、首轮不触发                                                           |
| 9   | 采纳：同 session 串行、跨 session 允许并行，首版不加全局并发上限                                       |
| 10  | 采纳：v13 不 DROP `chat_sessions`，一个发布周期后单独迁移清理                                          |

补充裁决：**Pi 会话衔接**——"继续/新 Run"从 `sessions.messages`（+ summary）重建 Pi initialState；不落 Pi 会话存储。Pi 报告 L7 按此关闭。

## 工具盘点裁决（tools-inventory.md §10 十项）

| #   | 决定                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 阶段二注册全部重设计工具集（约 30 个，含三个 `*_status`），不做动态裁剪；"按项目/连接状态加载工具"留待阶段四能力管理统一处理。未连接领域工具返回 `NOT_CONFIGURED` 指引                  |
| 2   | 采纳：水源沿用 Discourse stream+post_ids 语义，不伪造 offset/total（豁免统一分页）                                                                                                      |
| 3   | 采纳：`refresh_mail` 不开放（无窄化 API，与"刷新目标一致"冲突）                                                                                                                         |
| 4   | 采纳：`get_timetable_status` 返回本地已同步学期列表 + 时钟推断学期（显式标注推断依据）；不允许模型探测性同步未来学期                                                                    |
| 5   | 采纳：开放 `remove_todo`、`remove_entry`；`set_semester_start`、`archive_canvas_course` 不开放                                                                                          |
| 6   | 采纳：`read_resource` 图片输出扩展到 canvas/workspace 图片文件（PDF pages 路径与 ≤12 张/运行预算共用）                                                                                  |
| 7   | 采纳：新增 `read_mail_attachment`（临时提取不留存）；`copy_file_to_project` 保留为沉淀路径，两者并存。（后续落地偏差：独立工具未实现，附件直读并入 `read_resource` 的 attachment 引用） |
| 8   | 采纳：笔记插图不排期，仅记录                                                                                                                                                            |
| 9   | 旧工具名兼容：registry 维护一版 `legacyAliases` 映射（旧名→新名），执行时翻译并在结果中提示新名；一个发布周期后移除                                                                     |
| 10  | 采纳：`query_schedule` 接受 `YYYY-MM-DD` 日期（上海时区解释）与 UTC ISO 两种输入；schema description 说明优先用日期                                                                     |

工具契约按盘点 §8 执行：`{ok,result}` 外壳保留，错误码细化表（NOT_CONFIGURED/AUTH_EXPIRED/NOT_FOUND/VERSION_CONFLICT/RATE_LIMITED/NETWORK_ERROR/UPSTREAM_ERROR）由各业务域抛带 code 的错误、registry 统一映射；freshness/coverage/pagination 字段按 §8.3–8.4 形态统一。

## Pi 集成裁决（pi-integration-report.md 限制项）

| 项               | 决定                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 thinking 回灌 | `convertToLlm` 一律剥离 ThinkingContent（对齐 DeepSeek 不回传策略），不按提供商开关；UI 思考文本由 Dela 持久化（现状不变）                                                                                                              |
| L2 parts 数组    | 不预处理；真实服务出现兼容问题再在 convertToLlm 折叠纯文本 user 消息为字符串                                                                                                                                                            |
| L3 maxTokens     | Dela 管：streamFn 包装注入 `maxTokens`，保留 32768 起步、400 被拒回退 8192 的策略                                                                                                                                                       |
| L4 重试          | Dela 管：在 streamFn 包装层对「无产出 + 瞬时错误（429/5xx/网络）」做指数退避重试（1s/3s），有产出不重试                                                                                                                                 |
| L5 工具契约      | **工具层不直接写 Pi AgentTool**：registry 保持 Dela 形态（zod schema + execute→{ok,result}），core 内桥接层转换（z.toJSONSchema 已验证；结果转 content blocks + details，错误转抛异常/错误结果）。持久化与 UI 继续用 `{ok,result}` JSON |
| L6 SQLite 驱动   | 不引入第二套栈：Pi 会话后端不用（见总裁决 2），Dela 持久化继续 better-sqlite3                                                                                                                                                           |
| L8 打包          | 阶段二接入时 `vite.main.config.ts` 加 `@earendil-works/*`、`openai`、`typebox` external；打包体积在阶段二收口时实测并记录                                                                                                               |
| L9 新字段        | 默认接受 Pi 的请求字段（store:false/include_usage）；真实网关报错再以 compat 关闭                                                                                                                                                       |

## 阶段二任务批次（本裁决派生）

**批次 2A（机械重组，行为零变化，可并行）**

- shared/api.ts 与 preload/index.ts 按结构 §4/§5 拆分（api.ts 保留聚合，全部现有 import 不动）。
- main/agent 按结构 §2.1/§2.2/§6 第 1 步立目录：工具平移、loop→core、api→session+context、ipc 重组；`slice(-12)` 原样保留并标注待替换。
- 依赖清理：移除 pi-session-backend-sqlite-node；vite external 预置。

**批次 2B（语义切换）**

- DB v13 迁移（projects/sessions/runs/note_versions + scope 映射）与 session 读写切换。
- core/pi.ts 运行时接入：替换 runAgent 执行路径（streamFn 包装含 L3/L4 策略、事件映射、abort/错误语义）。
- context/assemble 重写：Session→Run 上下文 + 预算压缩骨架（触发阈值先保守：输入估算 ≥ 窗口 70% 压缩，窗口大小来源 provider 配置，未知取 32k 保守值）。
- 工具重设计落地（按盘点 §9 清单，含水源 7 个、edit_note、契约统一）。
- `session:*` 新通道上线，旧 `workspace:chat-*` 通道委托新实现（单循环原则）。

每批次收口：typecheck + lint + vitest + build 全绿，devlog 记录。
