# 开发记录

按日期记录 Dela 的功能演进、关键设计裁决与验证边界。本文是[技术规划书](technical-plan.md)的过程侧补充：规划书描述"是什么、为什么"，本文记录"何时做了什么、验证到什么程度"。

约定：

- 每节区分**已验证**（真实环境/自动化确认）与**待验证**（仅在脱敏桩或推理层面确认），不把占位结果当作完成。
- 2026-09-18 文档精简时，此前的长篇记录收敛为要点；逐条实现细节可在 git 历史中查回。
- 冒烟脚本（`smoke` / `smoke:workspace` / `smoke:pdf` / `smoke:shuiyuan` / `mail-smoke` / `chat-smoke`）的含义见[开发指南](development.md)。

---

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
