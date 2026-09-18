# 前端风格一致性审查报告

状态：2026-09-17 完成审查；**本次未改动任何源码**。行号与计数对应当前工作区快照。

范围：`src/renderer` 全部 111 个文件（80 个 `.tsx` 组件、辅助模块与样式）。统计口径为全量 grep 匹配，关键结论已逐条打开文件复核。

## 总体判断

基础纪律执行良好——全库零 `any`、圆角零任意值、z-index 梯度成体系、localStorage 键前缀统一、fire-and-forget 一律 `void` 前缀、组件全部 `function` 声明、日历可点击块带完整键盘支持。

不一致集中在**四类“应当有共享封装但尚未抽取，于是各 feature 复制粘贴各自演化”**的问题，而非格式偏好分歧。下文按严重度分级。

## 判据：项目基准约定

1. 样式：Tailwind CSS v4 + shadcn 式 CSS 变量，语义 token 全部定义在 `styles/globals.css`（`--background`/`--foreground`/`--muted`/`--accent`/`--border`/`--destructive`/`--ring`/`--sidebar*`，日历 `--cal-*`，语法 `--syntax-*`，圆角 `--radius*`，字号缩放 `--font-scale`）。类名合并走 `lib/utils.ts` 的 `cn()`。
2. 组织：`features/<域名>/` + `index.ts` barrel；组件 `PascalCase.tsx`，非组件模块 kebab-case。`components/ui/` 为 shadcn 生成件（kebab-case，不计为偏差）。
3. 代码：状态用 `useState`，跨模块用 zustand；错误经 `errorText()` 转文案；`import { type X }` 内联类型修饰；注释与 UI 文案中文；数字用 `_` 分隔。

---

## 一、系统性漂移（影响面大，建议优先）

### 1. 字号任意值形成“影子字号档”：70 处、24 个文件

`text-[13px]`×34、`text-[11px]`×26、`text-[15px]`×6（另有 10px / 9px / 21px 各 1-2 处）。分布集中在 mail、shuiyuan、timetable：`shuiyuan/TopicReader.tsx` 11 处、`timetable/WeekCalendar.tsx` 6 处、`shuiyuan/ReplyComposer.tsx` 6 处、`mail/MailReader.tsx` 6 处。

`styles/globals.css:207-208` 的注释已自认这是“已知不缩放范围”：`text-*` 档位工具类跟随字号设置缩放，任意值写法不跟随。**影响**：用户在设置中调整字号时，上述三个模块的正文不缩放。

### 2. `projects/workspace.ts` 是事实上的全局 store，却私有于 projects

被 **21 个文件**深路径引用，覆盖所有 feature 与 components 层：

- `components/AppShell/AppShell.tsx:29`：components 基础层反向依赖 feature 内部模块
- `features/shuiyuan/store.ts:13`：一个 feature 的 store 依赖另一个 feature 的 store
- `features/chat/use-chat.ts:3`、`features/settings/LlmSection.tsx:16`、`features/sources/SourceList.tsx:10` 等

连带后果是 barrel 形同虚设：7 个 feature 的 `index.ts` 只导出 View 组件，而实际消费大量走深路径。`App.tsx` 自身对同一 feature 混用两种导入（`:1` 深路径 `mail/compose-close` vs `:6` barrel `mail`；`:12` vs `:15` 同此 pattern）。**sources ↔ projects 已构成双向环**：`features/sources/SourcesView.tsx:1` 导入 `../projects/ProjectView`，而 `features/projects/ProjectView.tsx:36` 反向导入 `../sources/SourceList`。

### 3. `window.dela` 可选性处理三流派并存

可选链 `window.dela?.` 43 处 / 守卫 `if (!window.dela)` 约 36 处 / 非空断言 `window.dela!` 25 处。

最明显的自相矛盾在 `App.tsx:382-395`：同一表达式先 `window.dela?.notifications &&` 判断，紧接着写 `window.dela!.notifications`（382/386/390/394 连排四处）；同文件 `:126` 又用可选链。`MailView.tsx:88` 顶部已守卫 `if (!window.dela) return <MailUnavailable />`，`:105` 子组件却又 `const dela = window.dela!`。需要确立单一规范（如“组件顶层守卫一次，内部直接用”）。

### 4. 错误转文案三种写法

`errorText()`（定义于 `features/projects/workspace.ts:35`，负责清洗 `Error invoking remote method '...'` 的 IPC 前缀）约 44 处，但存在两类旁路：

- 手写 `reason instanceof Error ? reason.message : String(reason)` 10 处：`MailView.tsx:372,499,644`、`MailComposer.tsx:223,411,518`、`TimetableView.tsx:81,104,280,371`、`GlobalSearchDialog.tsx:177`
- 裸 `String(reason)` 10 处：`MailView.tsx:171,185,231,515,541,556,771`、`MailComposer.tsx:238`、`PdfReader.tsx:67`、`TimetableView.tsx:111`

`TimetableView.tsx` 同文件内两派混写（81/104 行用 instanceof 展开，111 行用 `String()`）。**影响**：timetable / mail / search 的错误提示可能向用户暴露带 IPC 前缀的原始错误串。

另有 `.catch(() => {})` 静默吞错 10 处 / 7 文件（如 `MailView.tsx:727` 的 `syncNow()`，同步失败用户完全无感知）。`App.tsx:150-158` 的启动兜底属可辩护用法。

### 5. 日期格式化 4+ 份平行实现，3 个同名 `formatTime` 语义互不相同

| 实现                                        | 规则                                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| `mail/mail-format.ts:4-14`                  | 今天→`HH:MM`；同年→`X 月 X 日`（带空格）；跨年→`Y/M/D` |
| `shuiyuan/shuiyuan-format.ts:29-41`         | 今天/昨天前缀 + `X月X日`（无空格）；跨年→`X年X月X日`   |
| `chat/ChatSessions.tsx:10-19`               | 唯一使用 `toLocaleTimeString/DateString` 的实现        |
| `notifications/NotificationsView.tsx:34-44` | 唯一相对时间实现（刚刚 / X 分钟前 / …）                |

配套重复：HH:MM 手写 padStart 3 份（`mail-format.ts:7`、`shuiyuan-format.ts:33`、`timetable-format.ts:79,90`）；星期数组 2 套（`mail-format.ts:19` vs `timetable-format.ts:6`）；`X月X日` 表达式在 `shuiyuan-format.ts:39` 与 `timetable-format.ts:252` 逐字相同；`MailView.tsx:757` 是唯一无 locale 参数的裸 `toLocaleString()`。

### 6. 弹窗无统一封装，且 timetable 内部自我分裂

`components/ui/` 没有 `dialog.tsx`，12 个文件各自 `import { Dialog } from 'radix-ui'` 手写 Overlay 类名，且遮罩样式已分化：`ChatThread.tsx:542` 用 `bg-black/40`（其余为 `/30`），`EventDetailDialog.tsx:64`、`AboutSection.tsx:73` 带 `backdrop-blur-[2px]` 而其余不带，退出动画有的有有的无。

更明显的是 `timetable` 模块内部：`EventDetailDialog.tsx:62` 用 Radix，而 `NewEventDialog.tsx:56`、`SemesterStartDialog.tsx:38` 是手写 `fixed inset-0` 遮罩 div——**无焦点陷阱**，Tab 会漏到底层界面，关闭后焦点不回归触发元素。

危险操作确认三档并存：

1. `window.confirm` 原生弹窗 4 处：`MailView.tsx:531,546,765`、`ProjectDocument.tsx:250`
2. 内联二次确认 3 处：`EventDetailDialog.tsx:132-164`、`LlmSection.tsx:137-155`、`ConnectionsSection.tsx:77-93`
3. 直接删除不确认 2 处：`ChatSessions.tsx:74-81`、`MailComposer.tsx:714-717`

**影响**：删除课表事件是内联确认、删除邮件是系统原生弹窗、删除对话毫无拦截——风险礼仪与操作破坏性倒挂。同一“丢弃草稿”场景存在两种确认方式（`compose-close.ts` 的 `leaveComposer` 守卫 vs `MailView.tsx:765` 的 `window.confirm`）。

---

## 二、中等漂移（可感知）

1. **图标按钮三种写法**：`Button size="icon-sm" variant="ghost"`（`EventDetailDialog.tsx:76`、`GlobalSearchDialog.tsx:271`）/ 手写 `size-8 hover:bg-accent`（`AddToProjectDialog.tsx:83-89`、`AppShell.tsx:497-502`）/ mail 系手写 `size-7 hover:bg-muted`（`MailComposer.tsx:546-549`、`MailTrashList.tsx:110-123`）。悬停色相与 28/32px 尺寸混杂。悬停提示本身也是双体系：Tooltip 仅 4 个文件使用，其余 59 处用原生 `title`。
2. **加载态方言**：小字“加载中…”（`MailMessageList.tsx:76`、`TopicFeed.tsx:86`）vs 居中“正在获取…”（`NotificationsView.tsx:202`、`TimetableView.tsx:162`）两套量级，全库无骨架屏。`ChatSessions.tsx:108-121` 加载失败仅 `console.error`，既无 loading 也无错误提示。chat 用 `motion-safe:animate-spin` 3 处，其余 14 处为普通 `animate-spin`——开启“减弱动态效果”时只有 chat 的转圈会停。
3. **选中/激活态四种做法**：`bg-accent`（`MailFolders.tsx:119-121`、`explorer.tsx:209-212`）/ `bg-muted`（`MailMessageList.tsx:88`）/ 特制卡片或胶囊 tab（`SettingsNav.tsx:37`、`ShuiyuanHeader.tsx:117-138`）/ 仅变字重无背景（`ChatSessions.tsx:58-64`）。同一 `MailView` 界面内左栏用 `bg-accent`、中栏用 `bg-muted`。
4. **onboarding 绕过语义 token**：`CampusStep.tsx:43`、`CanvasStep.tsx:82`、`ShuiyuanStep.tsx:102`、`MailStep.tsx:78`、`LlmStep.tsx:259` 硬编码 `text-red-600`，`LlmStep.tsx:213` 另有 `text-emerald-600`（已 grep 核实 6 处）。暗色主题下不跟随 token；与 globals.css 专门为 onboarding 提供 `--onboarding-accent` 的做法不一致。
5. **组件层数据加载样板零抽取**：全项目仅 1 个自定义 hook（`chat/use-chat.ts`）；`let active = true` 防竞态 flag 手写 7 处（`App.tsx:76`、`AppShell.tsx:108`、`use-chat.ts:25`、`MailView.tsx:387`、`ProjectDocument.tsx:91`、`SourceRefCard.tsx:28`、`ConnectionsSection.tsx:52`）；27 个文件持有 37 个 error state；timetable 三个对话框是完全同构的“提交-错误”样板；matchMedia 断点订阅在 4 个文件逐字重复（`AppShell.tsx:204-208`、`MailView.tsx:139-143`、`ProjectView.tsx:142-146,150-154`、`TopicReader.tsx:29-33`）。
6. **窄屏阈值体系混乱**：767px（`AppShell.tsx:204,219`、`MailView.tsx:139,246`）、768px（`ProjectView.tsx:142`）、1024px（`ProjectView.tsx:97,150`、`TopicReader.tsx:29,31`）全部内联字面量，而未定义在 `MailView.tsx:38-39` 的 `STACKED_THRESHOLD = 760` 却做了常量提取——同语义既有两个值又有提取/内联两种做法。

---

## 三、轻微漂移

1. **Props 类型命名**：mail feature 5 个文件用裸 `type Props`（`MailMessageList.tsx:7`、`MailComposer.tsx:26`、`MailFolders.tsx:147`、`MailReader.tsx:10`、`MailTrashList.tsx:6`），其余 19 处均为 `XxxProps` 后缀（同 feature 的 `MailView.tsx:60` 就是），另有 `MailConfigureForm.tsx:5` 的缩写 `ConfigureFormProps`。
2. **kebab-case 文件装组件**：`onboarding/onboarding-window-bar.tsx:9`、`onboarding/steps/step-controls.tsx:30,64,68,72`（4 个导出组件）、`onboarding/steps/step-guide.tsx:12`。全库仅此 3 个文件违反命名基准。
3. **store 模块三种命名哲学**：`shuiyuan/store.ts`（通用名）、`projects/workspace.ts`（领域名）、`chat/drafts.ts`（第三种，且 hook `useChatDrafts` 定义在此，与唯一 hook 文件 `use-chat.ts` 分离）。
4. **冗余与手抄**：`border-border` 21 处属冗余（globals.css:251-253 已设默认边框色，裸 `border` 118 处才是主流），mail 另有自成一套的 `border-border/70` 半透明方言 7 处；`focus-visible:ring-[3px]` 在 10 个文件手抄 13 处；`max-w-[760px]`（MailReader/MailComposer/SettingsView）、`max-w-[480px]`×3、`max-w-[400px]`×3 跨文件重复。
5. **z-index 唯一例外**：`onboarding/CompletionOverlay.tsx:34` 的 `z-[60]`，动机可查但无档位（其余 10/20/30/40/50 梯度体系清晰）。
6. **英文注释 8 条**：集中在 `PdfReader.tsx:17,19,58,76,116`（5 条），另有 `compose-close.ts:1`、`MailComposer.tsx:171`、`ChatComposer.tsx` 各 1 条。测试文件也是中文注释，无豁免场景。
7. **type 导入两风格对半**：`import type {}` 整块 43 条语句 vs 内联 `import { type X }` 35 处；基准约定为后者。
8. **import 顺序例外**：`App.tsx:1` 相对导入 `./features/mail/compose-close` 排在 react、framer-motion 之前；`MailView.tsx:1-5` 分组完全打散。其余 54 个文件为 react-first 主流。
9. **样式微差**：弹层时长 150ms（Radix 系）vs 200ms（timetable 手写）两族；遮罩 `bg-black/30` 15 处 vs `/40` 2 处；`backdrop-blur-[2px]` 4 处与 `[1px]` 1 处散布。`WeekCalendar.tsx:150` 的 `bg-red-500` 是全库唯一使用 Tailwind 调色板的语义外颜色（当前时间指示点）。
10. **onboarding 文案**：`settings/AboutSection.tsx:43` 的 `<span>Author</span>` 是唯一未汉化的 UI 标签（`:41-42` 的英文品牌标语属品牌文案，可保留）。

---

## 四、已确认良好（无需处理）

- **类型纪律**：`: any`/`as any`/`any[]` 在 107 个文件中 0 处；`unknown` 入口统一（`drafts.ts:16`、`workspace.ts:35`、`PdfReader.tsx:104`）。
- **圆角**：零 `rounded-[Npx]`，全部落在 `--radius-*` 档位（`rounded-md` 84 处为主导）。
- **内联 style**：仅 9 个文件使用，全部服务于运行时数值（`WeekCalendar.tsx:96` 按分钟定位、`TopicView` 面板宽、`NewEventDialog.tsx:152` 引用 `var(--cal-*)`），无一藏硬编码颜色。
- **主题适配**：写死白色均有“恒亮”设计背书——onboarding 恒亮（globals.css:51-53 注释 + `--onboarding-accent`）、邮件正文保真（`MailHtmlBody.tsx:71` + `mail-html-display.ts` 的 `color-scheme:light`）、`AppearanceSection.tsx:20-23` 主题预览色块。未发现暗色下会破相的硬编码。
- **硬编码色**：hex 仅 4 处且均为外部品牌/平台色（`AppShell.tsx:145` 与 `onboarding-window-bar.tsx:29` 的 Windows 关闭键 `#e81123`、`AboutSection.tsx:14-15` 的微信/支付宝色）。
- **无障碍**：`role="alert"` 41 处覆盖广泛；`aria-label` 166 处；日历可点击块均为 `role="button"` + `tabIndex` + Enter/Space 处理（`WeekCalendar.tsx:215-235,360-380`、`MonthCalendar.tsx:131`），几乎无裸 `<div onClick>`。
- **键盘与表单**：16 处弹窗表单统一用原生 `<form onSubmit>`；IME 防护统一（`ChatComposer.tsx:177,193-207` 双保险、`GlobalSearchDialog.tsx:213`）。
- **localStorage**：13 个键全部 `dela.` 前缀 + dot 分层，无裸键。仅段内 kebab 与 camel 混用（`dela.font-scale` vs `dela.workspace.agentOpen`），影响极小。
- **动画分工**：tw-animate-css 管 Radix data-state、`animate-spin` 管加载、framer-motion 管编排，边界清晰；`MotionConfig reducedMotion="user"` 全局生效。
- **常量与 promise**：模块级 SCREAMING_CASE 体系成型；fire-and-forget 一律 `void`，未发现裸浮动 promise。

---

## 五、建议整改优先级

| 优先级 | 事项                                                         | 理由                                       |
| ------ | ------------------------------------------------------------ | ------------------------------------------ |
| 1      | 字号档 token 化（在 `@theme inline` 补 `--text-2xs` 等）     | 直接修复用户可见的“设置字号无效”           |
| 2      | `workspace.ts` 升为共享模块，补齐或收缩 barrel               | 消除 21 处深路径与 sources↔projects 依赖环 |
| 3      | 抽 `ui/dialog.tsx` 封装 + 统一危险操作确认模式               | 消除最大的 UX 感知差异与焦点陷阱缺陷       |
| 4      | 统一 `window.dela` 处理、`errorText()`、日期格式化各一种写法 | 高频代码级分裂点，收拢成本低               |
| 5      | 图标按钮 / 加载态 / 选中态对齐到 ui 基类                     | 渐进收拢，可随功能迭代顺带处理             |

## 六、待确认（未定为缺陷）

- `features/home/HomeView.tsx:18` 的 `GREETING_INTERVAL_MS = 2000000`：注释写“闲置态轮播”，2,000,000ms ≈ 33 分钟。若原意为 20 秒（`20_000`）则属笔误；若确为低频轮换则是风格问题（违反项目 `60_000` 数字下划线约定）。**请确认设计意图**。
- `MailView.tsx:727` 的 `.catch(() => {})`：同步失败静默是否需要给用户可见反馈，取决于产品取舍。

## 附：本次审查的边界

- 仅做静态阅读与 grep 统计，未运行应用、未做视觉验收；涉及“用户可感知”的判断基于代码推断，未经截图验证。
- 仅覆盖 `src/renderer`；`src/main`、`src/preload`、`src/shared` 未在范围内。
- 所有 file:line 依据当前工作区（含未提交改动：`AppShell.tsx`、`ChatThread.tsx`、`ToolTimeline.tsx`、`README.md`、`docs/technical-plan.md`、`scripts/chat-smoke.cjs`）。
