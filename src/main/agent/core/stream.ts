import { z } from 'zod';

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          // 思考过程放在非标准字段；读到仅用于上报展示，回灌模型时必须剔除（DeepSeek 明确要求不回传）。
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

export async function readCompletion(
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
