import type { AgentToolResult } from '../../../shared/api';
import { readCompletion } from './stream';

const MAX_ROUNDS = 12;
const REQUEST_TIMEOUT = 120000;
// 单次回复的输出上限；8192 只够中等长度回答，长文档与大段工具参数会被截断，取主流模型量级。
const MAX_OUTPUT_TOKENS = 32768;
// 模型上限较低的提供商（8k 级输出）会对超限的 max_tokens 直接 400，命中时退回此前验证过的值。
const FALLBACK_OUTPUT_TOKENS = 8192;
// 单条工具结果回灌给模型的上限；超出截断并引导模型改用过滤/分页，防止上下文被单次结果撑爆。
const RESULT_CHAR_LIMIT = 20000;
// 单次运行最多附出的工具页图像数：防止模型循环调页把请求体与上下文撑爆。
const ATTACHED_IMAGE_LIMIT = 12;
// 仅对传输层瞬时错误（429/5xx/网络中断）重试；测试注入 0 延迟。
const RETRY_DELAYS = [1000, 3000];

/** OpenAI 兼容的多模态 content part：文字按输入顺序与图片交错。 */
export type ChatContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/**
 * 摘出工具输出里的页图像（read_resource 的 pages 模式）：
 * data URL 不能进 role:'tool' 的字符串消息，改由调用方转成合成 user 消息。
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

export async function runAgent(options: {
  baseUrl: string;
  model: string;
  key: string;
  /** 推理强度档位；设置时以 reasoning_effort 字段随请求下发。 */
  effort?: string;
  messages: { role: string; content: string | ChatContentPart[] }[];
  tools: unknown[];
  signal: AbortSignal;
  execute: (name: string, input: unknown) => Promise<unknown>;
  onToolResult?: (result: AgentToolResult) => void;
  onToolStart?: (call: { id: string; name: string; input: unknown }) => void;
  onText?: (text: string) => void;
  onReasoning?: (text: string) => void;
  retryDelays?: number[];
}) {
  const messages: unknown[] = [...options.messages];
  const toolResults: AgentToolResult[] = [];
  let attachedImages = 0;
  const retryDelays = options.retryDelays ?? RETRY_DELAYS;
  const endpoint = options.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let maxOutputTokens = MAX_OUTPUT_TOKENS;
  // 传输层瞬时失败指数退避重试；已有流式内容产出后不再重试，避免重复展示。
  const sendCompletion = async () => {
    for (let attempt = 0; ; attempt += 1) {
      options.signal.throwIfAborted();
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          // 每次尝试独立超时：多轮长任务不会因整跑共享计时被误杀；用户取消仍然即时生效。
          signal: AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT)]),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.key}` },
          body: JSON.stringify({
            model: options.model,
            messages,
            tools: options.tools,
            stream: true,
            max_tokens: maxOutputTokens,
            ...(options.effort ? { reasoning_effort: options.effort } : {}),
          }),
        });
        if (response.ok) return response;
        // 400 不重试，但要区分「max_tokens 超过模型上限」与真正的参数错误，故读一次响应体。
        const rejectedMaxTokens =
          response.status === 400 && /max_?tokens/i.test(await response.text().catch(() => ''));
        throw Object.assign(new Error(`模型请求失败（HTTP ${response.status}）`), {
          transient: response.status === 429 || response.status >= 500,
          rejectedMaxTokens,
        });
      } catch (error) {
        const transient =
          error instanceof Error && 'transient' in error
            ? Boolean((error as { transient?: boolean }).transient)
            : error instanceof TypeError;
        if (!transient || attempt >= retryDelays.length) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
      }
    }
  };
  // 上限被提供商拒绝时降级重跑：宁可退回 8k 上限，也不要让整轮对话以 400 失败。
  const requestCompletion = async () => {
    try {
      return await sendCompletion();
    } catch (error) {
      const rejected =
        error instanceof Error &&
        Boolean((error as { rejectedMaxTokens?: boolean }).rejectedMaxTokens);
      if (!rejected || maxOutputTokens === FALLBACK_OUTPUT_TOKENS) throw error;
      maxOutputTokens = FALLBACK_OUTPUT_TOKENS;
      return await sendCompletion();
    }
  };
  // A bounded foreground run; reaching the limit reports partial work rather than retrying mutations.
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    options.signal.throwIfAborted();
    if (round === MAX_ROUNDS - 1) {
      messages.push({
        role: 'user',
        content:
          '已接近本次执行步数上限，请直接总结已完成的工作并给出最终回答，不要发起新的工具调用。',
      });
    }
    const message = await readCompletion(
      await requestCompletion(),
      options.signal,
      options.onText,
      // 逐轮直传本轮累计文本：api 层按 parts 位置分段保存，不跨轮拼接。
      options.onReasoning,
    );
    if (!message.tool_calls?.length) return { content: message.content ?? '', toolResults };
    // 回灌模型只保留 content 与 tool_calls：DeepSeek 明确要求不回传 reasoning_content。
    messages.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls });
    // 本轮工具产出的页图像：全部 tool 消息落位后统一以一条合成 user 消息附上。
    const roundImages: ChatContentPart[] = [];
    for (const call of message.tool_calls) {
      options.signal.throwIfAborted();
      let input: unknown;
      let output: unknown;
      try {
        input = JSON.parse(call.function.arguments);
      } catch {
        output = { ok: false, error: { code: 'INVALID_JSON', message: '工具参数必须是有效 JSON' } };
      }
      // 开始执行即通知：UI 在拿到结果前就能展示带输入摘要的运行中步骤。
      options.onToolStart?.({ id: call.id, name: call.function.name, input });
      if (output === undefined) output = await options.execute(call.function.name, input);
      // 页图像从输出中剥离：tool 消息与持久化结果只留 pageImages 元数据，base64 不进数据库与时间线。
      const attachments = extractToolImages(output);
      if (attachments) {
        output = attachments.output;
        const budget = ATTACHED_IMAGE_LIMIT - attachedImages;
        for (const image of attachments.list.slice(0, Math.max(0, budget))) {
          roundImages.push(
            {
              type: 'text',
              text: `【${call.function.name} 附图】${attachments.title ? `《${attachments.title}》` : ''}第 ${image.page} 页`,
            },
            { type: 'image_url', image_url: { url: image.dataUrl } },
          );
        }
        attachedImages += Math.min(attachments.list.length, Math.max(0, budget));
        if (attachments.list.length > budget)
          roundImages.push({
            type: 'text',
            text: `本次运行附图已达 ${ATTACHED_IMAGE_LIMIT} 张上限，其余页图像未附出，请基于已附内容回答。`,
          });
      }
      const result = { id: call.id, name: call.function.name, input, output };
      toolResults.push(result);
      options.onToolResult?.(result);
      const serialized = JSON.stringify(output);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content:
          serialized.length > RESULT_CHAR_LIMIT
            ? `${serialized.slice(0, RESULT_CHAR_LIMIT)}…[结果过大已截断，请用更具体的过滤或分页参数重新查询]`
            : serialized,
      });
    }
    if (roundImages.length) messages.push({ role: 'user', content: roundImages });
  }
  return {
    content: '已达到本次执行步数上限。已完成的操作保留，请查看工具结果后继续。',
    toolResults,
  };
}
