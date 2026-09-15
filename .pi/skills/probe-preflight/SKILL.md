---
name: probe-preflight
description: Dela 探针测试的强制前置门。在编写或运行任何探针/视觉验收/冒烟脚本（CDP 截图驱动、临时 .mjs/.cjs/Electron 驱动、UI 验证脚本）之前必须调用。触发词包括：探针、视觉验收、截图验证、CDP、写个脚本验证一下 UI、smoke、probe。它强制在启动前把探针文件写"对"——语法、IPC 签名、zod 载荷格式、UI 前置状态、清理计划逐项过闸；任一项过不了就不得启动测试。
---

# 探针测试强制前置门（probe-preflight）

## 为什么存在

Dela 的探针测试反复出现同一类失败：脚本写完直接启动，然后连跑 3–4 轮才通，每一轮的失败原因（zod 拒绝载荷、找错 UI 状态、模板字符串拼错）**全部可以在启动前从仓库源码推出来**。本门禁把这些"可预知"的检查固化成启动前的硬性动作。

**规则：门禁六项全部通过才允许启动探针。任何一项过不了，先修认识或修脚本；修不了就放弃这次探针，不得"先跑跑看"。**

## 门禁（启动前逐项打勾）

### G1 语法自检——`node --check` 必须先过

```bash
node --check scripts/<探针名>.mjs
```

动态生成 `Runtime.evaluate` 表达式时最易产生嵌套模板字符串错误（变量插值写错、`.replace()` 补丁式拼串）。**禁止**用「模板字符串套模板字符串再 replace」的方式构造表达式；只允许用 `${JSON.stringify(值)}` 做安全插值（见下方模板）。`node --check` 通过是第一道闸，不过就不许继续。

### G2 IPC 签名核对——每个 `window.dela.*` 调用对照 `src/shared/api.ts`

打开 `src/shared/api.ts`，逐一核对探针用到的每个方法：方法名、参数个数、参数类型、返回值形态。preload 暴露的形态以 `src/preload/index.ts` 为准。**签名靠记忆写 = 必错**，本历史中 `deleteEvent(id: number)` 被想当然写成 string 就是此类。

### G3 载荷格式核对——每个字面量对照主进程 zod schema

打开载荷对应的 `src/main/<领域>/api.ts` schema，核对：

- **日期时间**：`z.string().datetime()` 只接受 UTC（`Z` 后缀）。本地时间字符串必须经 `new Date(text).toISOString()` 转换，直接写 `'2026-09-12T22:00:00'` 会被拒。
- **枚举**：抄录 schema 里的合法值列表再用。事件颜色是 `rose/peach/sand/sage/teal/blue/lilac/slate`——凭印象写 `'sky'` 必错。
- **optional ≠ null**：`z.enum(...).optional()` 拒绝显式 `null`。不传就删掉该键，不要写 `color: null`。
- 其他易错点：方法副作用与返回值（如 `llm.save()` **不会**自动设 active，须用返回的 `id` 再调 `llm.setActive(id)`）。

### G4 UI 前置状态核对——目标元素由哪个"门"控制

截图/点击前，在**源码里**确认目标元素的渲染条件，写出「门 → 满足方式」清单。已知的门：

| 想看的东西 | 渲染条件 | 探针满足方式 |
| --- | --- | --- |
| 首页问候语 | `chat && !chat.configured` 为假（未配置模型时显示密钥表单，**不显示问候语**） | 配置模型；或纯浏览器预览（无 preload 时 chat 为 null） |
| composer 模型触发器 | `configured` 为真 | 必须有 active 提供商 |
| 课表周/月网格 | `!connected && lessons.length === 0` 时显示连接引导卡 | 向隔离档案注入缓存课程（sqlite 种子） |
| 课表日期/事件 | `semesterStart` 有值 | `setSemesterStart` 或 sqlite 种子 |

当前元素的渲染条件以源码为准，上表只是已知门的位置索引。

### G5 断言不盲发——每次 click/evaluate 的返回都要落日志

- `clickButton` 一律返回并记录 `'clicked' / 'not-found'`；导航点击后 sleep + 重查 DOM，不做任何无返回值的"顺手一点"。
- 查询元素前先读源码确认选择器（tooltip 是 `[role=tooltip]`，radix 浮层容器是 `[data-radix-popper-content-wrapper]`）。
- 鼠标事件坐标必须来自 `getBoundingClientRect()`（经 `Runtime.evaluate` 查询），不能凭截图估算。
- `location.reload()` 后导航状态回到默认，需要重新点击目标页；React 数据异步加载，查询前 sleep。

### G6 清理计划——探针不留痕

- 启动前写明：临时 profile 用 `mkdtempSync(join(tmpdir(), 'dela-<名>-'))` 创建，结束时 `rmSync` 删除。
- 探针脚本放 `scripts/` 之外或验收后即删：`pnpm check` 的 prettier 和 oxlint 会扫描 `scripts/`，临时文件会把正式检查打红（真实发生过）。
- 隔离 userData 是铁律：真实档案数据一律不碰；要在隔离档案造数据，直接对 `dela.db` 播种（参考 `references/pitfalls.md` 的 ABI 注意事项）。

## 工作流

1. **先写断言清单**（看什么、点哪、期望什么选择器/文本），再写代码。
2. **选既有模式**，不要发明新结构——读 `references/pitfalls.md` 的模式索引。
3. 写脚本（从 `assets/probe-template.mjs` 起步）。
4. 过门禁 G1→G6，逐项留证（命令输出）。
5. 启动，收日志与截图。
6. 清理（杀进程、删 profile、删临时脚本），确认 `pnpm format:check` 不受影响。

## 环境限制（预先知道，不要撞了才发现）

- **瞬态 userData 中 os_crypt/safeStorage 密钥往返不稳定**：`configured` 状态在探针环境不可靠（技术规划已记录）。不要把断言建立在"隔离环境里加密配置成功解密"上；该链路交给真实环境人工确认。
- **被遮挡窗口 rAF 节流**：截图前必须泵帧（连续 `Page.captureScreenshot` + sleep），否则 framer-motion 过渡停在中间帧。
- **better-sqlite3 有 Electron ABI**：不要用系统 Node 直接开 `dela.db`；要么再起一个一次性 Electron 进程播种，要么走 `window.dela` IPC。
