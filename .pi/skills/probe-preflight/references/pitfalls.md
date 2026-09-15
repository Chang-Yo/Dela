# 踩坑目录与既有模式索引

历史失败全部来自真实探针轮次；模式索引指向仓库内已验证的脚本。仓库源码始终是事实来源，本目录只负责"让你想起去查"。

## 真实失败目录（每条都实际发生过）

| # | 失败 | 根因 | 正确做法 |
| --- | --- | --- | --- |
| 1 | evaluate 表达式语法错误 | 嵌套模板字符串拼表达式，还用 `.replace()` 打补丁 | 纯字符串 + `${JSON.stringify(v)}` 插值；`node --check` 过闸 |
| 2 | `timetable:create-event` 被 zod 拒绝 | `'2026-09-12T22:00:00'` 缺 UTC `Z`（`z.string().datetime()` 默认只收 Z） | `new Date(text).toISOString()` |
| 3 | 事件颜色被拒 | 写了 `'sky'`；合法枚举是 rose/peach/sand/sage/teal/blue/lilac/slate | 从 `src/main/timetable/api.ts` 抄枚举 |
| 4 | `color: null` 被拒 | `.optional()` 拒绝显式 null，null ≠ undefined | 不传该键 |
| 5 | 问候语截图拿到的是密钥表单 | `chat && !chat.configured` 时渲染 ModelKeyForm，问候语根本不渲染 | 先查渲染条件（G4 表） |
| 6 | `configured` 一直是 false | `llm.save()` 不设 active；须 `setActive(返回的 id)` | 读方法语义，别猜副作用 |
| 7 | 模型触发按钮找不到 | 按 `'deepseek'` 文本找按钮，但 active 的是另一个提供商 | 先 `getChat().model` 拿真值再定位 |
| 8 | 课表页只有连接引导卡 | `!connected && lessons.length === 0` 时渲染引导卡而非网格 | sqlite 种子注入缓存课程（G4 表） |
| 9 | 种子脚本 ABI 崩 | 系统 Node 加载 better-sqlite3（按 Electron ABI 编译） | 一次性 Electron 进程播种 |
| 10 | `pnpm check` 被临时探针打红 | prettier/oxlint 扫 `scripts/`，临时文件留在仓库里 | 验收后即删或放仓库外（G6） |
| 11 | 截图是过渡中间帧 | 被遮挡窗口 rAF 节流，framer-motion 停在半路 | 泵帧：连续 `Page.captureScreenshot` + sleep |
| 12 | reload 后元素找不到 | 导航状态回默认 + React 数据异步加载 | reload 后重新点导航、sleep、再查 DOM |

## 环境级已知限制

- **os_crypt 不稳定**：瞬态 userData 里 safeStorage 加密往返不可靠，`configured` 状态不可信（技术规划 2026-09-14 记录）。探针避开该断言。
- **浏览器预览无 preload**：`window.dela` 为 undefined。适合验证纯布局（问候语在 chat=null 时可见），不适合任何依赖数据/配置态的断言。
- **真实档案不可触碰**：需要数据就用隔离档案播种；需要在真实环境确认的（如加密链路），明说"待真实环境人工确认"，不要拿探针结果宣称。

## 既有模式索引（优先复用，不要重新发明）

| 任务 | 模板 | 要点 |
| --- | --- | --- |
| 业务/IPC 探针 | `scripts/workspace-smoke.mjs` + `.ts` | TS 入口经 vite 打进 `.tools/`，`spawnSync(require('electron'), [.tools/xxx.cjs])`；`globalThis.fetch` 打桩；`assert` 断言；隔离 profile |
| 渲染器假 IPC 驱动 | `scripts/mail-smoke.cjs` | ipcMain.handle 路由表打桩，驱动真实 renderer；`app.setPath('userData', ...)` |
| 协议/文件类探针 | `scripts/pdf-smoke.cjs` | `registerSchemesAsPrivileged` + 合成 fixture（如手拼 PDF、稀疏文件） |
| CDP 截图验收 | `scripts/capture-preview.mjs` | `/json/list` 找 page target、`Emulation.setDeviceMetricsOverride`、泵帧后 `Page.captureScreenshot` |
| 隔离实例视觉验收 | `assets/probe-template.mjs`（本 skill） | 一次性入口 cjs `app.setPath` + require 真实 bundle；CDP 驱动与截图；交互（hover/click/两步确认删除）全覆盖 |

## 播种隔离档案速查

- DB 路径：`<userData>/dela.db`；`timetable_lessons.week_numbers` 是 JSON 数组字符串。
- 断连时想渲染周网格：`timetable_lessons` 有行即可（`!connected && lessons.length === 0` 才显示引导卡）；`timetable_sync.semester_start` 控制日期与事件可见性。
- 事件时间在 DB 中存 ISO（Z 后缀）；zod 入口同 #2。
