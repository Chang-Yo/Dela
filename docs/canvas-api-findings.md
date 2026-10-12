# Canvas (oc.sjtu.edu.cn) API 数据结构探测记录

日期：2026-09-10。使用个人 Canvas Access Token 对 `https://oc.sjtu.edu.cn/api/v1` 实测的结果。以下全部为已验证事实（除标注"未验证"外），数据样本来自本人 2024-2025 至 2026-2027 共 5 学期、48 门课程。本文只记录事实与结构推断，不含实现承诺。

## 1. 基础设施行为

| 事项       | 实测结论                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 认证       | `Authorization: Bearer <Canvas_access_token>`，官方 Instructure REST API 行为                                                                                                                                                               |
| 分页       | 本实例把 `per_page` **静默限制为 50**（请求 100 也只返回 50，Link 头显示 `per_page=50`）；同步必须跟随 `Link` 响应头（`rel="next"` / `rel="last"`），不能信任请求参数                                                                       |
| 限流       | `X-Rate-Limit-Remaining: 600.0`（令牌桶）+ `X-Request-Cost`（每请求按成本扣减）；标准 Canvas 软限流                                                                                                                                         |
| 错误形态   | 无权限返回 **HTTP 401 + JSON body**：`{"status":"未授权","errors":[{"message":"用户无权执行该操作"}]}`；功能未开启返回 404。401 也可能是业务无权限而非 token 失效，两者需区分                                                               |
| 写入权限   | 个人 token 默认含写入 scope（2026-09-15 实测）：无实体的写入探测（`POST /conversations` 缺收件人→400 参数错误、`POST /courses/0/assignments`→404）均未被 scope 层以 401 "Insufficient permissions" 拒绝；scope 检查先于参数校验，可据此探测 |
| 课程可见性 | `/courses` 返回 48 门课，其中 5 门访问详情返回 401（可见条目、详情无权限），需容忍单课失败                                                                                                                                                  |

## 2. 课程（Course）与学期分类

- 列表：`GET /courses?include[]=term&include[]=enrollments&per_page=50`。加 `enrollment_state=active` 只返回当前在读（5 门）；不过滤则返回全部历史（48 门）。
- 关键字段：`id`、`name`（中文课名）、`course_code`（形如 `本-(2026-2027-1)-CS3308-01-机器学习`，含学段+课程号+班号）、`term.name`（如 `2026-2027 Fall`）、`workflow_state`（`available`）、`storage_quota_mb`、`grading_standard_id`、`enrollments[].type=student`、`enrollments[].computed_current_score/final_score`（成绩，仅当前学期课程上有值）、`course_color`、`friendly_name`、`calendar`、`time_zone`。
- **学期分类不能靠 `workflow_state`**：历史课程长期保持 `available`（教师未归档），按 `term` 分组才是正确的学期分类；`course_code` 中段可解析课程号用于跨学期聚合同名课（如"形势与政策"每学期一门）。
- `GET /courses/:id?include[]=syllabus_body` 可取教学大纲 HTML（本人数据中多为空或一个 PDF 链接，价值有限）。

## 3. 作业（Assignment）与 DDL

- 列表：`GET /courses/:id/assignments?include[]=submission&per_page=50`。
- 关键字段：`id`、`name`、`description`（HTML，作业要求正文）、`due_at` / `unlock_at` / `lock_at`、`points_possible`、`submission_types`、`assignment_group_id`、`html_url`、`allowed_attempts`、`is_quiz_assignment` + `quiz_id`（测验型作业）、`published`、以及内嵌的 `submission`（本人提交，见 §4）。
- 实测 `submission_types` 分布：`online_upload`（上传文件，绝对主力）、`none`（纯成绩项，如"课程总评"）、`online_quiz`（仅体育课理论作业）。未出现 `online_text_entry`、`media_recording` 等，但结构上需保留处理位。
- 实测 121 份作业中绝大多数有 `due_at`；也存在整门课全部不填 due 的情况（OS 课设 9 份全部为空）。**DDL 的唯一可靠来源就是作业 `due_at`**。
- 分组：`GET /courses/:id/assignment_groups?include[]=assignments`，含 `group_weight`（成绩权重）与 `rules`（drop 最低分等）。

## 4. 提交（Submission）

- 单份：`GET /courses/:id/assignments/:aid/submissions/self?include[]=attachments&include[]=submission_comments`；列表内嵌见 §3。
- 关键字段：`workflow_state`（`unsubmitted`/`submitted`/`graded`）、`score`/`grade`/`entered_score`、`submitted_at`/`graded_at`/`posted_at`、`attempt`、`late`/`missing`/`seconds_late`、`attachments[]`（**我上传的文件，结构与课程文件 File 完全一致**）、`submission_comments[]`、`preview_url`。
- 结论：学生提交的作业文件可作为独立一类资料（`source=submission`）与课程文件统一索引。

## 5. 测验（Quiz）

- `GET /courses/:id/quizzes` 在部分课程返回 404（功能未开），部分课程可用。
- 测验对象：`quiz_type=assignment`、`due_at`、`points_possible`、`question_count`、`time_limit`、`allowed_attempts`；与 Assignment 通过 `quiz_id` / `assignment_id` 双向链接。本人数据中仅体育课使用在线测验，优先级低。

## 6. 文件与文件夹（决定文件组织呈现的核心）

### 6.1 文件夹 Folder

- `GET /courses/:id/folders` 返回**全课程扁平列表**（非树），客户端按 `parent_folder_id`（根为 `null`，根名固定 `course files`）自行组树。
- 字段：`id`、`name`、`full_name`（如 `course files/slides`）、`parent_folder_id`、`files_count`、`folders_count`、`files_url`、`folders_url`、`hidden`/`locked`/`for_submissions`。
- 实测最深仅两层（`course files/project|slides|textbook`），结构简单但必须按树处理。

### 6.2 文件 File

- 两种列法：`GET /courses/:id/files`（全课程平铺，含所有子文件夹文件）或 `GET /folders/:fid/files`（按文件夹）。字段一致。
- 关键字段：`id`、`uuid`、`folder_id`、`display_name`（界面名，中文常见）、`filename`、`content-type`、`size`（字节）、`created_at`/`updated_at`/`modified_at`、`mime_class`（`pdf`/`image`/`doc`…）、`category`、`hidden`/`locked`/`unlock_at`/`lock_at`、`thumbnail_url`（实测基本为 null）、`media_entry_id`（实测 null）、`url`。
- 实测类型分布（约 420 个文件）：**PDF 约 80% 绝对主导**，PPTX/PPT 约 10%，其余 zip、Word、LaTeX、图片、极少量 mp4。
- 课程视频不在 files 里：走 LTI 外部工具 tab（"课堂视频新版/旧版"）。Canvas 同步至今不覆盖视频——课堂录像由独立的「课堂视频」功能按课程查询与播放（见 [DEVELOPMENT.md](DEVELOPMENT.md) §5）。

### 6.3 下载链路

- 文件 `url` 形如 `/files/:id/download?download_frd=1&verifier=<uuid>`；请求它返回 **302 → `s3.jcloud.sjtu.edu.cn` 预签名 URL**（`X-Amz-Expires=3600`，1 小时有效）。
- 实现注意：302 之后的 S3 请求不能携带 `Authorization` 头，需两段式（先 API 请求拿 `Location`，再裸 GET S3）；预签名 URL 本身视同敏感凭据，不落日志。
- 实测单文件最大约 96 MB（教材 PDF），需要缓存目录、失败重试与完整性校验。

## 7. 讨论与公告（DiscussionTopic）

- `GET /courses/:id/discussion_topics` 同一结构涵盖公告与讨论，靠 `is_announcement` 区分；`only_announcements=true` 可只取公告。
- 跨课程聚合端点 `GET /announcements` **必须传 `context_codes[]`**（缺省 400 `Missing context_codes`；`active_only=true` 还需 start/end 日期）。
- 实测本人全部 48 门课中公告为 0（2026-09-10），讨论仅 2 门课在用（物理讨论题 5 条、C++ 每章讨论区 13 条）。该类数据在交大使用率低，但 API 可用、结构标准。
- 2026-09-15 复测：计算经济学（CS3343-01，2026-2027 Fall）出现 1 条公告 "Welcome"（`locked=false`）。以学生身份 `POST /courses/:id/discussion_topics/:topic_id/entries`（JSON body `{"message":"..."}`，`Content-Type: application/json; charset=utf-8`）发布回复返回 **201 Created**，entry 含 `id`/`user_name`/`message`/`created_at`，Unicode（em dash）原样保存。学生回复公告的写入链路可用。

## 8. 模块（Module）——第二种课程目录轴

- `GET /courses/:id/modules?include[]=items`。约 1/3 的课在用：C++ 课用 13 个模块表达章节结构；系统结构实验按 Lab 组织；模块 item `type` 实测出现 `File`、`Discussion`（预期还有 `Assignment`/`ExternalUrl`/`Page`），item 经 `content_id` 链到具体资源。
- 对有模块的课，模块是教师组织的"课程目录"，比 folder 更贴近学习顺序；对没有模块的课则只有文件树。呈现层可把"模块"作为可选视图，而不是硬性层级。

## 9. 聚合端点：实测大多为空，聚合需自己做

| 端点                                            | 实测                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/users/self/todo`                              | 空数组（2026-09-10 与 2026-09-15 开学后两次实测均空）                                                                                                                                   |
| `/users/self/upcoming_events`                   | 空（2026-09-15 开学后复测仍空）                                                                                                                                                         |
| `/users/self/activity_stream`                   | **200 可用（2026-09-15）**：全局活动流，实测仅 1 条 `type=Announcement`；条目 `context_code` 为空，关联课程需从 `html_url`/`course_id` 解析。当日新公告未立即出现在流中，收录时效未验证 |
| `/planner/items`（带日期窗口与 context_codes）  | 空                                                                                                                                                                                      |
| `/calendar_events`（带 context_codes + 日期窗） | 空——交大教师不用 Canvas 日历事件                                                                                                                                                        |
| `/users/self/enrollments`                       | 只返回当前 active 的 5 门课；`grades.current_score/final_score` 现为 null（无已发布成绩）                                                                                               |

结论：跨课程 DDL/待办视图应由客户端遍历各课 `assignments.due_at` 自行聚合，不依赖 planner/todo/calendar。

## 10. 对"一类文件如何组织呈现"的直接推论

1. **分类主干**：`学期 (term) → 课程 (course) → [文件树 | 模块 | 作业 | 通知与讨论]`。文件树是文件的主组织（folder 树），模块是可选的第二浏览轴，作业把"要求描述 + due + 我的提交附件"聚成一组，通知与讨论是第四条分支。
2. **同步策略**：每课一次 `folders`（扁平全量）+ 分页拉 `files` 平铺后按 `folder_id` 归位；所有列表端点统一走 Link 头分页（上限 50）。
3. **文件去重与身份**：`(canvas_file_id, uuid)` 稳定；`folder_id` 表达位置；`updated_at` 表达变化。我提交的附件与课程文件同一结构，可共用一张文件表 + 来源字段。
4. **下载**：verifier 链接长期稳定，S3 预签名 1 小时；下载放主进程，二段式请求，不落日志。
5. **容错**：单课 401/404 不阻塞整体同步；401 需区分 token 失效（全局）与单课无权限（跳过并标注）。

## 11. 未验证 / 待办

- `online_text_entry`、`media_recording` 等提交类型未在本人数据出现，结构未实测。
- Canvas OAuth2（浏览器登录换 token）未验证；当前前提是用户手动粘贴 personal access token。
- 长期运行的 token 失效表现（401 的具体形态）未实测。
- 增量同步：API 未提供稳定的 change 游标，需靠 `updated_at` 对比 + 定期全量校核，具体策略未验证。
- `activity_stream` 的收录时效（新公告何时出现）与覆盖的事件类型范围未系统验证。
- 写入类端点仅验证了讨论回复（entries POST）；其余写入（提交作业、上传文件等）未验证。
