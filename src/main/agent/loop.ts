import { z } from 'zod';
import type { AgentToolResult } from '../../shared/api';

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                type: z.literal('function'),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .max(20)
            .optional(),
        }),
      }),
    )
    .min(1),
});

async function readCompletion(
  response: Response,
  signal: AbortSignal,
  onText?: (text: string) => void,
  onReasoning?: (text: string) => void,
) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const message = completionSchema.parse(await response.json()).choices[0]!.message;
    if (message.reasoning_content) onReasoning?.(message.reasoning_content);
    onText?.(message.content ?? '');
    return message;
  }
  if (!response.body) throw new Error('模型没有返回响应流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '',
    content = '',
    reasoning = '',
    finished = false;
  const calls = new Map<
    number,
    { id: string; type: 'function'; function: { name: string; arguments: string } }
  >();
  const chunkSchema = z.object({
    choices: z.array(
      z.object({
        index: z.number().optional(),
        finish_reason: z.string().nullable().optional(),
        delta: z.object({
          content: z.string().nullable().optional(),
          // 思考增量：OpenAI 兼容层的通用字段是 reasoning_content（DeepSeek/GLM/MiniMax/Qwen），
          // 部分网关（OpenRouter/vLLM 系）用 reasoning；两者都接受。
          reasoning_content: z.string().nullable().optional(),
          reasoning: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().int().min(0).max(19),
                id: z.string().optional(),
                function: z
                  .object({ name: z.string().optional(), arguments: z.string().optional() })
                  .optional(),
              }),
            )
            .optional(),
        }),
      }),
    ),
  });
  const processEvent = (event: string) => {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    const chunk = chunkSchema.parse(JSON.parse(data));
    const choice = chunk.choices.find((item) => item.index === undefined || item.index === 0);
    if (!choice) return;
    if (choice.finish_reason === 'length')
      throw new Error('模型输出达到长度限制，未执行未完成的工具调用');
    if (choice.finish_reason === 'content_filter') throw new Error('模型响应被过滤');
    const reasoningDelta = choice.delta.reasoning_content ?? choice.delta.reasoning;
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      onReasoning?.(reasoning);
    }
    if (choice.delta.content) {
      content += choice.delta.content;
      onText?.(content);
    }
    for (const part of choice.delta.tool_calls ?? []) {
      const call = calls.get(part.index) ?? {
        id: '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (part.id) call.id += part.id;
      call.function.name += part.function?.name ?? '';
      call.function.arguments += part.function?.arguments ?? '';
      calls.set(part.index, call);
    }
  };
  try {
    while (!finished) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      // Normalize after buffering so CRLF split across network chunks remains intact.
      pending = pending.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        processEvent(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (chunk.done) {
        if (pending.trim()) processEvent(pending);
        break;
      }
    }
    if (!finished) throw new Error('模型响应流提前结束，未执行未完成的工具调用');
    return completionSchema.parse({
      choices: [
        {
          message: {
            content,
            tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call),
          },
        },
      ],
    }).choices[0]!.message;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const MAX_ROUNDS = 12;
const REQUEST_TIMEOUT = 120000;
// 单条工具结果回灌给模型的上限；超出截断并引导模型改用过滤/分页，防止上下文被单次结果撑爆。
const RESULT_CHAR_LIMIT = 20000;
// 仅对传输层瞬时错误（429/5xx/网络中断）重试；测试注入 0 延迟。
const RETRY_DELAYS = [1000, 3000];

export async function runAgent(options: {
  baseUrl: string;
  model: string;
  key: string;
  /** 推理强度档位；设置时以 reasoning_effort 字段随请求下发。 */
  effort?: string;
  messages: { role: string; content: string }[];
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
  const retryDelays = options.retryDelays ?? RETRY_DELAYS;
  const endpoint = options.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  // 传输层瞬时失败指数退避重试；已有流式内容产出后不再重试，避免重复展示。
  const requestCompletion = async () => {
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
            max_tokens: 8192,
            ...(options.effort ? { reasoning_effort: options.effort } : {}),
          }),
        });
        if (response.ok) return response;
        throw Object.assign(new Error(`模型请求失败（HTTP ${response.status}）`), {
          transient: response.status === 429 || response.status >= 500,
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
      options.onReasoning,
    );
    if (!message.tool_calls?.length) return { content: message.content ?? '', toolResults };
    messages.push({ role: 'assistant', ...message });
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
  }
  return {
    content: '已达到本次执行步数上限。已完成的操作保留，请查看工具结果后继续。',
    toolResults,
  };
}
