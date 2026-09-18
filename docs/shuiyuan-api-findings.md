# 水源社区（shuiyuan.sjtu.edu.cn）API 探测记录

日期：2026-09-13、2026-09-14、2026-09-15。方式：匿名 HTTP 探测 + 本人在受控浏览器会话中完成一次 jAccount 登录后，用该会话同源请求各 Discourse JSON 端点实测。探测过程未读取仓库 `.env`，凭据由用户在登录窗口人工输入（jAccount 登录含验证码，无法也无必要脚本化）。本文与 `canvas-api-findings.md` 同一定位：只记录事实与结构推断，不含实现承诺；产品设想单独标注。

## 0. 最新结论（2026-09-14、2026-09-15）

**已验证 Dela 的水源 User API Key 只读授权可行。** 用户在水源页面手动确认后，本机成功完成“加密 payload 解密 → `User-Api-Key` 只读请求 → 撤销测试 key”的完整链路。Dela 展示名可直接打开相同授权页；没有证据表明请求需要 OpenClaw 安装、配置或展示名白名单。

**已验证 `write` scope 同样可签发且写接口真实生效（2026-09-15）。** 与只读流程同一请求形态（`scopes=write`、不带 `auth_redirect`），授权页正常展示「写入所有」并完成授权；解密后实测创建/删除书签均 200，撤销后请求 403。写操作仅凭 `User-Api-Key` 头即可，无需 CSRF token。另确认：**水源偏好设置没有任何 User API Key 的查看或撤销界面**（安全性页仅有“最近使用的设备”），key 的生命周期管理只能由客户端自身实现，详见 2.1。

**Dela 已实现授权绑定模块，并以真实用户绑定完成只读端点结构普查（2026-09-15）。** 主侧栏新增「水源」入口，`read` scope 授权流（独立窗口登录授权 → 用户复制密文 → 回 Dela 粘贴绑定 → safeStorage 保存）已在实机走通；随后用该 key 普查 17 个只读端点，全部 200，结构与字段记录见第 3 节。

这是一项已验证的外部能力，不等于 Dela 已实现该接入。验证范围限一个已登录账号和 `read` scope；完整过程、边界与仍待验证项见 2.1 节。

## 1. 站点身份与访问策略（已验证）

| 事项       | 实测结论                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架与版本 | Discourse **2026.5.0-latest.1**（HTML meta generator；标准 Discourse 路由全部在位，`X-Discourse-Route` 头可确认）                                                                                                 |
| 访问策略   | 全站强制登录（`login_required`）：匿名请求 `latest.json`、`categories.json`、`site.json`、`about.json` 一律 403 `{"errors":["您需要登录才能执行此操作。"],"error_type":"not_logged_in"}`                          |
| 爬虫旁路   | Googlebot UA 仍 403；`latest.rss` 302 跳登录。无任何匿名数据泄露面                                                                                                                                                |
| 登录入口   | 唯一入口为 jAccount SSO：`/` → 302 `/auth/jaccount` → 302 `jaccount.sjtu.edu.cn/oauth2/authorize?client_id=nvRnqMSQc1tpkGoSC36N&redirect_uri=…/auth/jaccount/callback&response_type=code&scope=essential&state=…` |
| 会话机制   | 登录回跳后由 Discourse 种会话 cookie；`GET /session/csrf` 匿名可用（写操作前置）                                                                                                                                  |

`client_id=nvRnqMSQc1tpkGoSC36N` 是**水源自己注册的 jAccount 应用**。Dela 不是 OAuth client，不持有任何 client_secret，只是让用户在受控窗口里正常完成一次浏览器登录——与"无法取得 jAccount client_id"的固定约束不冲突。

## 2. 工作原理：与教学信息服务网（课表）登录同构

用户在浏览器里对水源做的事，和 Dela 已实现的课表接入是同一个模式：**让真实用户在独立持久 Session 的窗口里人工完成 jAccount 登录，然后带着目标站点种下的会话 cookie 调它的 JSON 接口**。

```text
Electron 独立持久 Session（无 preload 模态窗）
  └─ 打开 https://shuiyuan.sjtu.edu.cn/
       └─ 302 → /auth/jaccount
            └─ 302 → jaccount.sjtu.edu.cn/oauth2/authorize（水源自己的 client_id）
                 └─ 用户人工输入 jAccount 账号/密码/验证码（或扫码、短信）
                      └─ 授权回跳 /auth/jaccount/callback
                           └─ Discourse 种会话 cookie（_forum_session / _t）
                                └─ 主进程带 cookie 请求 *.json 端点（只读 GET）
```

与课表接入的异同：

| 维度        | 教学信息服务网（课表）                                | 水源社区                                                         |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| 登录方式    | jAccount（表单/跳转后种 JAAuthCookie）                | jAccount OAuth2 授权码回跳后种 Discourse cookie                  |
| 数据接口    | 页面内的 JSON 端点（`xskbcx_cxXsgrkb.html`），需 POST | 标准 Discourse REST JSON（`GET *.json`），无需解析 HTML          |
| 会话载体    | 教学网 cookie                                         | `_forum_session` + `_t`（remember-me，长效，存活时长待多天验证） |
| 失效表现    | 重定向到登录页 / 非 JSON                              | 预期同左（403 `not_logged_in`），待实测确认                      |
| Dela 侧复用 | 独立 Session、模态登录窗、受控 IPC、失效保留缓存      | 完全同一套模式，无需新的认证抽象                                 |

### 2.1 认证路径边界

| 路径                   | 结论                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 匿名 JSON API          | 全部 403 `not_logged_in`，无公开数据面                                                                                                                                                  |
| 爬虫 UA / RSS          | 均被拦截                                                                                                                                                                                |
| 无头脚本登录           | jAccount 登录页含验证码（另有扫码、短信两种人工方式），脚本化不可行，且不应存储用户密码                                                                                                 |
| Discourse User API Key | **`read` 与 `write` scope 均已验证完整授权流**（2026-09-14 read、2026-09-15 write）：可获签发、解密、请求并撤销；展示名与 scope 均不是当前观测到的白名单条件。站点网页端无 key 管理入口 |

User API Key 是 Discourse 官方为第三方客户端设计的授权机制（功能上类似 OAuth 授权：应用出示 RSA 公钥，用户网页点授权，服务端加密下发 token，之后带 `User-Api-Key` 头调用）。2026-09-13 的一个登录态请求曾返回"抱歉，我们无法发布用户 API 密钥，此功能可能被网站管理员禁用"，当时不能据此完成授权。

2026-09-14 以同一用户已登录会话进行了独立对照：本机新生成 RSA 密钥对、公钥、随机 `client_id` 与 nonce，使用与学校 OpenClaw skill `auth init` 相同的 `scopes=read`、`public_key`、`nonce`，并且**不携带** `auth_redirect`。水源先展示 `application_name=OpenClaw Shuiyuan Skill` 的“读取所有”授权页；随后仅将展示名改为 `Dela`，也展示相同的 Dela 授权页。两次请求均不读取 OpenClaw 配置、不使用他人的 pending 私钥或 URL，证明该授权页至少不绑定某一条既有授权链接、OpenClaw 安装或这两个展示名之一。

同日，使用 Dela 展示名、本机保存 30 分钟的 RSA 私钥状态、同样**不携带** `auth_redirect` 的请求完成了端到端测试：用户在授权页手动确认后，测试脚本成功解密回传 payload、以 `User-Api-Key` 和 `User-Api-Client-Id` 请求 `GET /session/current.json`，再 `POST /user-api-key/revoke` 撤销该临时 key。三步均成功，临时私钥随后删除，未将 key 写入 Dela 或仓库。

这证明了一个已登录水源账号可以为 Dela 完成当前的只读 User API Key 流程；不证明所有账户、未来站点策略或其他 scopes 也会成功。此前失败请求与成功流程最显著的未隔离差异仍是是否携带 `auth_redirect`。

2026-09-15 以与 `read` 完全相同的请求形态请求 `scopes=write`（展示名 `Dela`、不带 `auth_redirect`）：授权页正常渲染，明确列出「写入所有」与警示文案（“请求完全写入权限 — 此应用程序将能够发布、编辑和删除内容”），未出现 2026-09-13 那种“无法发布用户 API 密钥”的禁用错误。用户在页面确认后，站点直接展示密文 payload（带「复制密钥」按钮）。解密得 32 字符 key，`api=4`、`push=false`，nonce 回传匹配。用该 key 实测：`GET /session/current.json` 200 确认身份；`POST /bookmarks`（`bookmarkable_id` + `bookmarkable_type: "Topic"`）200 创建书签；`DELETE /bookmarks/<id>` 200 删除，状态完全回滚；`POST /user-api-key/revoke` 200 后同一请求 403。全程只带 `User-Api-Key` 与 `User-Api-Client-Id` 头，未取 CSRF token。

本次 write 验证的边界：只实测了书签创建/删除两类写操作，发帖、回帖、通知已读等写端点未逐一验证，不能据此宣称全部写接口可用；`read` 验证时已有的账户、未来策略等保留条款同样适用。

**站点侧 key 管理能力缺失（2026-09-15 确认）**：偏好设置 › 安全性页面只显示“最近使用的设备”，没有任何 User API Key 的列表、查看或撤销入口。这意味着 key 一旦签发，用户在水源网页端无法管理——**客户端必须自行持久化 key 并实现 `POST /user-api-key/revoke` 撤销**；若授权后 payload 未被客户端捕获，该 key 将成为无法解密的休眠凭据，且除站点管理员外无人能撤销。

测试遗留：write 测试前的一次授权（用户手动点击确认）因浏览器窗口在提取密文前关闭，payload 丢失。该 write key 成为无法解密、无法经网页撤销的休眠 key；对应 RSA 私钥仅存在于本机临时目录（`/tmp/tmp.spcvQ7g2y6/priv.pem`）、从未外传，密文也从未提交给任何第三方（无 `auth_redirect`），实际风险趋近于零。若用户当时复制过该密文，可解密后立即撤销；否则只能由站点管理员清理或长期休眠。

### 2.2 会话 Cookie 路径的边界

- GET 类端点只依赖 cookie，无需 CSRF。
- 走会话 cookie 的写操作（标记通知已读、收藏等）需要 `X-CSRF-Token`，取自 `GET /session/csrf`（该端点匿名可用，token 与 `_forum_session` 配对）。**User API Key 头路径的写操作不需要 CSRF**（2026-09-15 实测 POST/DELETE 未带 token 即成功），这是它相对 cookie 路径的结构性优势。
- 响应未暴露 `X-RateLimit-*` 头；Discourse 只在触发限流时返回 `Retry-After`，阈值未知。轮询应保持分钟级以上间隔并做退避。

## 3. 登录后可获取的数据（全部为本人会话实测）

2026-09-15 前 9 行以登录 cookie 会话实测；标记 ▲ 的行以 Dela 绑定的 `read` User API Key 重新实测，全部 200。

| 端点                                       | 实测内容                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /session/current.json`                | 当前用户对象（实测 89 个字段）：`username`、`name`、`unread_notifications`、`unread_private_messages`、`admin` 等                                                                      |
| `GET /latest.json`                         | 每页 30 个 topic + `topic_list.more_topics_url` 分页游标；topic 含 `id`、`title`、`category_id`、`posts_count`、`created_at`、`last_posted_at`                                         |
| ▲ `GET /latest.json?page=N`                | 数字页码翻页可用：`page=2` 返回不同于首页的 30 条，`more_topics_url` 指向 `page=3`；page=1 为首页（`more_topics_url` 从 page=0 起算）                                                  |
| `GET /categories.json`                     | 13 个顶级分类及帖子计数：校园生活 13415、广而告之 2199、人生经验 2067、休闲娱乐 1475、社团组织 567、数码科技 522、文化艺术 383、水源活动 69；计数为 0 的应为父分类（推断）             |
| ▲ `GET /categories.json`（字段补充）       | 每分类 45 字段，含 `subcategory_ids`、`topics_day/week/month/year` 趋势计数、`color/emoji/icon`、`read_restricted`——趋势计数可直接做“今日热门分类”                                     |
| ▲ `GET /c/<slug>/<id>.json`                | 分类过滤的主题列表可用（样本 `/c/campus-life/23.json`），30 条/页 + `more_topics_url`，结构与 `latest` 相同                                                                            |
| `GET /search.json?q=数据结构`              | 每页 50 条：`topics[]`（id/标题/时间）+ `posts[].blurb` 正文摘要 + `grouped_search_result.hit_count`；摘要质量足以直接展示                                                             |
| `GET /t/<topic_id>.json`                   | 帖子全文：`title`、`posts_count`（样本 67 楼）、`post_stream.stream`（楼层 id 全量）+ 每楼 `cooked`（消毒后 HTML，首楼样本 4281 字符）、`details.participants`（样本 24 人）           |
| ▲ `GET /t/<id>.json`（字段补充）           | 60 字段/楼；另有 `suggested_topics`（相关主题推荐）、`thumbnails`、`timeline_lookup`、`chunk_size`、`summarizable`/`has_cached_summary`（站点 AI 摘要能力标志）、`message_bus_last_id` |
| `GET /notifications.json?recent=true`      | 15 条通知：`notification_type`（实测出现 {2,5,6,12,14,19}，对应 Discourse 标准枚举，实现时按语义映射）、`read` 状态、触发者与主题引用                                                  |
| `GET /new.json`、`GET /unread.json`        | 新帖流、未读流，各 30 topic/页，结构与 `latest` 相同                                                                                                                                   |
| `GET /u/<username>/bookmarks.json`         | 本人收藏：实测 11 条，含 `topic_id`、`created_at`、可选 `name`                                                                                                                         |
| ▲ `GET /u/<me>/bookmarks.json`（补充）     | 条目含 `excerpt`（正文摘要）、`reminder_at`、`bookmarkable_url`、`tags`、`last_read_post_number`，可直接渲染收藏列表                                                                   |
| ▲ `GET /u/<me>/summary.json`               | 阅读画像：`days_visited` 296、`time_read`、`topics_entered`、`posts_read_count`、`top_categories`、`badges`、`most_liked_by_users`                                                     |
| ▲ `GET /topics/private-messages/<me>.json` | 本人私信列表：实测 8 个会话，`archetype=private_message`，条目为 topic 结构 + `allowed_user_count`、`participants`                                                                     |
| ▲ `GET /u/<me>.json`                       | 完整个人资料（90 字段），含 `email`、`trust_level`、`user_api_keys`、`user_auth_tokens`、`groups`、`user_option`                                                                       |
| ▲ `GET /site.json`                         | 站点结构清单：83 个分类全树（13 顶级 + 子分类）、31 个 groups、`notification_types`/`post_types` 枚举、`top_tags`                                                                      |
| ▲ `GET /about.json`                        | 全站统计（topics/posts/users/likes/chat 的日、7 天、30 天、总量）与版本、管理团队                                                                                                      |
| `GET /session/csrf`                        | 200 + CSRF token（写操作前置）                                                                                                                                                         |

### 3.1 v1 实现前的补充验证（2026-09-15，read key 实测）

| 事项             | 结论                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 精品 tag         | 端点为 `/tag/<中文名>.json`（如 `/tag/精品.json` → 200，30 条/页，结果确实按 tag 过滤）；侧栏的 `11-tag` 形态 slug 不可用于 API（404）                                                |
| `?tag=` 组合过滤 | `latest.json?tag=X` 与 `c/<slug>/<id>.json?tag=X` 均返回**未过滤**结果——组合过滤不可用，类别与标签只能互斥                                                                            |
| tags 字段形态    | 水源的 topic `tags` 元素是对象 `{id, name, slug}` 而非纯字符串，映射需取 `.name`                                                                                                      |
| 分类树           | `categories.json?include_subcategories=true` 不生效（仍只有 13 个顶级）；完整树来自 `site.json`（83 个，70 个带 `parent_category_id`）；`site.json` 另有 `top_tags`（101 个，带计数） |
| `tags.json`      | 280 个 tag，按常用度排序，无计数                                                                                                                                                      |
| 楼层深链         | `/t/<id>/<post_number>.json` 可用（样本返回目标楼前后 20 楼 + 全量 stream）                                                                                                           |
| 楼层分段         | `/t/<id>/posts.json?post_ids[]=<n>` 可用（实测 3 个 id 返回 3 楼）                                                                                                                    |
| 通知已读         | `PUT /notifications/mark-read` 端点存在（read scope 下 403，属权限不足而非不存在）；按 id 形态 404 不存在                                                                             |
| 分页             | 统一跟随响应的 `more_topics_url`（tag 列表形态如 `/tag/精品?match_all_tags=true&page=1&tags[]=精品`，路径加 `.json` 即为下一页）                                                      |

## 4. 对聚合器的数据模型推论

1. **topic 是核心实体**：`id` 稳定唯一，来源链接可由 topic 构造；分类、楼层、通知、收藏都挂接到 topic。
2. **增量策略**：API 无变更游标（与 Canvas 相同），需用 `latest/new/unread` 分页 + `last_posted_at` 对比自行增量；首次全量、之后按页对比即可。
3. **正文复用现有管线**：`cooked` 是服务端消毒的 HTML，与 Canvas 页面、邮件 HTML 同类，可走同一套"清洗 + 无脚本 sandbox iframe"渲染。
4. **分类是天然订阅单元**：13 个顶级分类粒度适中，用户勾选 2–3 个即可构成个性化信息流。
5. **搜索是最高价值入口**：带摘要、命中数、相关性排序，直接支撑"按课程名/教师名找论坛情报"。

## 5. 能做出什么效果（产品设想，非实现承诺）

以下基于第 3、4 节已验证的数据可得性，描述产品形态：

1. **课程情报**（与课表/Canvas 联动，最具 Dela 特色）：以课表课程的课程名、教师名为查询词定期调用 `search.json`，把课程评价、考试经验、资料帖以"标题 + 摘要 + 原文链接"聚进对应课程的工作区，与 Canvas 资料并列成第三类课程资料来源。
2. **通知中心**：回复/提及/私信/徽章汇入首页"有人找你"，与邮箱未读统一呈现；`unread_notifications` 计数可直接驱动角标。
3. **校园信息流**：订阅分类（如校园生活、广而告之）的未读/新帖，按时间线浏览，点开经消毒渲染的帖子全文。
4. **收藏同步**：水源书签进入 Dela 阅读清单，作为可关联进项目的资料来源。
5. **Agent 上下文**：`bbs_search` / `bbs_topic` 作为 Agent 工具，让模型在项目对话中引用论坛经验（如"这门课往年怎么考"）。

对接方式：登录复用课表的独立 Session + 模态窗模式；数据落库走既有来源引用表（平台标识、远端 ID、原文链接、抓取时间）；连接状态展示在设置页。第一版只读，不做发帖/标记类写操作。

## 6. 风险与约束

- **非官方接口**：Discourse 升级可能改变端点行为；管理策略可变（User API Key 被禁即是实例）。同步失败须保留缓存并明示，不静默清空。
- **会话生命周期未长期验证**：`_t` 的实际存活时长、失效的具体表现（重定向 vs 403）需多天使用观察。
- **限流不可见**：阈值未知，轮询保持分钟级以上并退避；避免高频深分页。
- **合规边界**：使用本人会话、只读、数据（社区用户生成内容）仅在本机应用内呈现，不对外分发；遵守规划第 8 节，保留来源与抓取时间。
- 凭据与 cookie 只存在 Electron Session 与 safeStorage，不进 renderer、不进日志。

## 7. 未验证 / 待办

- 会话 cookie 存活时长与失效形态（需多天真实使用观察）；User API Key 的长期有效性同样需多天观察。
- 深分页只验证到 `page=2`；更长翻页、`posts.json?post_ids[]=` 按楼分段加载长帖未逐一实测。
- cookie 会话路径的写操作未测；写能力已由 User API Key `write` scope 覆盖（书签增删已验证），但通知已读、发帖/回帖、私信等具体写端点尚未逐一实测。
- `POST /uploads.json`（Composer 附件上传，multipart：`type=composer` + `files[]`）**未实测**：Dela 回复器已按标准 Discourse 形态接入（2026-09-16），成功响应取 `short_url`（`upload://` 形态，可直接写回 Markdown）；站点若禁用匿名上传路径或调整大小限制，以响应错误暴露（413/403/422 已做语义化映射）。
- 静态媒体在 `login_required` 下对匿名请求同样被拦（2026-09-16 实际观察：楼层图片破图而 CDN 头像正常）。2026-09-18 真实账号诊断确认 User API Key、恢复后的 campus Session、自定义协议及不透明沙箱 iframe 均能完整加载同站 PNG，因此排除被测地址上的认证、CSP 与 sandbox 故障；继续代码审查发现代理前仍有明确的 URL 误杀：协议相对地址（`//host/path`）会被错误拼接，路径相对地址会被丢弃，且主进程枚举 `/uploads/` 等路径会拒绝 Discourse 后续增加的媒体路由。在未取得用户具体失败帖 URL 的情况下，不能断言其图片必属哪一种，但这些分支都会稳定破图。现统一用 URL 标准解析补全 http(s) 地址；同站媒体全部进入固定水源 origin 的代理，安全边界由“固定目标域名 + 响应 MIME 必须为 image/video/audio”承担，不再猜测路径。认证通道由 `getCampusSession()` 恢复同一 Session 并 `fetch({credentials:'include'})`，失败再以 Node `fetch` + User API Key 头回退。
- Dela 侧 User API Key 生命周期管理是硬性要求：站点无网页管理入口，客户端必须持久化 key（safeStorage）并提供撤销（`POST /user-api-key/revoke`）；payload 丢失即产生无法使用的休眠 key，授权窗口的 payload 捕获要做成可靠步骤。
- MessageBus 实时通道（`/message-bus/…`）是否可用于推送式更新；`t/<id>.json` 已返回 `message_bus_last_id`，是接入锚点。
- `summarizable`/`has_cached_summary` 标志表明站点开启了 Discourse AI 摘要；摘要内容的获取端点未测。
- 实际限流阈值与触发后的 `Retry-After` 表现（本次普查 17 个请求顺序执行未触发限流）。
