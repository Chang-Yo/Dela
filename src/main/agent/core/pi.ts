/**
 * Pi Agent Core 运行时桥（docs/refactor/pi-integration-report.md §6 推荐集成面）：
 * - buildPiModel：Dela 提供商配置 → pi-ai openai-completions Model；
 * - createDelaStreamFn：streamFn 包装——注入 maxTokens 与请求超时，承担 Pi 不做的
 *   max_tokens 降参重发（L3）与瞬时错误退避重试（L4）；
 * - stripThinking：convertToLlm 钩子，一律剥离思考回灌（裁决 L1，对齐 DeepSeek 不回传策略）；
 * - createToolResultPruner：transformContext 钩子——每次模型请求前按预算修剪较早的工具
 *   结果（计划 §6.1「每次模型请求前检查」的运行内落点），只影响发出的请求，不改会话状态。
 */
import type { AgentMessage, StreamFn } from '@earendil-works/pi-agent-core';
// 根入口同时被 types.d.ts 以 `export type` 转出 AssistantMessageEventStream（类型）与
// event-stream.d.ts 的类声明（值），前者胜出导致类只能按类型导入；实例化走官方工厂函数。
import { clampThinkingLevel, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  Model,
  OpenAICompletionsOptions,
  ThinkingLevelMap,
} from '@earendil-works/pi-ai';
import { stream as openAiCompletionsStream } from '@earendil-works/pi-ai/api/openai-completions';
import { IMAGE_TOKEN_EST, contextBudget, estimateTokens } from '../context/budget';

// 单次回复的输出上限；8192 只够中等长度回答，长文档与大段工具参数会被截断，取主流模型量级。
export const MAX_OUTPUT_TOKENS = 32768;
// 模型上限较低的提供商（8k 级输出）会对超限的 max_tokens 直接 400，命中时退回此前验证过的值。
export const FALLBACK_OUTPUT_TOKENS = 8192;
// 仅对传输层瞬时错误（429/5xx/网络中断）重试；测试注入 0 延迟。
export const DEFAULT_RETRY_DELAYS = [1000, 3000];
// 每次尝试独立超时：多轮长任务不会因整跑共享计时被误杀；用户取消仍然即时生效。
const REQUEST_TIMEOUT_MS = 120000;
// 未知提供商的保守上下文窗口：仅作估算口径；输出上限由本包装直接注入，
// 不走 streamSimple 的 buildBaseOptions（那会按窗口余量把 maxTokens 钳小）。
const CONSERVATIVE_CONTEXT_WINDOW = 32768;
// 400 报文里指向输出上限的关键字：兼容 max_tokens 与 max_completion_tokens 两种字段名。
const MAX_TOKENS_REJECTION = /max_(?:completion_)?tokens/i;
const HTTP_STATUS_PREFIX = /^\s*(\d{3})\b/;
// 传输层失败的特征文案（OpenAI SDK 的 APIConnectionError 一族）；超时按旧策略不重试。
const TRANSIENT_NETWORK =
  /connection|network|fetch failed|econnreset|enotfound|eai_again|socket|terminated|other side closed/i;
const TIMEOUT_PATTERN = /timed?\s*out|timeout/i;

/** 构造指向任意 OpenAI 兼容服务的 Pi Model；baseUrl 形如 https://api.example.com/v1。 */
export function buildPiModel(input: {
  baseUrl: string;
  modelId: string;
  /**
   * 提供商标识：命中 pi-ai 已知提供商（deepseek/zai 等）时启用对应 compat；
   * 缺省只按 baseUrl 关键字自动检测。
   */
  provider?: string;
  /** 是否开启推理：决定 system→developer 角色与 thinking/reasoning_effort 字段的下发。 */
  reasoning: boolean;
  /** 档位映射：让 xhigh/max 等扩展档位原样下发（Pi 默认会把未映射的高档位压到 high）。 */
  thinkingLevelMap?: ThinkingLevelMap;
}): Model<'openai-completions'> {
  return {
    id: input.modelId,
    name: input.modelId,
    api: 'openai-completions',
    provider: input.provider ?? 'dela-openai-compatible',
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    reasoning: input.reasoning,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CONSERVATIVE_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
    ...(input.thinkingLevelMap ? { thinkingLevelMap: input.thinkingLevelMap } : {}),
  };
}

/** 流式失败的归因：状态码取自 pi-ai 错误文案的前缀（formatProviderError 的 "<status>: <body>"）。 */
export interface StreamFailureClass {
  status?: number;
  kind: 'http' | 'network' | 'timeout' | 'other';
  transient: boolean;
}

export function classifyStreamFailure(message: string): StreamFailureClass {
  const statusMatch = HTTP_STATUS_PREFIX.exec(message);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return { status, kind: 'http', transient: status === 429 || status >= 500 };
  }
  if (TIMEOUT_PATTERN.test(message)) return { kind: 'timeout', transient: false };
  if (TRANSIENT_NETWORK.test(message)) return { kind: 'network', transient: true };
  return { kind: 'other', transient: false };
}

/**
 * Dela 的 streamFn 包装：在 pi-ai openai-completions 适配器外承担宿主职责。
 * - 每次逻辑请求注入 maxTokens 与 120s 超时；400 且报文指向输出上限时降参重发一次；
 * - 429/5xx/网络错误在无部分产出的前提下按 retryDelays 指数退避重试，有产出不重试；
 * - 重试与降参对调用方透明：包装流只会向下游推送一份数据（重试前的事件全部丢弃）。
 */
export function createDelaStreamFn(config: { retryDelays?: number[] } = {}): StreamFn {
  const retryDelays = config.retryDelays ?? DEFAULT_RETRY_DELAYS;
  // 整个 runAgent 运行内粘滞：降级到 8192 后，后续轮次沿用低上限（对齐旧循环的整跑状态）。
  let maxTokens = MAX_OUTPUT_TOKENS;
  let usedFallback = false;
  return (model, context, options) => {
    const piModel = model as Model<'openai-completions'>;
    const output = createAssistantMessageEventStream();
    void (async () => {
      try {
        // 每个逻辑请求（同一 maxTokens 档位）独立的瞬时重试预算；降参重发时重置。
        let attempt = 0;
        for (;;) {
          const clamped = options?.reasoning
            ? clampThinkingLevel(piModel, options.reasoning)
            : undefined;
          const inner = openAiCompletionsStream(piModel, context, {
            ...options,
            reasoningEffort: clamped === 'off' ? undefined : clamped,
            maxTokens,
            timeoutMs: REQUEST_TIMEOUT_MS,
          } as OpenAICompletionsOptions);
          // 有产出前不向下游转发任何事件：一旦转发就无法安全重试。
          let live = false;
          const buffered: AssistantMessageEvent[] = [];
          let terminal: Extract<AssistantMessageEvent, { type: 'done' | 'error' }> | null = null;
          for await (const event of inner) {
            if (event.type === 'done' || event.type === 'error') {
              terminal = event;
              break;
            }
            if (live) {
              output.push(event);
            } else {
              buffered.push(event);
              if (event.type !== 'start') {
                live = true;
                for (const bufferedEvent of buffered) output.push(bufferedEvent);
                buffered.length = 0;
              }
            }
          }
          if (!terminal) {
            terminal = {
              type: 'error',
              reason: 'error',
              error: assistantFailure(piModel, '模型响应流提前结束，未执行未完成的工具调用'),
            };
          }
          if (terminal.type === 'done') {
            if (!live) for (const bufferedEvent of buffered) output.push(bufferedEvent);
            output.push(terminal);
            output.end();
            return;
          }
          const failure = terminal.error;
          const errorMessage = failure.errorMessage ?? '';
          const produced = live || failure.content.length > 0;
          if (!produced && failure.stopReason !== 'aborted') {
            const classified = classifyStreamFailure(errorMessage);
            // 上限被提供商拒绝时降级重跑：宁可退回 8k 上限，也不要让整轮对话以 400 失败。
            if (
              classified.status === 400 &&
              !usedFallback &&
              MAX_TOKENS_REJECTION.test(errorMessage)
            ) {
              maxTokens = FALLBACK_OUTPUT_TOKENS;
              usedFallback = true;
              attempt = 0;
              continue;
            }
            // 传输层瞬时失败指数退避重试；已有流式内容产出后不再重试，避免重复展示。
            if (classified.transient && attempt < retryDelays.length) {
              const delay = retryDelays[attempt]!;
              attempt += 1;
              if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
              if (!options?.signal?.aborted) continue;
            }
          }
          if (!live) for (const bufferedEvent of buffered) output.push(bufferedEvent);
          output.push(terminal);
          output.end();
          return;
        }
      } catch (error) {
        // StreamFn 契约：不得抛出；兜底编码为 error 事件。
        try {
          output.push({
            type: 'error',
            reason: 'error',
            error: assistantFailure(
              piModel,
              error instanceof Error ? error.message : String(error),
            ),
          });
          output.end();
        } catch {
          // 输出流已终结：无处可报。
        }
      }
    })();
    return output;
  };
}

/** 裁决 L1：convertToLlm 钩子——回灌模型的 assistant 消息一律剥离思考块，思考文本由 Dela 自己持久化。 */
export function stripThinking(messages: AgentMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    if (message.role === 'assistant') {
      return [
        { ...message, content: message.content.filter((block) => block.type !== 'thinking') },
      ];
    }
    return message.role === 'system' || message.role === 'user' || message.role === 'toolResult'
      ? [message]
      : [];
  });
}

// ===== 运行内修剪（transformContext 钩子，计划 §6.1「每次模型请求前检查」） =====

/** 修剪后每条工具结果保留的字符数（关键结果前缀）。 */
export const PRUNE_KEEP_CHARS = 500;
/** 完整保留的最近轮数（assistant 轮为界；更早轮的工具结果可被修剪）。 */
export const PRUNE_KEEP_ROUNDS = 2;

export interface PrunePolicy {
  /** 输入预算（token）；缺省 contextBudget().budget。 */
  budgetTokens?: number;
  /** 修剪后保留的字符数；缺省 PRUNE_KEEP_CHARS。 */
  keepChars?: number;
  /** 完整保留的最近轮数；缺省 PRUNE_KEEP_ROUNDS。 */
  keepRounds?: number;
}

/** 单条 AgentMessage 的 token 估算（与 context/budget 同口径；图片按固定值）。 */
export function estimateAgentMessageTokens(message: AgentMessage): number {
  switch (message.role) {
    case 'system':
    case 'user':
      return typeof message.content === 'string'
        ? estimateTokens(message.content)
        : message.content.reduce(
            (total, block) =>
              total + (block.type === 'text' ? estimateTokens(block.text) : IMAGE_TOKEN_EST),
            0,
          );
    case 'assistant':
      return message.content.reduce((total, block) => {
        if (block.type === 'text') return total + estimateTokens(block.text);
        if (block.type === 'thinking') return total + estimateTokens(block.thinking);
        return total + estimateTokens(JSON.stringify(block.arguments));
      }, 0);
    case 'toolResult':
      return message.content.reduce(
        (total, block) =>
          total + (block.type === 'text' ? estimateTokens(block.text) : IMAGE_TOKEN_EST),
        0,
      );
    default:
      return 0;
  }
}

function estimateAgentMessages(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateAgentMessageTokens(message), 0);
}

function textOfToolResult(message: Extract<AgentMessage, { role: 'toolResult' }>): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * 运行内修剪：估算总量超预算时，把较早轮次（保留最近 keepRounds 轮完整）的工具结果
 * 消息内容替换为占位（工具名 + 关键结果前 keepChars 字符），不做运行中模型调用，
 * 也不改 Agent 会话状态——transformContext 的返回值只用于本次发出的请求。
 * 修剪后仍超预算时原样返回（无更多可安全修剪项；宁可继续请求也不破坏调用关联）。
 */
export function pruneToolResults(
  messages: AgentMessage[],
  config: { budget: number; keepChars: number; keepRounds: number },
): AgentMessage[] {
  let total = estimateAgentMessages(messages);
  if (total <= config.budget) return messages;
  const assistants = messages
    .map((message, index) => (message.role === 'assistant' ? index : -1))
    .filter((index) => index >= 0);
  // 最近 keepRounds 轮（自该 assistant 起的消息，含其工具结果）保持完整；
  // keepRounds 为 0 时不保护任何轮（全部可修剪）。
  const cutoffIndex = assistants.length - config.keepRounds;
  const cutoff =
    cutoffIndex >= assistants.length
      ? Number.POSITIVE_INFINITY
      : (assistants[Math.max(0, cutoffIndex)] ?? Number.POSITIVE_INFINITY);
  const working = messages.slice();
  for (let index = 0; index < working.length && total > config.budget; index += 1) {
    const message = working[index];
    if (!message || message.role !== 'toolResult' || index >= cutoff) continue;
    const kept = textOfToolResult(message).slice(0, config.keepChars);
    const pruned: Extract<AgentMessage, { role: 'toolResult' }> = {
      ...message,
      content: [
        {
          type: 'text',
          text: `[已修剪的工具结果：${message.toolName}，关键结果保留前 ${config.keepChars} 字符]\n${kept}`,
        },
      ],
    };
    total += estimateAgentMessageTokens(pruned) - estimateAgentMessageTokens(message);
    working[index] = pruned;
  }
  return working;
}

/** transformContext 钩子工厂：runAgent 的可选 prunePolicy 缺省时不启用（行为不变）。 */
export function createToolResultPruner(policy: PrunePolicy = {}) {
  const config = {
    budget: policy.budgetTokens ?? contextBudget().budget,
    keepChars: policy.keepChars ?? PRUNE_KEEP_CHARS,
    keepRounds: policy.keepRounds ?? PRUNE_KEEP_ROUNDS,
  };
  return (messages: AgentMessage[]): Promise<AgentMessage[]> =>
    Promise.resolve(pruneToolResults(messages, config));
}

function assistantFailure(model: Model<'openai-completions'>, message: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now(),
  };
}
