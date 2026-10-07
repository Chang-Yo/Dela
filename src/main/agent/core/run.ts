/**
 * runAgent：Dela 的模型执行循环，基于 Pi Agent Core（docs/refactor/decisions-phase1.md 总裁决 1）。
 * 职责边界：Pi 管循环、SSE 解析、工具调度与参数校验；这里管消息形状转换、事件到 Dela
 * 回调的映射、工具结果桥（{ok,result} ⇄ content blocks）、步数上限与 abort/错误语义。
 */
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  FinishTurn,
  PrepareNextTurnContext,
  ThinkingLevel,
} from '@earendil-works/pi-agent-core';
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingLevelMap,
  TSchema,
  UserMessage,
} from '@earendil-works/pi-ai';
import type { AgentToolResult } from '../../../shared/api';
import { loadPiRuntime } from './pi-load';
import {
  buildPiModel,
  classifyStreamFailure,
  createDelaStreamFn,
  createToolResultPruner,
  DEFAULT_RETRY_DELAYS,
  stripThinking,
  type PrunePolicy,
} from './pi';

const MAX_ROUNDS = 50;
// 单条工具结果回灌给模型的上限；超出截断并引导模型改用过滤/分页，防止上下文被单次结果撑爆。
const RESULT_CHAR_LIMIT = 20000;
// 单次运行最多附出的工具页图像数：防止模型循环调页把请求体与上下文撑爆。
const ATTACHED_IMAGE_LIMIT = 12;
const ROUND_LIMIT_NUDGE =
  '已接近本次执行步数上限，请直接总结已完成的工作并给出最终回答，不要发起新的工具调用。';
const ROUND_LIMIT_CONTENT = '已达到本次执行步数上限。已完成的操作保留，请查看工具结果后继续。';

/** OpenAI 兼容的多模态 content part：文字按输入顺序与图片交错。 */
export type ChatContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Dela 推理档位（shared/llm-presets 的超集）→ Pi ThinkingLevel；未知高档位经 map 原样下发。 */
const EFFORT_TO_LEVEL: Partial<Record<string, ThinkingLevel>> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

function effortToThinking(effort: string | undefined): {
  level: ThinkingLevel;
  reasoning: boolean;
  map?: ThinkingLevelMap;
} {
  if (!effort || effort === 'none') return { level: 'off', reasoning: false };
  const known = EFFORT_TO_LEVEL[effort];
  if (known) return { level: known, reasoning: true, map: { xhigh: 'xhigh', max: 'max' } };
  // 超出 Pi 档位集的扩展档位（如 ultra）：挂到最高档并映射回原名，保持线上字段不变。
  return { level: 'max', reasoning: true, map: { max: effort } };
}

function parseDataUrl(url: string): ImageContent | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match ? { type: 'image', mimeType: match[1]!, data: match[2]! } : null;
}

/** ChatContentPart[] → Pi 用户消息 content；图片必须是 data URL，其余跳过。 */
function toUserContent(
  content: string | ChatContentPart[],
): string | (TextContent | ImageContent)[] {
  if (typeof content === 'string') return content;
  const parts: (TextContent | ImageContent)[] = [];
  for (const part of content) {
    if (part.type === 'text') parts.push({ type: 'text', text: part.text });
    else {
      const image = parseDataUrl(part.image_url.url);
      if (image) parts.push(image);
    }
  }
  return parts;
}

/**
 * 摘出工具输出里的页图像（read_resource 的 pages 模式）：
 * data URL 不能进 role:'tool' 的字符串消息，改由 Pi 自动转成合成 user 图片消息。
 */
function extractToolImages(output: unknown): {
  output: unknown;
  title: string;
  list: { page: number; dataUrl: string }[];
} | null {
  if (output === null || typeof output !== 'object' || !('ok' in output)) return null;
  const wrapper = output as { ok?: unknown; result?: unknown };
  if (wrapper.ok !== true || wrapper.result === null || typeof wrapper.result !== 'object')
    return null;
  const result = wrapper.result as { images?: unknown; title?: unknown };
  if (!Array.isArray(result.images) || result.images.length === 0) return null;
  const list = result.images.filter(
    (image): image is { page: number; dataUrl: string } =>
      typeof image === 'object' &&
      image !== null &&
      typeof (image as { page?: unknown }).page === 'number' &&
      typeof (image as { dataUrl?: unknown }).dataUrl === 'string',
  );
  const { images: _stripped, ...rest } = result;
  return {
    output: { ...wrapper, result: rest },
    title: typeof result.title === 'string' ? result.title : '',
    list,
  };
}

/** 旧循环的模型错误文案：保留 HTTP 状态与超时/网络的用户提示形状。 */
function modelFailureMessage(rawMessage: string | undefined): string {
  const message = rawMessage ?? '未知错误';
  const classified = classifyStreamFailure(message);
  if (classified.status !== undefined) return `模型请求失败（HTTP ${classified.status}）`;
  if (classified.kind === 'timeout' || classified.kind === 'network')
    return '模型请求超时或网络连接失败，请重试';
  return `模型请求失败：${message}`;
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/** OpenAI function 定义（含 JSON Schema parameters）的读取形状；注册层保证实际结构。 */
type FunctionToolDefinition = {
  function?: { name?: unknown; description?: unknown; parameters?: unknown };
};

export async function runAgent(options: {
  baseUrl: string;
  model: string;
  key: string;
  /** 推理强度档位；设置时以 reasoning_effort 字段随请求下发。 */
  effort?: string;
  modelSettings?: import('../../../shared/llm').LlmModelSettings;
  messages: { role: string; content: string | ChatContentPart[] }[];
  tools: unknown[];
  signal: AbortSignal;
  /** 工具执行上下文（cwd、onUpdate）由此桥接；signal 由本层注入。 */
  execute: (
    name: string,
    input: unknown,
    context: { signal: AbortSignal; onUpdate?: (output: unknown) => void },
  ) => Promise<unknown>;
  onToolResult?: (result: AgentToolResult) => void;
  onToolStart?: (call: { id: string; name: string; input: unknown }) => void;
  onToolUpdate?: (update: { id: string; output: unknown }) => void;
  onText?: (text: string) => void;
  onReasoning?: (text: string) => void;
  retryDelays?: number[];
  /**
   * 运行内修剪（可选）：设置后经 transformContext 在每次模型请求前修剪较早的工具结果，
   * 使消息总量回到预算内；缺省不启用，行为与此前一致。
   */
  prunePolicy?: PrunePolicy;
}) {
  options.signal.throwIfAborted();
  const piRuntime = await loadPiRuntime();
  const thinking = effortToThinking(options.effort);
  const piModel = buildPiModel({
    baseUrl: options.baseUrl,
    modelId: options.model,
    reasoning: thinking.reasoning,
    settings: options.modelSettings,
    ...(thinking.map ? { thinkingLevelMap: thinking.map } : {}),
  });
  // 首条 system 进 initialState.systemPrompt（Pi 会把工具声明编码进同一条 system 消息）；
  // 其余为 user/assistant 历史，最后一条 user 消息由 prompt() 承载。
  const source = [...options.messages];
  const systemContent = source[0]?.role === 'system' ? source[0].content : '';
  const systemPrompt =
    typeof systemContent === 'string'
      ? systemContent
      : systemContent.map((part) => (part.type === 'text' ? part.text : '')).join('');
  const body = source[0]?.role === 'system' ? source.slice(1) : source;
  const last = body.at(-1);
  const promptMessage: UserMessage | null =
    last && last.role === 'user'
      ? { role: 'user', content: toUserContent(last.content), timestamp: Date.now() }
      : null;
  const history: AgentMessage[] = (promptMessage ? body.slice(0, -1) : body).flatMap(
    (message): AgentMessage[] => {
      if (message.role === 'user') {
        return [{ role: 'user', content: toUserContent(message.content), timestamp: Date.now() }];
      }
      if (message.role !== 'assistant') return [];
      const text = typeof message.content === 'string' ? message.content : '';
      const assistant: AssistantMessage = {
        role: 'assistant',
        content: text ? [{ type: 'text', text }] : [],
        api: piModel.api,
        provider: piModel.provider,
        model: piModel.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
      return [assistant];
    },
  );
  // 工具桥：注册层的 OpenAI function 定义 → Pi AgentTool；参数 schema 直用 JSON Schema
  // （Pi 对无 TypeBox 标记的参数走 JSON Schema 校验回退通道，探针已验证）。
  const knownTools = new Set<string>();
  const executedCalls = new Set<string>();
  // 回灌给模型的结果按 id 暂存：tool_execution_end 事件里取回 Dela 形状的输出（含剥离图片后的原样 JSON）。
  const toolOutputs = new Map<string, unknown>();
  let attachedImages = 0;
  const bridgedTools: AgentTool[] = [];
  for (const definition of options.tools as FunctionToolDefinition[]) {
    const name = definition.function?.name;
    if (typeof name !== 'string' || !name) continue;
    knownTools.add(name);
    const description =
      typeof definition.function?.description === 'string' ? definition.function!.description : '';
    const parameters = (definition.function?.parameters ?? {
      type: 'object',
      properties: {},
    }) as TSchema;
    bridgedTools.push({
      name,
      label: name,
      description,
      parameters,
      async execute(toolCallId, params) {
        executedCalls.add(toolCallId);
        // 注册层保证返回 {ok,result}/{ok,error} 对象；null 兜底防止 undefined 序列化异常。
        const output =
          (await options.execute(name, params, {
            signal: options.signal,
            onUpdate: (partial) => options.onToolUpdate?.({ id: toolCallId, output: partial }),
          })) ?? null;
        // 页图像从输出中剥离：回灌字符串与持久化结果只留元数据，图像走 Pi 的合成 user 消息。
        const attachments = extractToolImages(output);
        let persisted: unknown = output;
        const content: (TextContent | ImageContent)[] = [];
        if (attachments) {
          persisted = attachments.output;
          const budget = ATTACHED_IMAGE_LIMIT - attachedImages;
          const attached = attachments.list.slice(0, Math.max(0, budget));
          attachedImages += attached.length;
          if (attached.length) {
            const images = attached.flatMap(({ dataUrl }) => {
              const image = parseDataUrl(dataUrl);
              return image ? [image] : [];
            });
            content.push({
              type: 'text',
              text: `【${name} 附图】${attachments.title ? `《${attachments.title}》` : ''}第 ${attached
                .map(({ page }) => page)
                .join('、')} 页`,
            });
            content.push(...images);
          }
          if (attachments.list.length > budget)
            content.push({
              type: 'text',
              text: `本次运行附图已达 ${ATTACHED_IMAGE_LIMIT} 张上限，其余页图像未附出，请基于已附内容回答。`,
            });
        }
        toolOutputs.set(toolCallId, persisted);
        const serialized = JSON.stringify(persisted);
        content.unshift({
          type: 'text',
          text:
            serialized.length > RESULT_CHAR_LIMIT
              ? `${serialized.slice(0, RESULT_CHAR_LIMIT)}…[结果过大已截断，请用更具体的过滤或分页参数重新查询]`
              : serialized,
        });
        return { content, details: {} };
      },
    });
  }
  // 事件映射（报告 §4）：Pi 给增量，Dela 回调要本轮累计；工具入参从 start 事件暂存合并。
  const toolResults: AgentToolResult[] = [];
  let turnText = '';
  let turnReasoning = '';
  const pendingInputs = new Map<string, unknown>();
  const onEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'message_start':
        turnText = '';
        turnReasoning = '';
        break;
      case 'message_update': {
        const inner = event.assistantMessageEvent;
        if (inner.type === 'text_delta') {
          turnText += inner.delta;
          options.onText?.(turnText);
        } else if (inner.type === 'thinking_delta') {
          turnReasoning += inner.delta;
          options.onReasoning?.(turnReasoning);
        }
        break;
      }
      case 'tool_execution_start':
        pendingInputs.set(event.toolCallId, event.args);
        // 开始执行即通知：UI 在拿到结果前就能展示带输入摘要的运行中步骤。
        options.onToolStart?.({ id: event.toolCallId, name: event.toolName, input: event.args });
        break;
      case 'tool_execution_end': {
        const input = pendingInputs.get(event.toolCallId);
        pendingInputs.delete(event.toolCallId);
        const result = {
          id: event.toolCallId,
          name: event.toolName,
          input,
          output: toolOutputFor(event, toolOutputs, executedCalls, knownTools),
        };
        toolResults.push(result);
        options.onToolResult?.(result);
        break;
      }
    }
  };
  // 步数上限：shell 长任务与多步文件操作需要更多轮转；配合上下文压缩与运行内修剪，
  // 上限从旧循环的 12 提到 50。在 finishTurn/prepareNextTurn 钩子里计数——末轮前一轮
  // 注入收尾提示，末轮仍发起工具调用则结束运行并返回上限文案。
  let roundCapped = false;
  const assistantTurns = (messages: AgentMessage[]) =>
    messages.filter((message) => message.role === 'assistant').length;
  const finishTurn: FinishTurn = (turn) => {
    if (
      assistantTurns(turn.newMessages) >= MAX_ROUNDS &&
      turn.message.content.some((block) => block.type === 'toolCall')
    ) {
      roundCapped = true;
      return { action: 'end' };
    }
    return undefined;
  };
  const prepareNextTurn = (turn: PrepareNextTurnContext) => {
    if (assistantTurns(turn.newMessages) === MAX_ROUNDS - 1) {
      const nudge: UserMessage = {
        role: 'user',
        content: ROUND_LIMIT_NUDGE,
        timestamp: Date.now(),
      };
      return { messages: [nudge] };
    }
    return undefined;
  };
  const agent = new piRuntime.Agent({
    initialState: {
      systemPrompt,
      model: piModel,
      thinkingLevel: thinking.level,
      ...(bridgedTools.length ? { tools: bridgedTools } : {}),
      ...(history.length ? { messages: history } : {}),
    },
    streamFn: createDelaStreamFn({
      maxOutputTokens: options.modelSettings?.maxOutputTokens,
      runtime: piRuntime,
      retryDelays: options.retryDelays ?? DEFAULT_RETRY_DELAYS,
    }),
    getApiKey: () => options.key,
    convertToLlm: stripThinking,
    ...(options.prunePolicy
      ? { transformContext: createToolResultPruner(options.prunePolicy) }
      : {}),
    // 旧循环按序执行工具调用；保持串行避免并发写库与事件乱序。
    toolExecution: 'sequential',
    finishTurn,
    prepareNextTurnWithContext: prepareNextTurn,
  });
  // 用户取消转发到 Agent 运行：prompt() 以 aborted 事件正常 resolve，由这里统一转成异常
  //（manager 靠 catch 判断 stopped）。
  const forwardAbort = () => agent.abort();
  options.signal.addEventListener('abort', forwardAbort);
  const unsubscribe = agent.subscribe(onEvent);
  try {
    if (promptMessage) await agent.prompt(promptMessage);
    else await agent.continue();
    options.signal.throwIfAborted();
    const finalMessage = [...agent.state.messages]
      .reverse()
      .find((message): message is AssistantMessage => message.role === 'assistant');
    if (finalMessage) {
      if (finalMessage.stopReason === 'aborted') options.signal.throwIfAborted();
      if (finalMessage.stopReason === 'error')
        throw new Error(modelFailureMessage(finalMessage.errorMessage));
      // 末条消息被输出上限截断时按旧语义报错，不把半截回答当正常结果。
      if (finalMessage.stopReason === 'length')
        throw new Error('模型输出达到长度限制，未执行未完成的工具调用');
    }
    if (roundCapped) return { content: ROUND_LIMIT_CONTENT, toolResults };
    return { content: finalMessage ? textOf(finalMessage) : '', toolResults };
  } finally {
    unsubscribe();
    options.signal.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Pi 工具结果 → Dela 的 {ok,result} JSON 形状（持久化层依赖）：
 * - 桥接层执行过的调用：取暂存的输出（图片已剥离、原样 JSON）；
 * - 未到达执行（Pi 校验失败/工具不存在）或执行抛异常：转错误外壳，非法参数由 Pi 以
 *   错误工具结果回灌模型（旧 INVALID_JSON 分支的等价物）。
 */
function toolOutputFor(
  event: Extract<AgentEvent, { type: 'tool_execution_end' }>,
  toolOutputs: Map<string, unknown>,
  executedCalls: Set<string>,
  knownTools: Set<string>,
): unknown {
  const persisted = toolOutputs.get(event.toolCallId);
  if (persisted !== undefined) return persisted;
  const text = (event.result as { content?: { type: string; text?: string }[] }).content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  if (executedCalls.has(event.toolCallId))
    return { ok: false, error: { code: 'UPSTREAM_ERROR', message: text || '工具执行失败' } };
  return {
    ok: false,
    error: {
      code: knownTools.has(event.toolName) ? 'INVALID_INPUT' : 'UNKNOWN_TOOL',
      message: text || '工具调用未执行',
    },
  };
}
