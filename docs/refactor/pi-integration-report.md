# Pi Agent Core 最小接入验证报告

日期：2026-09-29。状态：阶段一交付；验证范围限于本地 mock OpenAI 兼容服务的协议路径，真实提供商实测待用户执行。

本文落实 [Agent 与工作区重构计划](../agent-workspace-plan.md) §5.1 的「最小接入验证」：安装精确版本依赖、以本地 mock SSE 服务实测 Pi Agent 的关键路径、给出能否替换 `src/main/agent/loop.ts` 的结论。探针代码原在 `src/main/agent/pi-probe/`（不接入应用入口；2026-09-30 起有用断言已并入 `src/main/agent/core/test/pi-runtime.test.ts`，探针目录不再存在；报告所列 `pi-session-backend-sqlite-node` 依赖已按 [decisions-phase1.md](decisions-phase1.md) 总裁决 2 移除）。

标注约定：**【实测】** 为本报告探针运行得出的结论；**【代码核查】** 为阅读安装后 `.d.ts`/实现得出的结论；**【待验证】** 为无法在 mock 层确认、留给真实服务或后续阶段的项。

## 1. 依赖与版本

### 1.1 直接依赖（均为精确版本，无 `^` 前缀）

| 包                                               | 版本   | 用途                                                | 备注                                                                                                                                                            |
| ------------------------------------------------ | ------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@earendil-works/pi-agent-core`                  | 0.87.1 | Agent 循环、事件、工具调度、会话模型                | 计划指定                                                                                                                                                        |
| `@earendil-works/pi-ai`                          | 0.87.1 | `Model` 类型、OpenAI 兼容流式适配器、TypeBox 转出口 | **计划未列出、验证中追加**：自定义 OpenAI 兼容 provider 必须引用其 `api/openai-completions` 的 `streamSimple` 与 `Model`/`Type`；pi-agent-core 未转出口这些符号 |
| `@earendil-works/pi-session-backend-sqlite-node` | 0.87.1 | SQLite 会话后端                                     | 计划指定                                                                                                                                                        |

### 1.2 传递依赖注意点【代码核查】

- `openai@6.40.0`（pi-ai 依赖）：openai-completions 适配器内部经官方 SDK 走 `fetch`，请求装配（SSE 解析、错误分类）由 SDK 承担；pi 传 `maxRetries: 0` 并用自己的可中断退避包一层。
- `typebox@1.3.27`（pi-ai 依赖）：工具参数 schema。Dela **无需新增直接依赖**——`Type` 与 `TSchema` 经 `@earendil-works/pi-ai` 转出口（探针 `pi-runtime.ts` 即如此使用）。
- `@google/genai@2.21.0`、`@anthropic-ai/sdk`、`@aws-sdk/*` 等：pi-ai 的其他提供商 SDK，OpenAI 兼容路径用不到，但会进入 `node_modules`（见 §5 打包注意）。
- `@earendil-works/chord`、`@earendil-works/pi-telemetry`：agent-core 的运行时依赖（执行环境抽象/遥测）。

### 1.3 安装过程的问题与处置【实测】

1. **pnpm 12 `allowBuilds` 阻断**：`pnpm add` 因 pi 传递依赖带安装脚本而报 `ERR_PNPM_IGNORED_BUILDS` 中途失败，且在 `pnpm-workspace.yaml` 留下 `set this to true or false` 占位。处置：三个包（`@google/genai`、`esbuild`、`protobufjs`）显式记为 `false`（不运行其安装脚本）：esbuild 二进制来自 `@esbuild/win32-x64` optional 依赖，其余 postinstall 只做生成物校验，跳过不影响 OpenAI 兼容路径。仓库原有 `better-sqlite3: false`、`electron-winstaller: false` 保持不变。
2. **pi-ai 断链**：先装 agent-core+backend、后补 pi-ai 时，锁文件出现「裸 `pi-ai@0.87.1` + 对等后缀 `pi-ai@0.87.1(supports-color…)`」两个实例，pnpm 只落盘了后者，根 `node_modules/@earendil-works/pi-ai` 成为悬空链接（`pnpm install --force`、删 `node_modules` 重装均复现）。**`pnpm dedupe` 把两实例合并为对等后缀实例后修复**。后续升级/增删 pi 系依赖时若再遇 `Cannot find package '@earendil-works/pi-ai'`，先跑 `pnpm dedupe`。
3. **Electron 兼容**：`node:sqlite`（会话后端默认驱动）在 Node 24.21.0 与 Electron 44.3.0（内嵌 Node 24.20.0，`ELECTRON_RUN_AS_NODE` 验证）均可用。【待验证】Electron 主进程真实运行环境（含 asar 打包后路径解析）留待集成阶段 `pnpm smoke` 确认。

## 2. 真实 API 摸底（以 .d.ts 为准）

### 2.1 Agent

- 构造：`new Agent({ initialState, streamFn, getApiKey?, transformContext?, convertToLlm?, beforeToolCall?, afterToolCall?, finishTurn?, prepareRequest?, … })`。`streamFn` 必填（或经 `setDefaultStreamFn` 全局注入）。
- `initialState`：`Partial<Omit<AgentState, 运行时字段>>`——`systemPrompt`、`model`、`thinkingLevel`、`tools`、`messages`。首条 system 消息由 Pi 生成并承载工具声明（`toolsAdded`），**systemPrompt 与 tools 不走 `context.systemPrompt`/`context.tools`，而是编码进 transcript 的 system 消息**。
- `prompt(input: string, images?: ImageContent[])` / `prompt(messages)`；`continue()`；`steer()`/`followUp()`（运行中插话与追发）；`abort()`；`waitForIdle()`；`state`（messages/tools/thinkingLevel/streamingMessage/pendingToolCalls/errorMessage/isStreaming）。
- `StreamFn` 契约：**不得抛异常**，请求/模型/运行时失败一律编码为返回流中的 `error` 事件 + `stopReason: "error" | "aborted"` 的 AssistantMessage。`Models.streamSimple` 满足该签名。

### 2.2 自定义 OpenAI 兼容 provider（Dela 场景）

**【代码核查 + 实测】不需要 `createProvider`/`Models` 集合**。两条路即可：

```ts
const model: Model<'openai-completions'> = {
  id, name, api: 'openai-completions', provider, baseUrl,   // {baseUrl}/chat/completions
  reasoning, input: ['text', 'image'], cost: {…}, contextWindow, maxTokens,
  compat?: OpenAICompletionsCompat,                          // 覆盖自动检测
};
const streamFn: StreamFn = (model, context, options) =>
  openAiCompletionsStreamSimple(model as Model<'openai-completions'>, context, options as SimpleStreamOptions);
new Agent({ initialState: { model, … }, streamFn, getApiKey: () => provider.apiKey });
```

- **apiKey 注入**：`Agent.getApiKey(provider)` 每次请求前解析，经 `options.apiKey` 传给流式函数 → OpenAI SDK `Authorization: Bearer`（实测通过）。适合从 Dela 加密存储按次取密钥。
- **compat 自动检测**：按 `provider` id 与 `baseUrl` 关键字识别 DeepSeek/zai/OpenRouter/together 等；未知 baseUrl 走 OpenAI 默认（`max_completion_tokens`、`reasoning_effort` 支持、`store:false`、`stream_options.include_usage`）。Dela 可在 `Model.compat` 里按提供商逐项覆盖（如 `maxTokensField`、`thinkingFormat`、`supportsReasoningEffort`）。
- **推理档位映射**：`Agent.state.thinkingLevel`（off/minimal/low/medium/high/xhigh/max）→ `streamSimple(reasoning)` → `reasoning_effort`（可经 `model.thinkingLevelMap` 重映射到提供商档位）。DeepSeek 风格会同时发 `thinking: {type: 'enabled'}`（实测）。

### 2.3 事件流

- Agent 事件（`subscribe`）：`agent_start/end`、`turn_start/end`、`message_start/update/end`（`message_update` 附底层 `AssistantMessageEvent`）、`tool_execution_start/update/end`。
- 底层流事件：`start`、`text_start/delta/end`、`thinking_start/delta/end`、`toolcall_start/delta/end`、`done`、`error`（含 `partial` 全量中间态）。
- 错误与中止都是**事件而非异常**：`prompt()` 正常 resolve；错误落在末条 AssistantMessage 的 `stopReason: 'error' | 'aborted'` + `errorMessage`，以及 `state.errorMessage`。

### 2.4 SQLite 会话后端

- 默认实现 `createNodeSqliteFactory()` 基于 **`node:sqlite`**（非 better-sqlite3）；但后端只依赖 4 方法接口 `SqliteDatabase { exec, prepare, transaction, close }`，**接受任意实现**。
- `SqliteSessionRepo { directory, databaseFactory }` → `create()/open()/list()/delete()/fork()`；会话是 entry（`message`/`compaction`/`branch_summary`/`custom`）组成的 append-only 账本 + branch 树，`Branch.appendMessage()` 追加、`findEntries()` 读回。
- pi-agent-core 另有更重的 `AgentHarness`（lane/operation/压缩/恢复），**最小替换 loop.ts 用不到**。

## 3. 验证用例结果（`pnpm vitest run` 全部通过，8/8）

探针：`src/main/agent/pi-probe/pi-probe.test.ts`（mock 服务 `mock-openai-server.ts`、装配层 `pi-runtime.ts`）。

| #   | 用例                   | 结果           | 关键路径与观察                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | 流式文本增量           | **通过**       | `text_delta` 按序到达（增量语义）；请求装配 `{baseUrl}/chat/completions`、Bearer 密钥、`stream:true`、`store:false`、`stream_options:{include_usage:true}`；usage 从流末 `usage` 帧解析。注意：字符串 prompt 以 **content parts 数组**（`[{type:'text',text}]`）下发，非纯字符串                                                                                                                           |
| b   | 工具调用往返           | **通过**       | 分片 `tool_calls` delta（`function.name`/`function.arguments` 按 index 聚合 + partial-json 解析）→ `AgentTool.execute(toolCallId, params)` 参数经 schema 校验 → 结果转 `role:'tool'` 消息回灌 → 下一轮请求含完整工具链。TypeBox（`Type.Object`）与 **zod→`z.toJSONSchema` 直传** 两种参数装配均实测通过（后者走 Pi 的 JSON-Schema 校验回退通道）；线格式为标准 `tools[].function.parameters` JSON Schema   |
| c   | 中途 abort             | **通过**       | 流中途 `agent.abort()`：`prompt()` **正常 resolve 不抛出**；末条消息 `stopReason:'aborted'` 且**已产出文本保留**；`state.errorMessage` 可读、`isStreaming` 归位                                                                                                                                                                                                                                            |
| d   | 错误路径 500/429       | **通过**       | HTTP 500/429 → `stopReason:'error'`、`errorMessage` 含状态码（来自流 `error` 事件，非异常）；**默认 `maxRetries=0` 不自动重试**（重试是宿主职责，与 Dela 现有自管重试策略契合）                                                                                                                                                                                                                            |
| e   | 历史持久化续接         | **通过（×2）** | Agent 消息（含 system/工具链）经 `Branch.appendMessage` 落 SQLite → 关闭 → 新 Repo/新 Agent 以 `findEntries` 恢复 `initialState.messages` → 第二问请求**完整携带第一轮问答与工具结果**（roles 序列 `[system,user,assistant,tool,assistant,user]`）。`node:sqlite` 工厂与 **better-sqlite3 适配工厂**（4 方法薄包装，探针内 12 行）均通过                                                                   |
| f   | DeepSeek 风格 provider | **通过**       | `reasoning_content` 增量 → `thinking_delta`（Dela onReasoning 可映射）；`thinkingLevel:'high'` → `reasoning_effort:'high'` + `thinking:{type:'enabled'}`；消息内容块为 `[thinking, text]`。**重要发现**：下一轮请求中 Pi 会把 thinking 块以 `reasoning_content` **原样回灌**（`thinkingSignature` 命中 `reasoning_content` 字段时的续联设计），与 Dela 现有「DeepSeek 不回传 reasoning」策略相反，见 §6-L1 |
| g   | 图片消息               | **通过**       | `prompt(text, [{type:'image', data: base64, mimeType}])` → `image_url` data URL content part 下发（多模态输入路径可用）；工具结果里的 `ImageContent` 块 Pi 自动转为「附图的合成 user 消息」——与 Dela loop.ts 现有做法同构                                                                                                                                                                                  |

## 4. Pi 事件 → Dela 现有 UI 回调映射

Dela `ask()`（`src/main/agent/api.ts`）现有回调 → Pi 对应物（探针 `pi-runtime.ts` 的 `subscribeDelaCallbacks` 为可运行参考实现）：

| Dela 回调（语义）                          | Pi 来源                                                                                                                                                                         | 转换要点                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `onText(cumulative)`                       | `message_update` + `assistantMessageEvent.type==='text_delta'`（增量 `delta`）                                                                                                  | Pi 给**增量**，Dela 要**本轮累计**——映射层自 `message_start` 起累加（探针实测 `['你','你好','你好！']`）                              |
| `onReasoning(cumulative)`                  | 同上，`type==='thinking_delta'`（`reasoning_content`/`reasoning`/`reasoning_text` 三字段均归一到 thinking 块）                                                                  | 同上累加；thinking 与 text 块在 `content` 中有序共存，天然支持 Dela 的 parts 分段（reasoning/text/tools）                             |
| `onToolStart({id,name,input})`             | `tool_execution_start {toolCallId, toolName, args}`                                                                                                                             | args 已是**校验后的对象**（Dela 现在要自己 `JSON.parse`；非法 JSON 由 Pi 以错误工具结果回灌模型，不再需要 Dela 的 INVALID_JSON 分支） |
| `onToolResult({id,name,input,output})`     | `tool_execution_end {toolCallId, toolName, result, isError}`（input 需从 start 事件暂存合并）；或 `state.messages` 中的 `toolResult` 消息（含 `details` 结构化数据、`isError`） | Pi 工具结果是 **content blocks（Text/Image）+ details**，非 Dela 现有 `{ok, result}` JSON 字符串——工具层需要适配（§6-L5）             |
| （中止→`reply.stopped`）                   | `stopReason==='aborted'`（prompt 正常 resolve）                                                                                                                                 | Dela 现在靠 catch abort 异常；改接 Pi 后判断末条消息 stopReason                                                                       |
| （错误→`reply.interrupted`）               | `stopReason==='error'` + `errorMessage`                                                                                                                                         | 同上，事件而非异常                                                                                                                    |
| `runAgent` 返回值 `{content, toolResults}` | `state.messages`（末条 assistant 文本 + 其前各 toolResult 消息）                                                                                                                | 汇总改从终态消息取                                                                                                                    |

## 5. 发现的限制与坑

**L1 · thinking 回灌策略与 DeepSeek 约束相反（最重要，需主动处理）**
Pi 对 `reasoning_content` 来源的 thinking 块记录 `thinkingSignature='reasoning_content'`，回放历史时会把 thinking 全文放回 assistant 消息的 `reasoning_content` 字段（探针用例 f 实测：第二问请求包含『先想一想』全文）。这是为 llama.cpp/gpt-oss 系「续联」服务的；DeepSeek 官方要求不回传 reasoning_content，严格网关可能 400。**处置**：Dela 在 `convertToLlm`/`transformContext` 钩子里剥离 `ThinkingContent` 块（或清空 `thinkingSignature`），UI 侧思考文本由 Dela 自己持久化——与现状一致。是否剥离可做成按提供商的运行时开关。【待验证】真实 DeepSeek/GLM 端点对回放 `reasoning_content` 的实际行为。

**L2 · 用户文本消息以 parts 数组下发**
`prompt('文本')` 在线上是 `content: [{type:'text',…}]` 而非纯字符串。绝大多数 OpenAI 兼容服务两者都收，但个别严格网关只认字符串（assistant content Pi 反而已是纯字符串）。如遇兼容问题，可在 `convertToLlm` 里把纯文本 user 消息折叠为字符串。

**L3 · `maxTokens` 未在 Agent 层暴露**
`SimpleStreamOptions.maxTokens` 存在，但 `AgentOptions` 不透传；Dela 的「32768 起步、400 被拒时回退 8192」策略需要：包一层 streamFn 注入 `maxTokens`，或用 `onPayload` 改写请求体（`OpenAICompletionsOptions.reasoningEffort`/`samplingParams` 也可在此注入自定义参数）。`maxTokensField`（`max_tokens` vs `max_completion_tokens`）由 compat 决定，需按提供商设置。

**L4 · 重试是宿主职责**
pi 默认 `maxRetries=0`（429/5xx 不重试），`retry-after`/`retry-after-ms` 头会被解析并有 `maxRetryDelayMs` 上限。Dela 现有「瞬时错误指数退避、已有产出不重试」策略要在 Dela 侧外层实现（监听 error 事件后决定重跑），这与 §5.1「Dela 管运行」的边界一致。

**L5 · 工具契约差异**
Pi `AgentTool.execute` 返回 `AgentToolResult { content: (Text|Image)[], details?, terminate? }` 并「抛异常表示失败」，与 Dela 现有 `execute(name, input) → {ok, result}` JSON 不同；工具层（重构计划的 §5.2 工具盘点）按 Pi 契约重写时，`details` 恰好可以承载 Dela 要给 UI 的结构化数据。工具页图像直接用 `ImageContent` 块，Pi 自动走合成 user 消息路径（与 Dela 现有 `extractToolImages` 同构，限制策略需在工具层自管）。

**L6 · SQLite 后端驱动选择**
默认 `node:sqlite`（Node ≥22.5；Electron 44 内嵌 24.20.0 已确认可 import）。Dela 现有 better-sqlite3（13.0.3）只需 4 方法薄包装即可满足 `SqliteDatabase` 接口（探针已验证读写全通）。二者取一即可；若统一到 better-sqlite3，可少一种 SQLite 栈并复用现有驱动配置；若接受 node:sqlite，则少一个原生依赖。**注意 node:sqlite 在 Node 24 仍标实验性（测试运行有 warning 输出）**。

**L7 · 会话模型是账本不是消息列表**
Pi Session 是 entry 账本 + branch 树（含 compaction/branch_summary entry 类型），Dela 现在是 `chat_sessions.messages` JSON 列。探针验证了「Agent messages ⇄ entry」往返可行；§5.1 要求的「Session → Run → 执行项」统一语义与「只保留一套持久会话事实来源」仍需按 state-model 设计稿裁决采用哪套存储（Pi Session 存储替换 chat_sessions，或 Dela 自存 + Pi 只做运行时）。AgentHarness（运行时持久化/恢复/压缩）远超当前需要，不建议首阶段引入。

**L8 · 打包与体积**

- `vite.main.config.ts` 需把 `@earendil-works/*`（及 `openai`、`typebox`）加入 `external`（接入时；本探针未进入口、main bundle 现状零 pi 引用已验证）。
- pi-ai 会把 Google/AWS/Anthropic 等 provider SDK 带进 `node_modules`；作为 `dependencies` 打包时 electron-builder 会收进 asar（估计增加数十 MB）。可评估改 devDependencies + 打包时显式收集，或接受体积（【待验证】实际打包尺寸）。
- `@google/genai`/`esbuild`/`protobufjs` 的安装脚本已按仓库策略显式禁用（§1.3），OpenAI 兼容路径不受影响。

**L9 · 其他线格式差异**
未知 baseUrl 默认 `store:false`、`stream_options:{include_usage:true}`、`prompt_cache_key`（OpenAI 域名时）等新字段；多数网关忽略未知字段，个别严格网关需要 `compat` 关闭。DeepSeek 检测还要求 assistant 消息在开思考时带**空** `reasoning_content`（`requiresReasoningContentOnAssistantMessages`），Pi 已处理。

## 6. 结论

**Pi Agent Core 可以替换 `src/main/agent/loop.ts`，无关键不成立项。** 协议层（流式、思考、工具往返、中止、错误、多模态、持久化续接）全部在 mock 实测通过；自研 loop.ts 约 340 行手写 SSE 解析/工具循环/重灌逻辑在 Pi 中均有对应且更完整的实现（多 provider compat、部分 JSON 工具参数解析、usage 统计、steer/followUp）。

推荐集成面（与 §5.1 职责表一致）：

| 归属        | 内容                                                                                                                                                                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **用 Pi**   | `Agent` 循环 + openai-completions `streamSimple`（SSE 解析、compat 适配、usage）；AgentTool 调度与参数校验；abort/steer/followUp；（可选）SQLite Session 持久化                                                                                                                                                               |
| **Dela 管** | 提供商配置 → `Model` + `compat` 构造；`getApiKey` 接加密存储；`convertToLlm` 剥离 thinking 回灌（L1）；外层重试与 max_tokens 回退（L3/L4）；zod→JSON Schema 工具桥（`zodParameters` 已验证）；`subscribeDelaCallbacks` 式 UI 事件映射（§4）；会话/Run 语义与持久化归属（L7，按 state-model 裁决）；打包 external 与体积（L8） |

**验证边界**：本报告全部结论基于本地 mock 的协议层验证；真实 DeepSeek/GLM/智谱等端点的行为差异（尤其 L1 回灌、L2 parts 数组、L9 新字段的容忍度）与 Electron 主进程/打包后的真实运行（L6/L8）待下一阶段实测。探针不接入 `src/main/index.ts`，现有构建与 204 项存量测试不受影响。
