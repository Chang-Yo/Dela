# 交大接口资料与 Canvas 实测

Dela 校园能力的接口资料，两部分合在一处。

- **第一部分：Canvas 实测。** 用个人 Access Token 对 `https://oc.sjtu.edu.cn/api/v1` 实测出的结构与边界，按代码为准，不含实现承诺。实测截至 2026-09-15。
- **第二部分：公开资料索引。** 交大开放 API、校园网络服务、交我办 / InfoPlus 与社区项目的全景索引，用来判断还需要读什么。公开可检索范围截至 2026-09-09。

两部分的取舍与依据记在各自开头；产品边界与实现约定见 [DEVELOPMENT.md](DEVELOPMENT.md)。

---

# 第一部分：Canvas (oc.sjtu.edu.cn) API 数据结构探测记录

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

---

# 第二部分：上海交通大学开放 API、校园网络服务开发资料与开源项目全景索引

> 面向个人 Agent Harness / MCP Connector 的公开资料汇总
> 截至 2026-09-09

## 范围说明

本文尽量覆盖公开互联网可检索的官方文档、应用开发手册、网络服务说明、GitHub/Gist 项目和外部索引。私有仓库、校内登录后页面、已删除页面、搜索引擎未收录内容无法保证穷尽，因此“全部”应理解为截至该日期的公开可检索最佳努力集合。

**最重要的现实结论：** 网络信息中心当前公开的 jAccount 接口服务页把服务对象写为“部门、教职工”，FAQ 也写明由在校教职工发起并经部门审批。学生个人 Harness 可以优先使用 Canvas Personal Token、邮箱 IMAP/SMTP、致远一号 API、VPN、公开网页与个人会话型接口；要取得官方 `api.sjtu.edu.cn` 的 `clientId/scope`，建议按“老师/实验室/社团/院系挂靠的正式应用”来规划。

## 先读：接口生态分层

| 类别              | 典型认证                                      | 学生个人可得性                  | Harness 建议                         |
| ----------------- | --------------------------------------------- | ------------------------------- | ------------------------------------ |
| 官方 Open API     | jAccount OAuth2 + clientId/secret + scope     | 中低：当前申请入口偏教职工/部门 | 正式、稳定；拿到审批后优先           |
| 数据资源 API      | Client Credentials + exchange_data + 字段审批 | 低                              | 只为单位级版本预留                   |
| InfoPlus / 交我办 | 独立 OAuth、User/System Token、Workflow 权限  | 中低                            | 第二阶段，做待办/流程                |
| Canvas            | Personal Access Token / OAuth2                | 高                              | 学生个人 MVP 首选                    |
| 交大邮箱          | IMAP/SMTP；或 Open Mail API                   | 高（IMAP/SMTP）                 | 学生个人 MVP 首选                    |
| 致远一号模型      | API Key + 校园网/VPN                          | 较高，按当前申请政策            | 作为本地模型 Provider                |
| Web 私有接口      | JAAuthCookie/session/UserToken/CSRF           | 高但易变且敏感                  | 封装在本地 Connector，严禁裸露给模型 |

## 建议先看的 12 个入口

1. [官方 Open API 列表](https://developer.sjtu.edu.cn/api/list.html)
2. [OAuth 2.0 与 scope](https://developer.sjtu.edu.cn/auth/oauth.html)
3. [jAccount 接口申请现实门槛](https://net.sjtu.edu.cn/wlfw/jAccountjk.htm)
4. [InfoPlus API](https://developer.sjtu.edu.cn/form/reference/api.html)
5. [校级数据资源 API](https://developer.sjtu.edu.cn/graphql/overview.html)
6. [致远一号模型 API](https://claw.sjtu.edu.cn/guide/sjtu-api/)
7. [官方校园 Skill 集市](https://claw.sjtu.edu.cn/sjtu-skills/)
8. [SJTU-Geek MCP Server](https://github.com/SJTU-Geek/sjtu-mcp-server)
9. [openclaw-sjtu](https://github.com/xhh678876/openclaw-sjtu)
10. [sjtu-agent](https://github.com/kuan-er/sjtu-agent)
11. [SJTU Canvas Helper](https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper)
12. [pysjtu](https://github.com/PhotonQuantum/pysjtu)

## 目录

- 一、上海交通大学官方开发者平台：jAccount 与 Open API（22 条）
- 二、校级数据资源 API / GraphQL 数据交换体系（11 条）
- 三、交我办 / InfoPlus 应用与流程开发手册（25 条）
- 四、网络信息中心服务、部署与个人可用协议（19 条）
- 五、2026 年官方 AI / Agent 基础设施（13 条）
- 六、GitHub / 社区项目：直接涉及 SJTU 接口、认证或校园服务（33 条）
- 七、风险与历史接口：可做考古，不建议直接作为 Harness 默认能力（3 条）

## 一、上海交通大学官方开发者平台：jAccount 与 Open API

### 001. 上海交通大学开发者平台首页

- **链接：** [https://developer.sjtu.edu.cn/](https://developer.sjtu.edu.cn/)
- **来源：** 官方
- **状态：** 当前
- **认证：** 按具体模块
- **简介：** 开放平台总入口，串联 jAccount 身份认证、REST Open API、数据资源 API 与交我办/InfoPlus 开发文档。
- **对 Agent Harness 的价值：** 做 Harness 时应把这里当作接口契约的第一权威来源。

### 002. Open API 概述

- **链接：** [https://developer.sjtu.edu.cn/api/overview.html](https://developer.sjtu.edu.cn/api/overview.html)
- **来源：** 官方
- **状态：** 当前；需申请
- **认证：** OAuth 2.0，appId/appSecret + scope
- **简介：** 说明 REST API 的统一调用方式、认证机制、应用凭据与权限申请思路。官方 API 主要位于 api.sjtu.edu.cn/v1。
- **对 Agent Harness 的价值：** 用于设计统一 SJTU OAuth Client、错误处理、分页和 scope 管理层。

### 003. Open API 完整接口列表

- **链接：** [https://developer.sjtu.edu.cn/api/list.html](https://developer.sjtu.edu.cn/api/list.html)
- **来源：** 官方
- **状态：** 当前；按接口授权
- **认证：** OAuth 2.0
- **简介：** 官方索引页，集中列出 Profile、Task、Enterprise、File、Notification、Mail、Finance、Education、Card、Unicode、Barcode、Calendar、Signature 等接口。
- **对 Agent Harness 的价值：** 最适合作为 Harness Tool Registry 的基础清单。

### 004. jAccount 身份认证概述

- **链接：** [https://developer.sjtu.edu.cn/auth/jaccount.html](https://developer.sjtu.edu.cn/auth/jaccount.html)
- **来源：** 官方
- **状态：** 当前；需接入资格
- **认证：** jAccount
- **简介：** 介绍 jAccount 统一身份认证在开放平台中的角色，以及成员站点/应用接入的基本概念。
- **对 Agent Harness 的价值：** 用于理解身份主体、成员站点和后续 OAuth/OIDC 的关系。

### 005. jAccount OAuth 2.0 开放授权

- **链接：** [https://developer.sjtu.edu.cn/auth/oauth.html](https://developer.sjtu.edu.cn/auth/oauth.html)
- **来源：** 官方
- **状态：** 当前；需申请 clientId/scope
- **认证：** Authorization Code / Client Credentials / Password Grant
- **简介：** 给出 authorize、token、logout 地址，以及公开 scope 注册表。文档仍列出 password grant；长期 Harness 更适合授权码 + refresh token。
- **对 Agent Harness 的价值：** OAuth 适配器的核心文档，也可据 scope 表反推官方理论能力上限。

### 006. jAccount OIDC 接入方法

- **链接：** [https://developer.sjtu.edu.cn/auth/oidc.html](https://developer.sjtu.edu.cn/auth/oidc.html)
- **来源：** 官方
- **状态：** 当前；需接入资格
- **认证：** OpenID Connect / OAuth 2.0
- **简介：** 说明 ID Token、JWT 字段、授权码/隐式认证流程、Profile API 认证和退出流程。ID Token 可包含 jAccount、姓名、学工号、身份类型等。
- **对 Agent Harness 的价值：** 适合实现 Harness 登录、用户身份初始化和账号绑定。

### 007. jAccount TOTP 二次验证码

- **链接：** [https://developer.sjtu.edu.cn/auth/totp.html](https://developer.sjtu.edu.cn/auth/totp.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** jAccount Access Token + TOTP 校验
- **简介：** 介绍交我办生成的 6 位、30 秒动态验证码及服务端校验方式。
- **对 Agent Harness 的价值：** 很适合把高风险写操作做成 step-up authentication，例如充值、流程提交、敏感写入前再认证。

### 008. Profile API

- **链接：** [https://developer.sjtu.edu.cn/api/profile.html](https://developer.sjtu.edu.cn/api/profile.html)
- **来源：** 官方
- **状态：** 当前；scope 控制
- **认证：** basic / essential / profile 等
- **简介：** 读取当前授权用户的账号与身份资料；返回字段随 scope 不同而变化。部分指定用户查询能力存在额外开放限制。
- **对 Agent Harness 的价值：** 可作为 sjtu.identity.me / account_context 工具。

### 009. Task API

- **链接：** [https://developer.sjtu.edu.cn/api/task.html](https://developer.sjtu.edu.cn/api/task.html)
- **来源：** 官方
- **状态：** 部分版本迁移/需授权
- **认证：** tasks 等
- **简介：** 与统一待办、可办事项及流程任务有关；文档提示旧接口与新版任务集成存在演进关系。
- **对 Agent Harness 的价值：** 适合研究跨系统待办聚合，但要按当前版本和应用权限验证。

### 010. Enterprise API

- **链接：** [https://developer.sjtu.edu.cn/api/enterprise.html](https://developer.sjtu.edu.cn/api/enterprise.html)
- **来源：** 官方
- **状态：** 当前；高权限项需审批
- **认证：** 应用/岗位/权限相关 scope
- **简介：** 涉及当前用户岗位、应用权限、组织结构、校历以及部分岗位授权操作。
- **对 Agent Harness 的价值：** 只读岗位/权限可增强 Agent 身份上下文；角色修改类动作应划为高风险管理能力。

### 011. File API

- **链接：** [https://developer.sjtu.edu.cn/api/file.html](https://developer.sjtu.edu.cn/api/file.html)
- **来源：** 官方
- **状态：** 当前；需 scope
- **认证：** storage 等
- **简介：** 提供文件上传、下载、元数据，以及与 WPS 在线预览/编辑相关的能力。
- **对 Agent Harness 的价值：** 可用作校园内部应用的附件层或 Agent 生成文件的中转存储。

### 012. Notification API

- **链接：** [https://developer.sjtu.edu.cn/api/notification.html](https://developer.sjtu.edu.cn/api/notification.html)
- **来源：** 官方
- **状态：** 当前；部分渠道需额外申请
- **认证：** send_notification / send_app_notification 等
- **简介：** 统一通知可覆盖邮件、短信、交我办消息及部分微信模板能力，不同渠道存在独立准入条件。
- **对 Agent Harness 的价值：** 适合学院/实验室级 Agent 的主动通知；个人 Harness 可先用邮箱或系统通知替代。

### 013. Mail API

- **链接：** [https://developer.sjtu.edu.cn/api/mail.html](https://developer.sjtu.edu.cn/api/mail.html)
- **来源：** 官方
- **状态：** 当前；需 scope
- **认证：** read_mails / send_mail
- **简介：** 提供交大邮箱邮件列表、读取/状态修改、发送等接口。
- **对 Agent Harness 的价值：** 若能拿到 scope，可直接做邮件 Tool；学生个人还可用标准 IMAP/SMTP 作为低门槛替代。

### 014. Finance API

- **链接：** [https://developer.sjtu.edu.cn/api/finance.html](https://developer.sjtu.edu.cn/api/finance.html)
- **来源：** 官方
- **状态：** 业务级；需审批
- **认证：** Client Credentials/业务权限
- **简介：** 涉及财务预约类流程的创建、查询、取消、完成等操作。
- **对 Agent Harness 的价值：** 偏业务系统集成，不宜作为学生个人 Harness 的首期能力。

### 015. Education API

- **链接：** [https://developer.sjtu.edu.cn/api/education.html](https://developer.sjtu.edu.cn/api/education.html)
- **来源：** 官方
- **状态：** 部分可用；部分接口文档标注尚未实现
- **认证：** lessons/classes/exams/scores 等
- **简介：** 覆盖教学班、个人课程/课表等教育数据；考试与 GPA/成绩相关文档需按当前实现状态逐项验证。
- **对 Agent Harness 的价值：** 课表是个人 Agent 的高价值数据源；成绩/考试不能只看 scope 名称就假定可用。

### 016. Campus Card API

- **链接：** [https://developer.sjtu.edu.cn/api/card.html](https://developer.sjtu.edu.cn/api/card.html)
- **来源：** 官方
- **状态：** 当前；读写 scope 分离
- **认证：** card_info / card_transactions / write_card_info 等
- **简介：** 涉及本人一卡通信息、交易流水、照片、充值，以及更高权限的卡务操作。
- **对 Agent Harness 的价值：** 余额、流水分析非常适合 Agent；充值和卡务写操作应强制确认。

### 017. Unicode / 思源码 API

- **链接：** [https://developer.sjtu.edu.cn/api/unicode.html](https://developer.sjtu.edu.cn/api/unicode.html)
- **来源：** 官方
- **状态：** 当前；多数能力有应用限制
- **认证：** unicode 等
- **简介：** 提供思源码验证、身份码、支付码参数及交易等能力；部分操作与交我办运行环境或专门授权相关。
- **对 Agent Harness 的价值：** 可研究校园码与支付场景，但支付码属于高敏感临时凭据。

### 018. Barcode API

- **链接：** [https://developer.sjtu.edu.cn/api/barcode.html](https://developer.sjtu.edu.cn/api/barcode.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** 部分接口无需认证
- **简介：** 提供二维码/条形码图像生成等基础能力。
- **对 Agent Harness 的价值：** 可作为校园应用中的展示组件，价值偏辅助。

### 019. Calendar API

- **链接：** [https://developer.sjtu.edu.cn/api/calendar.html](https://developer.sjtu.edu.cn/api/calendar.html)
- **来源：** 官方
- **状态：** 当前；公开文档显示需线下申请且偏教职工
- **认证：** calendar
- **简介：** 创建/删除学校日程事件并配置参与者、提醒和重复规则。
- **对 Agent Harness 的价值：** 学生个人 Harness 更容易先同步 Google/Apple/Outlook Calendar；校内日程接口可留作后续。

### 020. Electronic Signature API

- **链接：** [https://developer.sjtu.edu.cn/api/signature.html](https://developer.sjtu.edu.cn/api/signature.html)
- **来源：** 官方
- **状态：** 高权限；需印章/应用审批
- **认证：** Client Credentials + signature
- **简介：** 可对 PDF 执行电子签章，使用平台提供的电子印章编码。
- **对 Agent Harness 的价值：** 属于强写入和法律/组织权限相关能力，Agent 侧应默认禁用或采用强确认。

### 021. Open API Java SDK

- **链接：** [https://developer.sjtu.edu.cn/api/sdk.html](https://developer.sjtu.edu.cn/api/sdk.html)
- **来源：** 官方
- **状态：** 当前/可能随平台演进
- **认证：** Java SDK + OAuth 凭据
- **简介：** 官方 Java SDK 文档，封装 token、Profile、Task 等开放平台调用，并引用交大 Maven 仓库。
- **对 Agent Harness 的价值：** 可用于核对官方调用习惯；即便最终用 TypeScript/Python，也有参考价值。

### 022. SJTU Maven 公共仓库

- **链接：** [https://maven.dev.sjtu.edu.cn/content/groups/public/](https://maven.dev.sjtu.edu.cn/content/groups/public/)
- **来源：** 官方基础设施
- **状态：** 当前；可访问性按网络环境
- **认证：** Maven
- **简介：** Open API/InfoPlus 相关 Java SDK 会引用该仓库。
- **对 Agent Harness 的价值：** Java 服务端集成时可直接作为依赖源；同时能帮助定位官方 SDK artifact。

## 二、校级数据资源 API / GraphQL 数据交换体系

### 023. 数据资源 API 概述

- **链接：** [https://developer.sjtu.edu.cn/graphql/overview.html](https://developer.sjtu.edu.cn/graphql/overview.html)
- **来源：** 官方
- **状态：** 当前；部门/业务审批，字段级授权
- **认证：** Client Credentials + exchange_data
- **简介：** 校级数据资源交换入口。权限按申请的数据字段控制，公开说明要求数据使用与获批用途、部门履职范围一致。
- **对 Agent Harness 的价值：** 能力很强，但对个人学生 Harness 的现实可得性低；适合作为未来单位合作版的接口层。

### 024. 数据资源通用 GraphQL 说明

- **链接：** [https://developer.sjtu.edu.cn/graphql/graphql.html](https://developer.sjtu.edu.cn/graphql/graphql.html)
- **来源：** 官方
- **状态：** 遗留/兼容体系；需审批
- **认证：** GraphQL + 应用凭据
- **简介：** 描述旧版/通用 GraphQL 查询方式和 schema 入口。近年来文档同时提供 REST 化的数据资源接口。
- **对 Agent Harness 的价值：** 用于理解历史项目和旧代码中的 graphql.sjtu.edu.cn 调用。

### 025. Account 数据资源 REST API

- **链接：** [https://developer.sjtu.edu.cn/graphql/account.html](https://developer.sjtu.edu.cn/graphql/account.html)
- **来源：** 官方
- **状态：** 当前；字段级审批
- **认证：** exchange_data
- **简介：** 按 jAccount、学工号等条件查询账户类数据，实际可见字段取决于应用获批范围。
- **对 Agent Harness 的价值：** 适合部门级身份目录、账户同步；个人 Harness 不应假定可以查询任意成员。

### 026. Account 旧版 GraphQL Schema

- **链接：** [https://developer.sjtu.edu.cn/graphql/account_graphql.html](https://developer.sjtu.edu.cn/graphql/account_graphql.html)
- **来源：** 官方
- **状态：** 旧版/参考；需审批
- **认证：** GraphQL
- **简介：** 公开账户数据的 GraphQL 字段结构和查询范式。
- **对 Agent Harness 的价值：** 对逆向理解旧系统、字段映射和迁移代码有价值。

### 027. Faculty 数据资源 REST API

- **链接：** [https://developer.sjtu.edu.cn/graphql/faculty.html](https://developer.sjtu.edu.cn/graphql/faculty.html)
- **来源：** 官方
- **状态：** 当前；字段级审批
- **认证：** exchange_data
- **简介：** 教职工基本资料、岗位/学历等数据资源接口。
- **对 Agent Harness 的价值：** 面向单位内部目录、专家检索或业务同步；学生个人应用权限通常达不到。

### 028. Faculty 旧版 GraphQL Schema

- **链接：** [https://developer.sjtu.edu.cn/graphql/faculty_graphql.html](https://developer.sjtu.edu.cn/graphql/faculty_graphql.html)
- **来源：** 官方
- **状态：** 旧版/参考；需审批
- **认证：** GraphQL
- **简介：** 教职工相关旧版 GraphQL 字段和关联关系文档。
- **对 Agent Harness 的价值：** 适合阅读历史代码和理解数据模型。

### 029. Undergraduate Teaching / Student REST API

- **链接：** [https://developer.sjtu.edu.cn/graphql/student.html](https://developer.sjtu.edu.cn/graphql/student.html)
- **来源：** 官方
- **状态：** 当前；字段级审批
- **认证：** exchange_data
- **简介：** 覆盖本科学生基本信息、课程、排课、选课等数据资源，部分数据按学年范围提供。
- **对 Agent Harness 的价值：** 单位级教学 Agent 可以形成学生-课程-教学班图谱；个人 Harness 不应依赖这条路线。

### 030. Student 旧版 GraphQL Schema

- **链接：** [https://developer.sjtu.edu.cn/graphql/student_graphql.html](https://developer.sjtu.edu.cn/graphql/student_graphql.html)
- **来源：** 官方
- **状态：** 旧版/参考；需审批
- **认证：** GraphQL
- **简介：** 本科教学数据的旧版 GraphQL 查询模型。
- **对 Agent Harness 的价值：** 适合 endpoint archaeology 和旧应用迁移。

### 031. Paper 数据资源 REST API

- **链接：** [https://developer.sjtu.edu.cn/graphql/paper.html](https://developer.sjtu.edu.cn/graphql/paper.html)
- **来源：** 官方
- **状态：** 当前；字段级审批
- **认证：** exchange_data
- **简介：** 科研论文数据，可按作者、单位、论文题目、发表时间等过滤。
- **对 Agent Harness 的价值：** 可支撑单位级科研成果检索、专家发现和统计 Agent。

### 032. Paper 旧版 GraphQL Schema

- **链接：** [https://developer.sjtu.edu.cn/graphql/paper_graphql.html](https://developer.sjtu.edu.cn/graphql/paper_graphql.html)
- **来源：** 官方
- **状态：** 旧版/参考；需审批
- **认证：** GraphQL
- **简介：** 论文数据旧版 schema，包含作者、期刊、DOI、评价等字段关系。
- **对 Agent Harness 的价值：** 适合科研信息系统历史接口研究。

### 033. Asset 数据资源 API

- **链接：** [https://developer.sjtu.edu.cn/graphql/asset.html](https://developer.sjtu.edu.cn/graphql/asset.html)
- **来源：** 官方
- **状态：** 当前；高权限业务数据
- **认证：** exchange_data
- **简介：** 资产、设备、家具、房屋等校级资产数据资源。
- **对 Agent Harness 的价值：** 属于明显的单位业务系统能力，个人 Agent 应视为不可默认获得。

## 三、交我办 / InfoPlus 应用与流程开发手册

### 034. 交我办开发文档入口

- **链接：** [https://developer.sjtu.edu.cn/form/introduce/](https://developer.sjtu.edu.cn/form/introduce/)
- **来源：** 官方
- **状态：** 当前；具体能力按应用审批
- **认证：** 交我办/InfoPlus
- **简介：** 交我办开发体系总入口，覆盖应用规范、工作流、集成、API、消息机制、组件等。
- **对 Agent Harness 的价值：** 如果未来要让 Agent 读待办、追踪流程或参与表单，这是第二大官方资料库。

### 035. InfoPlus 平台介绍

- **链接：** [https://developer.sjtu.edu.cn/form/introduce/infoplus.html](https://developer.sjtu.edu.cn/form/introduce/infoplus.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus
- **简介：** 介绍交我办背后的流程/表单平台与应用模型。
- **对 Agent Harness 的价值：** 帮助区分普通 Open API 与 InfoPlus 自身的 OAuth、Workflow、Enterprise 权限模型。

### 036. 交我办应用管理规范

- **链接：** [https://developer.sjtu.edu.cn/form/standard/application.html](https://developer.sjtu.edu.cn/form/standard/application.html)
- **来源：** 官方
- **状态：** 当前；上线需审批
- **认证：** jAccount + 权限体系
- **简介：** 规定校内 Web 应用接入、jAccount、统一权限、通知/日程、部署域名/HTTPS、安全和上线流程等要求。
- **对 Agent Harness 的价值：** 如果 Harness 最终做成正式校内应用，这份规范决定合规部署边界。

### 037. 系统集成形态说明

- **链接：** [https://developer.sjtu.edu.cn/form/standard/integration-style.html](https://developer.sjtu.edu.cn/form/standard/integration-style.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** 按集成模式
- **简介：** 解释单应用、系统集成等不同接入形态。
- **对 Agent Harness 的价值：** 有助于决定 Agent 是独立应用、已有系统外挂，还是工作流子应用。

### 038. 统一任务集成规范

- **链接：** [https://developer.sjtu.edu.cn/form/standard/taskIntegration.html](https://developer.sjtu.edu.cn/form/standard/taskIntegration.html)
- **来源：** 官方
- **状态：** 当前；系统级
- **认证：** HTTP API / 单点登录
- **简介：** 定义交我办任务集成类型、数据格式和外部系统对接要求，并引用校内单点登录接口规范。
- **对 Agent Harness 的价值：** 可用于设计待办聚合 Connector 的数据模型。

### 039. 移动端页面设计规范

- **链接：** [https://developer.sjtu.edu.cn/form/standard/pageStyle.html](https://developer.sjtu.edu.cn/form/standard/pageStyle.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** Web/交我办容器
- **简介：** 说明交我办内嵌页面的移动设计与交互约束。
- **对 Agent Harness 的价值：** 若 Agent 有交我办内 Web UI，可避免与客户端导航、尺寸和交互冲突。

### 040. 桌面端表单规范

- **链接：** [https://developer.sjtu.edu.cn/form/standard/desktop.html](https://developer.sjtu.edu.cn/form/standard/desktop.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** Web
- **简介：** 面向 PC 端 InfoPlus/表单页面的布局与交互规范。
- **对 Agent Harness 的价值：** 对后台工作台或业务表单 UI 有参考价值。

### 041. 应用上线申请流程

- **链接：** [https://developer.sjtu.edu.cn/form/standard/onlineApply.html](https://developer.sjtu.edu.cn/form/standard/onlineApply.html)
- **来源：** 官方
- **状态：** 当前；需审批
- **认证：** 交我办应用
- **简介：** 描述从开发、测试到正式上线申请的流程。
- **对 Agent Harness 的价值：** 决定正式 Agent 应用如何进入校内生产环境。

### 042. 任务集成开发指南

- **链接：** [https://developer.sjtu.edu.cn/form/guide/integration/task.html](https://developer.sjtu.edu.cn/form/guide/integration/task.html)
- **来源：** 官方
- **状态：** 当前；需应用权限
- **认证：** 交我办任务接口
- **简介：** 给出外部系统向交我办集成任务/待办的开发操作说明。
- **对 Agent Harness 的价值：** 适合把外部 Agent 任务与校内统一待办体系打通。

### 043. 交我办 JavaScript SDK

- **链接：** [https://developer.sjtu.edu.cn/form/guide/integration/jssdk.html](https://developer.sjtu.edu.cn/form/guide/integration/jssdk.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** @sjtu-nic/jwb-app-invoker
- **简介：** 说明网页与交我办 App 通信的 JS SDK，可设置标题、关闭页面、打开扫码/语音/原生能力等。
- **对 Agent Harness 的价值：** 如果 Harness 需要手机端壳层，这个 SDK 是正式桥接方式。

### 044. @sjtu-nic/jwb-app-invoker NPM 包

- **链接：** [https://www.npmjs.com/package/@sjtu-nic/jwb-app-invoker](https://www.npmjs.com/package/@sjtu-nic/jwb-app-invoker)
- **来源：** 官方发布包
- **状态：** 当前；持续发布
- **认证：** NPM
- **简介：** 交我办 JS SDK 的公开 NPM 包，包含 TypeScript 声明和 App 调用封装。
- **对 Agent Harness 的价值：** 前端项目可直接安装，省去手工复制脚本。

### 045. 交我办开发与调试工具

- **链接：** [https://developer.sjtu.edu.cn/form/guide/devops/tools.html](https://developer.sjtu.edu.cn/form/guide/devops/tools.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus 开发环境
- **简介：** 介绍调试、测试、正式环境以及流程/版本导出等开发辅助工具。
- **对 Agent Harness 的价值：** 适合建立可重复的流程开发和发布流程。

### 046. Workflow Quick Start

- **链接：** [https://developer.sjtu.edu.cn/form/guide/quick-start/workflow.html](https://developer.sjtu.edu.cn/form/guide/quick-start/workflow.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus Workflow
- **简介：** 工作流快速入门，介绍最基本的流程建模和运行方式。
- **对 Agent Harness 的价值：** 想让 Agent 理解流程实例和节点状态时应先读。

### 047. Workflow 基础概念

- **链接：** [https://developer.sjtu.edu.cn/form/guide/workflow/basic.html](https://developer.sjtu.edu.cn/form/guide/workflow/basic.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus Workflow
- **简介：** 更系统地介绍工作流、步骤、动作、参与者等概念。
- **对 Agent Harness 的价值：** 可将 InfoPlus 流程映射为 Agent 的状态机/审批图。

### 048. Workflow 数据绑定

- **链接：** [https://developer.sjtu.edu.cn/form/guide/workflow/databinding.html](https://developer.sjtu.edu.cn/form/guide/workflow/databinding.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus 数据绑定
- **简介：** 说明表单字段与流程数据的绑定机制。
- **对 Agent Harness 的价值：** 如果 Agent 需要读取/填写表单，这是理解数据结构的关键。

### 049. InfoPlus API Reference

- **链接：** [https://developer.sjtu.edu.cn/form/reference/api.html](https://developer.sjtu.edu.cn/form/reference/api.html)
- **来源：** 官方
- **状态：** 当前；权限复杂
- **认证：** InfoPlus OAuth2；User/System Token；Global/Enterprise/Workflow App
- **简介：** 最核心的 InfoPlus API 参考，覆盖 token、任务、流程实例、初始化、编辑、管理、权限及推送等。
- **对 Agent Harness 的价值：** 这是实现“查看待办/查询流程/受控提交”的主文档。

### 050. InfoPlus File API

- **链接：** [https://developer.sjtu.edu.cn/form/reference/fileApi.html](https://developer.sjtu.edu.cn/form/reference/fileApi.html)
- **来源：** 官方
- **状态：** 当前；需流程/应用权限
- **认证：** InfoPlus Token
- **简介：** 处理流程附件和文件相关能力。
- **对 Agent Harness 的价值：** Agent 自动准备材料、下载附件或生成文件时会用到。

### 051. InfoPlus Notification API

- **链接：** [https://developer.sjtu.edu.cn/form/reference/notificationApi.html](https://developer.sjtu.edu.cn/form/reference/notificationApi.html)
- **来源：** 官方
- **状态：** 当前；需权限
- **认证：** InfoPlus Token
- **简介：** InfoPlus 流程内部的通知相关接口。
- **对 Agent Harness 的价值：** 适合流程型 Agent 的状态提醒与业务通知。

### 052. InfoPlus Export API

- **链接：** [https://developer.sjtu.edu.cn/form/reference/exportApi.html](https://developer.sjtu.edu.cn/form/reference/exportApi.html)
- **来源：** 官方
- **状态：** 当前；需权限
- **认证：** InfoPlus Token
- **简介：** 将流程/表单数据按模板导出为文档或 PDF 等。
- **对 Agent Harness 的价值：** 可用于 Agent 自动生成归档材料、证明或业务文档。

### 053. InfoPlus 应用设置

- **链接：** [https://developer.sjtu.edu.cn/form/reference/applicationSettings.html](https://developer.sjtu.edu.cn/form/reference/applicationSettings.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus App
- **简介：** 列出应用级配置与运行参数。
- **对 Agent Harness 的价值：** 用于正式接入前核对回调、权限和行为配置。

### 054. FormData 生命周期

- **链接：** [https://developer.sjtu.edu.cn/form/reference/formData.html](https://developer.sjtu.edu.cn/form/reference/formData.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus
- **简介：** 解释流程表单数据在各阶段的生命周期和可访问方式。
- **对 Agent Harness 的价值：** 能避免 Agent 在错误阶段读写表单字段。

### 055. InfoPlus 变量参考

- **链接：** [https://developer.sjtu.edu.cn/form/reference/variable.html](https://developer.sjtu.edu.cn/form/reference/variable.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus
- **简介：** 整理系统变量、流程变量和上下文变量。
- **对 Agent Harness 的价值：** 适合做模板填充、条件判断与流程上下文注入。

### 056. InfoPlus Messenger

- **链接：** [https://developer.sjtu.edu.cn/form/reference/messenger.html](https://developer.sjtu.edu.cn/form/reference/messenger.html)
- **来源：** 官方
- **状态：** 当前；Workflow 级
- **认证：** HTTP Subscriber / Basic Auth / Java SDK
- **简介：** 事件驱动的消息订阅机制，可让外部系统接收流程事件，并提供 Java SDK。
- **对 Agent Harness 的价值：** 对 Agent 很重要：事件触发比轮询更适合流程状态变化。

### 057. Workflow 属性与事件配置

- **链接：** [https://developer.sjtu.edu.cn/form/reference/editor/workflowProperty.html](https://developer.sjtu.edu.cn/form/reference/editor/workflowProperty.html)
- **来源：** 官方
- **状态：** 当前
- **认证：** InfoPlus Workflow
- **简介：** 工作流编辑器中的属性、事件等配置参考。
- **对 Agent Harness 的价值：** 有助于理解何时可触发外部 Hook 或业务逻辑。

### 058. IFrame 表单控件集成

- **链接：** [https://developer.sjtu.edu.cn/form/reference/topics/iframe.html](https://developer.sjtu.edu.cn/form/reference/topics/iframe.html)
- **来源：** 官方
- **状态：** 当前；受页面权限约束
- **认证：** infoplus.sdk.js / IFrame SDK
- **简介：** 允许在表单中嵌入定制页面，并通过 SDK 与 InfoPlus 表单交互。
- **对 Agent Harness 的价值：** 可作为专用 Agent UI、复杂选择器或外部工具嵌入点。

## 四、网络信息中心服务、部署与个人可用协议

### 059. 网络信息中心信息服务总览

- **链接：** [https://net.sjtu.edu.cn/wlfw.htm](https://net.sjtu.edu.cn/wlfw.htm)
- **来源：** 官方
- **状态：** 当前
- **认证：** 按服务
- **简介：** 列出交我办、jAccount、邮箱、VPN、云盘、jCloud、域名、jAccount 接口、网络短信等校级网络服务。
- **对 Agent Harness 的价值：** 适合寻找 Harness 可能连接的基础设施和官方申请入口。

### 060. jAccount 接口服务页

- **链接：** [https://net.sjtu.edu.cn/wlfw/jAccountjk.htm](https://net.sjtu.edu.cn/wlfw/jAccountjk.htm)
- **来源：** 官方
- **状态：** 当前；服务对象标为部门、教职工
- **认证：** 申请获批后分配 clientId/secret
- **简介：** 当前公开页面写明由交我办提交 jAccount 接口申请，经部门审核、网络信息中心处理，成功后得到 clientId 与密钥。
- **对 Agent Harness 的价值：** 对学生个人项目是关键现实门槛：官方 Open API 客户端凭据大概率需要老师/单位挂靠。

### 061. 如何申请加入 jAccount 认证体系

- **链接：** [https://net.sjtu.edu.cn/info/1227/3007.htm](https://net.sjtu.edu.cn/info/1227/3007.htm)
- **来源：** 官方
- **状态：** 当前公开 FAQ；教职工发起
- **认证：** 部门审批
- **简介：** FAQ 明确写明在校教职工可发起申请，院系/部门领导审批后由网络信息中心受理。
- **对 Agent Harness 的价值：** 用于校正“有学生 jAccount 就能直接注册 OAuth 应用”的误解。

### 062. jAccount 接口使用说明

- **链接：** [https://net.sjtu.edu.cn/info/1228/3009.htm](https://net.sjtu.edu.cn/info/1228/3009.htm)
- **来源：** 官方
- **状态：** 当前/以页面更新为准
- **认证：** jAccount SDK/成员站点
- **简介：** jAccount 成员站点和接口使用说明。
- **对 Agent Harness 的价值：** 适合与开发者平台 OAuth/OIDC 文档交叉核对。

### 063. jAccount 账号服务

- **链接：** [https://net.sjtu.edu.cn/wlfw/jaccountzh.htm](https://net.sjtu.edu.cn/wlfw/jaccountzh.htm)
- **来源：** 官方
- **状态：** 当前；学生默认可用
- **认证：** jAccount
- **简介：** 说明学生/教职工统一账号以及邮箱、无线网、VPN、云盘等服务绑定关系。
- **对 Agent Harness 的价值：** 确定个人 Harness 可以合法依赖哪些基础账户服务。

### 064. 交大邮箱服务

- **链接：** [https://net.sjtu.edu.cn/xxfw/dzyj.htm](https://net.sjtu.edu.cn/xxfw/dzyj.htm)
- **来源：** 官方
- **状态：** 当前；学生/教职工默认开通
- **认证：** IMAP4/POP3/SMTP + jAccount
- **简介：** 公开 IMAP4 993、POP3 995、SMTP 465、HTTP 443 等服务器参数。
- **对 Agent Harness 的价值：** 学生个人邮件 Agent 可优先走标准 IMAP/SMTP，无需等待 Open Mail API scope。

### 065. 交大邮箱服务器参数

- **链接：** [https://net.sjtu.edu.cn/info/1191/2699.htm](https://net.sjtu.edu.cn/info/1191/2699.htm)
- **来源：** 官方
- **状态：** 当前参数/页面较早
- **认证：** IMAP/POP3/SMTP
- **简介：** 单独列出交大邮箱服务器、SSL 端口等参数。
- **对 Agent Harness 的价值：** 适合直接配置成熟邮件客户端库。

### 066. jCloud 交大云服务

- **链接：** [https://net.sjtu.edu.cn/wlfw/jCloudjdy.htm](https://net.sjtu.edu.cn/wlfw/jCloudjdy.htm)
- **来源：** 官方
- **状态：** 当前；师生可用
- **认证：** jAccount
- **简介：** 交大 IaaS 云，支持云主机、存储、网络等，可作为学生项目的校内部署环境。
- **对 Agent Harness 的价值：** 如果 Harness 要长期运行、访问校内-only API，jCloud 是非常合适的宿主。

### 067. jCloud 文档中心

- **链接：** [https://jcloud.sjtu.edu.cn/document/detail.html](https://jcloud.sjtu.edu.cn/document/detail.html)
- **来源：** 官方
- **状态：** 当前；部分内容可能需登录
- **认证：** jAccount
- **简介：** jCloud 的实际操作/资源文档入口。
- **对 Agent Harness 的价值：** 用于部署 Agent 后端、数据库、反向代理与持久服务。

### 068. jCloud 网站校外访问说明

- **链接：** [https://net.sjtu.edu.cn/info/1208/3001.htm](https://net.sjtu.edu.cn/info/1208/3001.htm)
- **来源：** 官方
- **状态：** 当前
- **认证：** 域名/校外访问
- **简介：** 说明部署在 jCloud 的网站如何配合交大域名实现校外访问。
- **对 Agent Harness 的价值：** 正式 Web Harness 要对外提供入口时应参考。

### 069. 域名和网站服务

- **链接：** [https://net.sjtu.edu.cn/wlfw/ym.htm](https://net.sjtu.edu.cn/wlfw/ym.htm)
- **来源：** 官方
- **状态：** 当前；多为部门/教职工业务申请
- **认证：** sjtu.edu.cn 域名 / HTTPS / 反向代理
- **简介：** 提供校内域名、证书、反向代理及网站安全相关服务说明。
- **对 Agent Harness 的价值：** 正式校内应用部署时用于获取稳定域名和 HTTPS。

### 070. 域名申请操作说明

- **链接：** [https://net.sjtu.edu.cn/info/1222/5048.htm](https://net.sjtu.edu.cn/info/1222/5048.htm)
- **来源：** 官方
- **状态：** 当前；需业务申请
- **认证：** 域名申请
- **简介：** 说明网站已部署、IP/jCloud 等前置条件和域名办理步骤。
- **对 Agent Harness 的价值：** 学生项目若要正式挂 sjtu.edu.cn，通常仍需单位支持。

### 071. 网站群/网站建设说明

- **链接：** [https://net.sjtu.edu.cn/info/1222/5038.htm](https://net.sjtu.edu.cn/info/1222/5038.htm)
- **来源：** 官方
- **状态：** 当前/业务申请
- **认证：** 校内网站服务
- **简介：** 网络信息中心提供的网站建设/网站群相关说明。
- **对 Agent Harness 的价值：** 若 Agent 有门户型前端，可了解校内托管选项。

### 072. 二级域名管理规定

- **链接：** [https://net.sjtu.edu.cn/info/1222/2536.htm](https://net.sjtu.edu.cn/info/1222/2536.htm)
- **来源：** 官方
- **状态：** 现行性以最新公告为准
- **认证：** 域名治理
- **简介：** 涉及 sjtu.edu.cn 二级域名的申请与管理规范。
- **对 Agent Harness 的价值：** 正式部署前应核对命名、责任主体和生命周期要求。

### 073. 域名备案与证书相关说明

- **链接：** [https://net.sjtu.edu.cn/info/1222/2545.htm](https://net.sjtu.edu.cn/info/1222/2545.htm)
- **来源：** 官方
- **状态：** 现行性以最新页面为准
- **认证：** 备案/证书
- **简介：** 补充网站域名、备案和安全证书相关要求。
- **对 Agent Harness 的价值：** 适合做正式服务上线 checklist。

### 074. 交大云盘 Pan 服务

- **链接：** [https://net.sjtu.edu.cn/xxfw/jBoxjdyp.htm](https://net.sjtu.edu.cn/xxfw/jBoxjdyp.htm)
- **来源：** 官方
- **状态：** 当前；学生/教职工默认开通
- **认证：** jAccount
- **简介：** 新一代 Pan 位于 pan.sjtu.edu.cn，老 jBox 已于 2025-05-31 下线；个人默认容量公开页写为 1TB。
- **对 Agent Harness 的价值：** 官方公开的是用户服务文档；未发现面向个人开发者的稳定正式 API 文档。

### 075. Pan 交大云盘使用手册

- **链接：** [https://pan.sjtu.edu.cn/pandoc/install.html](https://pan.sjtu.edu.cn/pandoc/install.html)
- **来源：** 官方
- **状态：** 当前；用户手册
- **认证：** jAccount
- **简介：** Pan 客户端、同步和文件管理说明。
- **对 Agent Harness 的价值：** 接口开发需结合社区项目研究 Web API，并承担私有接口变化风险。

### 076. 交大 VPN

- **链接：** [https://net.sjtu.edu.cn/wlfw/VPN.htm](https://net.sjtu.edu.cn/wlfw/VPN.htm)
- **来源：** 官方
- **状态：** 当前；学生/教职工默认开通
- **认证：** jAccount
- **简介：** 校外访问校内资源的官方 VPN 服务。
- **对 Agent Harness 的价值：** 当模型 API、教学资源或内部页面限制校园网时，Harness 运行端需要 VPN 或直接部署在校内网络。

### 077. 网络短信服务

- **链接：** [https://net.sjtu.edu.cn/xxfw/wldx.htm](https://net.sjtu.edu.cn/xxfw/wldx.htm)
- **来源：** 官方
- **状态：** 业务级/部门申请
- **认证：** 网络短信平台
- **简介：** 校内短信发送服务，偏部门业务使用。
- **对 Agent Harness 的价值：** Agent 通知若要走短信，应优先通过获批的统一 Notification API/短信服务，避免自建不合规通道。

## 五、2026 年官方 AI / Agent 基础设施

### 078. OpenClaw 校园应用中心

- **链接：** [https://claw.sjtu.edu.cn/](https://claw.sjtu.edu.cn/)
- **来源：** 官方
- **状态：** 当前
- **认证：** jAccount/各子服务凭据
- **简介：** 上海交大 2026 年面向校园 Agent 应用的官方入口，包含使用指南、案例、校园 Skill 集市和模型 API 文档。
- **对 Agent Harness 的价值：** 直接证明校园 Agent 已进入官方支持生态，适合作为你的 Harness 设计对照。

### 079. 致远一号本地大模型 API 文档

- **链接：** [https://claw.sjtu.edu.cn/guide/sjtu-api/](https://claw.sjtu.edu.cn/guide/sjtu-api/)
- **来源：** 官方
- **状态：** 当前；测试政策随时间变化
- **认证：** API Key；校园网/VPN
- **简介：** 公开 Base URL 为 https://models.sjtu.edu.cn/api/v1，兼容 OpenAI 与 Anthropic 请求格式；当前文档列出 DeepSeek、MiniMax、Qwen 等模型及申请方式。
- **对 Agent Harness 的价值：** 可直接作为 Harness 的校内模型后端。额度、模型和测试截止日期应每次以页面最新内容为准。

### 080. 致远一号接入 Codex / Claude Code 等

- **链接：** [https://claw.sjtu.edu.cn/guide/ai-api-claude/](https://claw.sjtu.edu.cn/guide/ai-api-claude/)
- **来源：** 官方
- **状态：** 当前
- **认证：** 致远一号 API Key
- **简介：** 专门说明把校园模型 API 接入 Codex、Claude Code、WorkBuddy、CC-Switch 等 Agent/编码工具。
- **对 Agent Harness 的价值：** 对配置 OpenAI-compatible/Anthropic-compatible provider 很直接。

### 081. 校园龙虾 Skill 集市

- **链接：** [https://claw.sjtu.edu.cn/sjtu-skills/](https://claw.sjtu.edu.cn/sjtu-skills/)
- **来源：** 官方门户
- **状态：** 当前
- **认证：** 按 Skill 自身要求
- **简介：** 官方校园 Skill 展示/分发页面，当前可发现校园综合助手等项目。
- **对 Agent Harness 的价值：** 适合持续发现新校园 Connector，优先关注官方页面实际收录的 Skill。

### 082. OpenClaw 案例中心

- **链接：** [https://claw.sjtu.edu.cn/cases/](https://claw.sjtu.edu.cn/cases/)
- **来源：** 官方
- **状态：** 当前
- **认证：** 按案例
- **简介：** 汇总交大内部 Agent 应用案例，例如教学、HPC、校园服务等。
- **对 Agent Harness 的价值：** 用于判断哪些集成已经在校内真实落地。

### 083. OpenClaw FAQ

- **链接：** [https://claw.sjtu.edu.cn/guide/faq/](https://claw.sjtu.edu.cn/guide/faq/)
- **来源：** 官方
- **状态：** 当前
- **认证：** 按主题
- **简介：** OpenClaw 校园使用常见问题。
- **对 Agent Harness 的价值：** 适合处理网络、API、模型和客户端配置中的常见障碍。

### 084. 致远一号智算平台

- **链接：** [https://aic.sjtu.edu.cn/](https://aic.sjtu.edu.cn/)
- **来源：** 官方
- **状态：** 当前；jAccount/平台权限
- **认证：** 智算平台
- **简介：** 学校 AI 计算与模型服务入口。OpenClaw 文档将其作为致远一号相关链接。
- **对 Agent Harness 的价值：** 如果 Harness 需要更高算力、模型服务或运行资源，可继续沿此入口查申请。

### 085. SJTU-HPC GitHub 组织

- **链接：** [https://github.com/SJTU-HPC](https://github.com/SJTU-HPC)
- **来源：** 官方/校内技术团队
- **状态：** 当前
- **认证：** GitHub
- **简介：** 上海交大高性能计算相关公开仓库集合。
- **对 Agent Harness 的价值：** Agent 与 HPC/SLURM 集成时是重要代码来源。

### 086. SJTU OpenClaw 安装脚本

- **链接：** [https://github.com/SJTU-HPC/install-openclaw](https://github.com/SJTU-HPC/install-openclaw)
- **来源：** 官方/校内技术团队
- **状态：** 当前
- **认证：** 本地环境
- **简介：** 面向交大环境的 OpenClaw 安装/配置脚本。
- **对 Agent Harness 的价值：** 可以参考校园环境依赖、镜像和默认配置。

### 087. SJTU-SLURM-Skill

- **链接：** [https://github.com/SJTU-HPC/SJTU-SLURM-Skill](https://github.com/SJTU-HPC/SJTU-SLURM-Skill)
- **来源：** 官方/校内技术团队
- **状态：** 当前
- **认证：** HPC/SLURM 凭据与权限
- **简介：** 面向 OpenClaw/Agent 的交大 HPC SLURM Skill。
- **对 Agent Harness 的价值：** 它展示了如何把严肃计算基础设施包装成受控 Agent Tool。

### 088. SJTU HPC 文档源码

- **链接：** [https://github.com/SJTU-HPC/docs.hpc.sjtu.edu.cn](https://github.com/SJTU-HPC/docs.hpc.sjtu.edu.cn)
- **来源：** 官方/校内技术团队
- **状态：** 当前
- **认证：** GitHub
- **简介：** 交大 HPC 文档站源码。
- **对 Agent Harness 的价值：** 适合检索集群、作业系统、存储和账号使用规则。

### 089. SJTU HPC 在线文档

- **链接：** [https://docs.hpc.sjtu.edu.cn/](https://docs.hpc.sjtu.edu.cn/)
- **来源：** 官方
- **状态：** 当前
- **认证：** HPC 账户
- **简介：** 高性能计算平台使用文档。
- **对 Agent Harness 的价值：** 如果未来 Harness 能提交科研计算任务，这里是操作和安全边界来源。

### 090. “交学伴”等校园 AI 教学案例

- **链接：** [https://news.sjtu.edu.cn/ztzl_aijyzl/20260604/223459.html](https://news.sjtu.edu.cn/ztzl_aijyzl/20260604/223459.html)
- **来源：** 官方新闻/案例
- **状态：** 2026 案例
- **认证：** Canvas/LTI/校内模型等
- **简介：** 报道交大教学场景中的 AI 助手、课程平台与本地模型集成。
- **对 Agent Harness 的价值：** 提供真实校园应用架构线索，证明 Canvas + 校内模型 + RAG/Agent 组合具有实践基础。

## 六、GitHub / 社区项目：直接涉及 SJTU 接口、认证或校园服务

### 091. SJTU-Geek/sjtu-mcp-server

- **链接：** [https://github.com/SJTU-Geek/sjtu-mcp-server](https://github.com/SJTU-Geek/sjtu-mcp-server)
- **来源：** GitHub 社区
- **状态：** 当前活跃；私有/会话接口为主
- **认证：** JAAuthCookie；部分插件
- **简介：** 面向 MCP 的交大校园工具服务器，覆盖 i.sjtu 课表/成绩/GPA/考试、交大邮箱、体育场馆、my.sjtu、第二课堂、教务处新闻等。
- **对 Agent Harness 的价值：** 与你的 Harness 目标高度重合；非常适合研究 Tool Schema、MCP 传输和跨站认证，但 JAAuthCookie 属于高敏感会话凭据。

### 092. kuan-er/sjtu-agent

- **链接：** [https://github.com/kuan-er/sjtu-agent](https://github.com/kuan-er/sjtu-agent)
- **来源：** GitHub 社区
- **状态：** 当前活跃
- **认证：** jAccount 凭据 / Cookie / 致远一号 API Key 等
- **简介：** 完整校园 Agent，支持终端和多个聊天平台，涉及 Canvas、DDL、校园新闻、食堂/校园生活信息、定时服务、MCP/记忆等。
- **对 Agent Harness 的价值：** 可直接研究长期运行 Agent 的任务调度、消息入口与校园数据插件化设计。项目文档提示部分凭据会本地明文保存，复用时应改进 Secret Store。

### 093. xhh678876/openclaw-sjtu

- **链接：** [https://github.com/xhh678876/openclaw-sjtu](https://github.com/xhh678876/openclaw-sjtu)
- **来源：** GitHub 社区；官方 Skill 集市收录
- **状态：** 当前
- **认证：** Canvas Token / 邮箱 / Cookie / API Key 等多种凭据
- **简介：** OpenClaw 上海交大全能校园 Skill 包，覆盖 Canvas DDL/成绩/文件、邮箱、食堂、图书馆、教室、班车、校历、新闻、水源、jCourse 等。
- **对 Agent Harness 的价值：** 目前最接近“一站式 SJTU Agent Connector”的公开参考之一。不同子工具依赖的认证机制需要逐项隔离。

### 094. xhh678876/sjtu-canvas

- **链接：** [https://github.com/xhh678876/sjtu-canvas](https://github.com/xhh678876/sjtu-canvas)
- **来源：** GitHub 社区
- **状态：** 当前
- **认证：** Canvas Personal Access Token
- **简介：** 专注 oc.sjtu.edu.cn Canvas：课程、文件、作业、成绩、讨论、DDL、课件抽取和日历同步，并封装为 OpenClaw Skill。
- **对 Agent Harness 的价值：** 学生个人 Harness 的低门槛优先参考，接口基于 Canvas 官方 REST API，稳定性通常优于页面抓取。

### 095. Okabe-Rintarou-0/SJTU-Canvas-Helper

- **链接：** [https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper](https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper)
- **来源：** GitHub 社区
- **状态：** 当前活跃
- **认证：** Canvas Token / 多模型 API Key
- **简介：** Tauri 桌面 Canvas 客户端，兼容本部与密院 Canvas，支持文件、视频、DDL、作业、成绩等，并提供 MCP Server。
- **对 Agent Harness 的价值：** 适合作为 Canvas Connector、桌面端和 MCP 暴露方式的成熟参考。

### 096. skyzh/canvas_grab

- **链接：** [https://github.com/skyzh/canvas_grab](https://github.com/skyzh/canvas_grab)
- **来源：** GitHub 社区
- **状态：** 当前维护；通用 Canvas
- **认证：** Canvas API Key
- **简介：** 用于同步 Canvas LMS 文件，项目文档明确提到 SJTU GitLab/Canvas 使用场景。
- **对 Agent Harness 的价值：** 代码量相对聚焦，适合研究 Canvas 文件增量同步、重试和本地缓存。

### 097. PhotonQuantum/pysjtu

- **链接：** [https://github.com/PhotonQuantum/pysjtu](https://github.com/PhotonQuantum/pysjtu)
- **来源：** GitHub 社区
- **状态：** 历史高价值；接口可能已变化
- **认证：** jAccount 登录/session/captcha
- **简介：** Python iSJTU 客户端，曾覆盖大量教学信息服务网 API，包括课程、选课、课表、考试、GPA 等。
- **对 Agent Harness 的价值：** 是研究 i.sjtu 私有接口最重要的历史资料之一；直接复用前必须重新验证 endpoint 和登录流程。

### 098. iSJTU / 正方接口分析 Gist

- **链接：** [https://gist.github.com/PhotonQuantum/88907a1b43a4fac60535547c9ab29600](https://gist.github.com/PhotonQuantum/88907a1b43a4fac60535547c9ab29600)
- **来源：** GitHub Gist
- **状态：** 历史；易失效
- **认证：** jAccount/session
- **简介：** 对早期 iSJTU/选课协议和请求流程的技术分析。
- **对 Agent Harness 的价值：** 适合 endpoint archaeology 与理解旧版系统，不宜据此构建高频自动化或抢课行为。

### 099. LightQuantumArchive/jaccount-captcha-solver

- **链接：** [https://github.com/LightQuantumArchive/jaccount-captcha-solver](https://github.com/LightQuantumArchive/jaccount-captcha-solver)
- **来源：** GitHub 社区
- **状态：** 历史/研究用途
- **认证：** 图形验证码 OCR
- **简介：** 针对旧版 jAccount 登录验证码的 SVM/ResNet 识别器，并曾与 pysjtu 集成。
- **对 Agent Harness 的价值：** 用于理解旧登录自动化历史；现代 Harness 应优先 OAuth/扫码/用户交互授权，避免保存 jAccount 密码。

### 100. LightQuantumArchive/jaccount-captcha-solver-webextension

- **链接：** [https://github.com/LightQuantumArchive/jaccount-captcha-solver-webextension](https://github.com/LightQuantumArchive/jaccount-captcha-solver-webextension)
- **来源：** GitHub 社区
- **状态：** 历史/研究用途
- **认证：** 浏览器扩展
- **简介：** 把 jAccount 验证码识别封装到浏览器扩展。
- **对 Agent Harness 的价值：** 更多是旧登录机制的考古资料，当前适用性需自行验证。

### 101. dyweb/go-jaccount

- **链接：** [https://github.com/dyweb/go-jaccount](https://github.com/dyweb/go-jaccount)
- **来源：** GitHub 社区
- **状态：** 可参考；最后维护状态以 GitHub 为准
- **认证：** OAuth 2.0 clientId/clientSecret
- **简介：** Go 语言 jAccount OAuth/API 客户端，示例直接使用 essential scope 获取 Profile。
- **对 Agent Harness 的价值：** 如果 Harness 后端用 Go，这是少见的现成 jAccount 客户端实现；同时可核对 OAuth 参数细节。

### 102. dyweb/oauth2-jaccount

- **链接：** [https://github.com/dyweb/oauth2-jaccount](https://github.com/dyweb/oauth2-jaccount)
- **来源：** GitHub 社区
- **状态：** 可参考
- **认证：** PHP League OAuth2 Client
- **简介：** 为 PHP League OAuth 2.0 Client 提供 jAccount Provider，示例包含 state 校验、access/refresh token 和资源用户读取。
- **对 Agent Harness 的价值：** 适合 PHP 服务，也能作为规范 OAuth 回调实现的参考。

### 103. SJTU-jCourse/next

- **链接：** [https://github.com/SJTU-jCourse/next](https://github.com/SJTU-jCourse/next)
- **来源：** GitHub 社区/校园项目
- **状态：** 当前架构
- **认证：** JAccount OAuth + 自身 API Key/会话
- **简介：** 2026 年新版选课社区代码，JAccount OAuth 用于校内身份/选课数据同步，对外接口另有 API Key 机制。
- **对 Agent Harness 的价值：** 这是当前较新的 jAccount OAuth 实战项目，适合学习生产级 session、账户绑定和外部 API 设计。

### 104. SJTU-jCourse/jcourse_api

- **链接：** [https://github.com/SJTU-jCourse/jcourse_api](https://github.com/SJTU-jCourse/jcourse_api)
- **来源：** GitHub 社区/校园项目
- **状态：** 已被 2026-05-28 新架构替代
- **认证：** JACCOUNT_CLIENT_ID / JACCOUNT_CLIENT_SECRET
- **简介：** 旧版选课社区 Django 后端，公开环境变量和 jAccount 集成方式。
- **对 Agent Harness 的价值：** 虽然线上已迁移，它仍是非常清晰的旧版 OAuth 接入样例。

### 105. SJTU-jCourse/jcourse_vite

- **链接：** [https://github.com/SJTU-jCourse/jcourse_vite](https://github.com/SJTU-jCourse/jcourse_vite)
- **来源：** GitHub 社区/校园项目
- **状态：** 旧版前端/已迁移
- **认证：** OAuth/API 代理
- **简介：** 旧版选课社区前端，可观察前后端 OAuth callback/API proxy 的组织方式。
- **对 Agent Harness 的价值：** 适合作为历史架构参考。

### 106. SJTU-jCourse/jcourse

- **链接：** [https://github.com/SJTU-jCourse/jcourse](https://github.com/SJTU-jCourse/jcourse)
- **来源：** GitHub 社区/校园项目
- **状态：** 更早期/历史
- **认证：** jAccount/站点会话
- **简介：** 更早期选课社区代码。
- **对 Agent Harness 的价值：** 主要用于追踪校园身份接入和选课社区架构演进。

### 107. SJTU-jCourse GitHub Organization

- **链接：** [https://github.com/SJTU-jCourse](https://github.com/SJTU-jCourse)
- **来源：** GitHub 社区/校园项目
- **状态：** 当前
- **认证：** GitHub
- **简介：** 选课社区组织主页，可发现 next、legacy backend/frontend 等仓库。
- **对 Agent Harness 的价值：** 后续仓库新增时，从组织页持续跟踪比单个搜索更可靠。

### 108. sunalan2025/sjtu-downloader-all-in-one

- **链接：** [https://github.com/sunalan2025/sjtu-downloader-all-in-one](https://github.com/sunalan2025/sjtu-downloader-all-in-one)
- **来源：** GitHub 社区
- **状态：** 当前活跃；含私有 Web API
- **认证：** jAccount 扫码会话 / Canvas session / Pan UserToken 等
- **简介：** 一体化课程下载器，覆盖 v.sjtu、Canvas、好大学在线，并可直传 Pan 云盘。登录信息留在本机。
- **对 Agent Harness 的价值：** 对 Canvas、视频资源、jAccount SSO、Pan 上传的真实接口组合研究价值很高。

### 109. sjtu-downloader-all-in-one 架构文档

- **链接：** [https://github.com/sunalan2025/sjtu-downloader-all-in-one/blob/master/ARCHITECTURE.md](https://github.com/sunalan2025/sjtu-downloader-all-in-one/blob/master/ARCHITECTURE.md)
- **来源：** GitHub 社区
- **状态：** 当前；私有接口易变
- **认证：** Canvas Cookie / Pan UserToken
- **简介：** 详细记录 Canvas REST/下载跳转、限流重试以及 Pan `/api/v1`、空间查询、分片上传、删除等封装结构。
- **对 Agent Harness 的价值：** 这是研究 Pan 私有 Web API 和 Canvas 文件管线最详细的公开资料之一。

### 110. 1357310795/TboxWebdav

- **链接：** [https://github.com/1357310795/TboxWebdav](https://github.com/1357310795/TboxWebdav)
- **来源：** GitHub 社区
- **状态：** 当前/需验证；私有 Pan API
- **认证：** JAAuthCookie 或 Pan UserToken
- **简介：** 把新交大云盘 Pan 暴露为 WebDAV，围绕 UserToken 和底层云盘 API 进行封装。
- **对 Agent Harness 的价值：** 若你想把 Pan 做成 Agent FileStore，这是重要参考；认证 Cookie/Token 不应交给 LLM 上下文。

### 111. 1357310795/JboxTransfer

- **链接：** [https://github.com/1357310795/JboxTransfer](https://github.com/1357310795/JboxTransfer)
- **来源：** GitHub 社区
- **状态：** 历史迁移工具
- **认证：** jAccount/Pan 相关认证
- **简介：** 用于旧 jBox 向新 Pan 迁移的数据工具，反映 2025 云盘切换时期的接口与迁移实践。
- **对 Agent Harness 的价值：** 适合研究新旧云盘数据模型与认证，不适合作为长期 API 契约。

### 112. young1881/SJTUer

- **链接：** [https://github.com/young1881/SJTUer](https://github.com/young1881/SJTUer)
- **来源：** GitHub 社区
- **状态：** 历史/可参考
- **认证：** JAccount + 爬虫
- **简介：** 非官方交大个人门户，聚合常用站点、JAccount 登录、教务/新闻抓取、食堂和图书馆人流等。
- **对 Agent Harness 的价值：** 是较早的“校园 OS”式聚合项目，可借鉴信息聚合和模块化思路。

### 113. dajiaohuang/shuiyuan-mcp

- **链接：** [https://github.com/dajiaohuang/shuiyuan-mcp](https://github.com/dajiaohuang/shuiyuan-mcp)
- **来源：** GitHub 社区
- **状态：** 当前/第三方服务接口
- **认证：** 水源 SSO Cookie / Discourse 能力
- **简介：** 针对水源社区的 MCP，支持搜索、读取、用户/频道/草稿等能力，通常以只读为默认。
- **对 Agent Harness 的价值：** 适合研究如何把 Discourse 型社区包成 Agent Tool，并做读写权限分层。

### 114. cmd2001/jLock

- **链接：** [https://github.com/cmd2001/jLock](https://github.com/cmd2001/jLock)
- **来源：** GitHub 社区
- **状态：** 安全敏感；历史/研究
- **认证：** jAccount 凭据 + 宿舍门锁业务数据
- **简介：** 围绕宿舍智能门锁的 Python 原型，并依赖 pysjtu。仓库示例会保存账号信息。
- **对 Agent Harness 的价值：** 说明校园物理系统也曾被个人程序接入；这类能力不应交给自治 Agent，凭据和物理控制需严格隔离。

### 115. G-dab/SJTUAppointment

- **链接：** [https://github.com/G-dab/SJTUAppointment](https://github.com/G-dab/SJTUAppointment)
- **来源：** GitHub 社区
- **状态：** 历史；页面自动化
- **认证：** jAccount + Selenium/captcha
- **简介：** 基于 Selenium 的体育场馆预约脚本，模拟网页登录、选择场馆和预约。
- **对 Agent Harness 的价值：** 可用于了解旧版 sports.sjtu 交互面；当前已有 MCP 项目实现更直接的业务接口封装。

### 116. ifarewell/jAutoVenue

- **链接：** [https://github.com/ifarewell/jAutoVenue](https://github.com/ifarewell/jAutoVenue)
- **来源：** GitHub 社区
- **状态：** 历史；页面自动化
- **认证：** jAccount + Selenium
- **简介：** 更早期的体育场馆自动预约脚本。
- **对 Agent Harness 的价值：** 主要用于历史页面流程考古，不建议作为现代 Agent 的基础。

### 117. sunalan2025/sjtu-course-community

- **链接：** [https://github.com/sunalan2025/sjtu-course-community](https://github.com/sunalan2025/sjtu-course-community)
- **来源：** GitHub 社区
- **状态：** 当前/需验证；Web 私有接口
- **认证：** i.sjtu session/CSRF
- **简介：** 围绕 i.sjtu/xsxk 与课程社区的浏览器脚本/数据抓取项目，涉及分页、会话、CSRF 和请求节流。
- **对 Agent Harness 的价值：** 适合学习 iSJTU 当前 Web 层数据抓取方式，但私有端点可能随教务系统更新而变化。

### 118. api-evangelist/shanghai-jiao-tong-university

- **链接：** [https://github.com/api-evangelist/shanghai-jiao-tong-university](https://github.com/api-evangelist/shanghai-jiao-tong-university)
- **来源：** 第三方 GitHub 索引
- **状态：** 2026；第三方整理
- **认证：** 公开文档
- **简介：** 第三方 API 目录项目，索引 jAccount/OIDC、数据资源 GraphQL/REST 等，并记录外部探测结果。
- **对 Agent Harness 的价值：** 可当作遗漏检查表，权威性低于学校官方文档。

### 119. Z3ratu1 SSO 安全综述

- **链接：** [https://github.com/Z3ratu1/Z3ratu1.github.io/blob/master/SSO安全简易综述.html](https://github.com/Z3ratu1/Z3ratu1.github.io/blob/master/SSO安全简易综述.html)
- **来源：** GitHub 社区/安全分析
- **状态：** 历史/分析文章
- **认证：** OAuth/OIDC
- **简介：** 以包括 SJTU 在内的单点登录文档为例讨论 OAuth/OIDC 安全实现与 state/redirect 等细节。
- **对 Agent Harness 的价值：** 做 Harness OAuth 时值得用来检查 CSRF、重定向和 token 暴露风险；最终安全要求仍以协议与官方文档为准。

### 120. MaybeBio/pyPaperFlow

- **链接：** [https://github.com/MaybeBio/pyPaperFlow](https://github.com/MaybeBio/pyPaperFlow)
- **来源：** GitHub 社区
- **状态：** 当前；致远 API 消费示例
- **认证：** OpenAI-compatible API Key
- **简介：** 科研文献处理项目明确支持把 base_url 指向 `https://models.sjtu.edu.cn/api/v1`。
- **对 Agent Harness 的价值：** 展示致远一号作为普通 OpenAI-compatible provider 接入现有程序的实际方式。

### 121. RETEMPT/PokeScope

- **链接：** [https://github.com/RETEMPT/PokeScope](https://github.com/RETEMPT/PokeScope)
- **来源：** GitHub 社区
- **状态：** 当前/示例
- **认证：** OpenAI-compatible API Key
- **简介：** 公开项目中出现交大 `models.sjtu.edu.cn` 作为模型 API Base URL 的配置。
- **对 Agent Harness 的价值：** 用于验证致远一号对第三方应用的兼容性生态。

### 122. PigeonDan1/paper_claw

- **链接：** [https://github.com/PigeonDan1/paper_claw](https://github.com/PigeonDan1/paper_claw)
- **来源：** GitHub 社区
- **状态：** 当前/示例
- **认证：** 模型 API Key
- **简介：** Agent/论文类项目，公开配置可与交大本地模型服务结合。
- **对 Agent Harness 的价值：** 可参考科研 Agent 如何使用校园模型后端。

### 123. JohannsenLum/canvas-api-mcp

- **链接：** [https://github.com/JohannsenLum/canvas-api-mcp](https://github.com/JohannsenLum/canvas-api-mcp)
- **来源：** GitHub 开源；通用 Canvas
- **状态：** 当前/通用
- **认证：** Canvas Token
- **简介：** 通用 Canvas API MCP Server，覆盖大量 Canvas endpoint。它没有专门绑定 SJTU，但可以把 base URL 指向学校 Canvas 实例后作为代码参考。
- **对 Agent Harness 的价值：** 如果你想自己做 Canvas MCP，比从零写 API wrapper 更高效。

## 七、风险与历史接口：可做考古，不建议直接作为 Harness 默认能力

### 124. accelerator-s/SJTURunningMan_Revise_Edition

- **链接：** [https://github.com/accelerator-s/SJTURunningMan_Revise_Edition](https://github.com/accelerator-s/SJTURunningMan_Revise_Edition)
- **来源：** GitHub 社区
- **状态：** 风险/历史
- **认证：** 体育相关私有接口
- **简介：** 与校园跑步系统自动化相关的社区项目。部分同类项目可能涉及生成或上传非真实运动记录。
- **对 Agent Harness 的价值：** 只把它当作历史 endpoint 线索；不要复用伪造记录、绕过考核或自动提交行为。

### 125. Gnonymous/SJTURunning

- **链接：** [https://github.com/Gnonymous/SJTURunning](https://github.com/Gnonymous/SJTURunning)
- **来源：** GitHub 社区
- **状态：** 风险/历史
- **认证：** 体育相关私有接口
- **简介：** 交大跑步系统相关自动化项目。
- **对 Agent Harness 的价值：** 可用于了解旧系统存在过哪些网络接口；不建议实现任何学业/体育记录造假自动化。

### 126. JackyTJie/SJTURunningMan_Advanced_Edition

- **链接：** [https://github.com/JackyTJie/SJTURunningMan_Advanced_Edition](https://github.com/JackyTJie/SJTURunningMan_Advanced_Edition)
- **来源：** GitHub 社区
- **状态：** 风险/历史
- **认证：** 体育相关私有接口
- **简介：** 另一项跑步系统自动化项目。
- **对 Agent Harness 的价值：** 文档索引价值高于执行价值；Harness 应设置合规策略，拒绝伪造记录类动作。

## 八、给学生个人 Harness 的复用路线图

**优先顺序建议：** 先用学生本人就能稳定取得的标准接口建立可用版本，再把需要申请或依赖私有会话的能力独立成可选 Connector。这样即使某个校园站点改版，核心 Harness 仍能工作。

| 阶段                   | 数据/接口                                                                                        | 实现重点                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| P0：立即可做           | Canvas Personal Token；交大邮箱 IMAP/SMTP；致远一号模型 API；公开新闻/校历/班车等公开数据；VPN。 | 先完成课程/DDL/课件、邮件、模型 Provider、公共信息和日程同步。                     |
| P1：个人会话 Connector | i.sjtu、sports、activity、Pan、水源等已被社区项目验证的个人 Web 接口。                           | 凭据仅保存在本地 Secret Store；Tool 层做域名白名单、最小权限、速率限制和读写分离。 |
| P2：正式 Open API      | 通过老师/实验室/社团/院系申请 jAccount clientId 与所需 scopes。                                  | 把 Profile、Lessons、Card、Mail 等替换或补充为官方接口，降低逆向维护成本。         |
| P3：InfoPlus           | 在明确业务场景与应用/Workflow 权限后接入。                                                       | 实现待办聚合、流程状态、附件、受控表单写入；写操作强制用户确认。                   |
| P4：校级数据资源       | 只在部门级合作且拿到字段审批后启用 exchange_data。                                               | 做学院/实验室内部科研、教学、资产或人员数据 Agent；严格用途隔离和审计。            |

### Harness 权限与凭据建议

- **只读自动执行：** 公开信息、课表/DDL、邮件检索、余额查询等，输出前做数据最小化。
- **私密读取：** 邮件正文、校园卡流水、Canvas 作业内容等只进入当前任务上下文，避免写入长期记忆。
- **普通写操作：** 发邮件、提交作业附件、创建日程等执行前展示目标、内容和影响并确认。
- **资金/流程/身份动作：** 充值、流程提交、岗位权限、签章、支付码、物理门禁等采用强确认；能用 TOTP/重新登录时做二次认证。
- **Session/Cookie：** JAAuthCookie、Pan UserToken、Canvas Token、refresh token 均放 OS Keychain/Vault/Secret Service；LLM 只获得一个抽象 tool capability。
- **可维护性：** 官方标准 API > 标准协议/厂商 API > 私有 Web API > 页面自动化。把每一层做成独立 Adapter，给私有接口加健康检查和降级。

### 外部上游协议文档（SJTU 服务的通用底座）

- **[Canvas LMS REST API](https://canvas.instructure.com/doc/api/)**：`oc.sjtu.edu.cn` 使用 Canvas，官方 Instructure REST API 是课程、文件、作业、成绩、讨论等端点的上游契约。
- **[Canvas OAuth2](https://canvas.instructure.com/doc/api/file.oauth.html)**：若从个人 Token 升级到正式第三方应用，可参考 Canvas OAuth2 / Developer Key 流程。
- **[Canvas Access Tokens](https://canvas.instructure.com/doc/api/access_tokens.html)**：说明 Token 生命周期、权限和管理接口。

## 检索覆盖与使用说明

主要检索域包括 `developer.sjtu.edu.cn`、`net.sjtu.edu.cn`、`claw.sjtu.edu.cn`、`aic.sjtu.edu.cn`、`jcloud.sjtu.edu.cn`、`pan.sjtu.edu.cn`、`github.com`、`gist.github.com`，以及公开搜索引擎中可索引的 SJTU/jAccount/Canvas/iSJTU/Pan/InfoPlus/MCP/Agent 相关项目。官方页面优先作为事实来源；GitHub 项目用于补充真实接口实践、私有 Web API 和历史实现。

状态标签中的“当前”只表示本次检索时页面或仓库仍可检索、内容仍具有现实相关性；它不承诺接口长期稳定。私有 Web API、JAAuthCookie/UserToken/session、验证码自动化、页面抓取等方案尤其容易因校内系统升级而失效，也可能受使用条款、速率限制和安全策略约束。

本索引共收录 **126 条** SJTU 相关官方/社区条目，另附 **3 条** Canvas 上游协议文档。建议后续把本文件转换成机器可读 Registry（YAML/JSON），为每个 Connector 增加 `auth_type`、`risk_level`、`healthcheck`、`last_verified`、`official/private` 等字段。
