import { z } from 'zod';
import type { AgentToolResult } from '../../shared/api';

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
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
) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const message = completionSchema.parse(await response.json()).choices[0]!.message;
    onText?.(message.content ?? '');
    return message;
  }
  if (!response.body) throw new Error('模型没有返回响应流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '',
    content = '',
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

export async function runAgent(options: {
  model: string;
  key: string;
  messages: { role: string; content: string }[];
  tools: unknown[];
  signal: AbortSignal;
  execute: (name: string, input: unknown) => Promise<unknown>;
  onToolResult?: (result: AgentToolResult) => void;
  onToolStart?: (name: string) => void;
  onText?: (text: string) => void;
}) {
  const messages: unknown[] = [...options.messages];
  const toolResults: AgentToolResult[] = [];
  // A bounded foreground run; reaching the limit reports partial work rather than retrying mutations.
  for (let round = 0; round < 12; round += 1) {
    options.signal.throwIfAborted();
    const response = await fetch('https://models.sjtu.edu.cn/api/v1/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: options.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.key}` },
      body: JSON.stringify({
        model: options.model,
        messages,
        tools: options.tools,
        stream: true,
        max_tokens: 4096,
      }),
    });
    if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
    const message = await readCompletion(response, options.signal, options.onText);
    if (!message.tool_calls?.length) return { content: message.content ?? '', toolResults };
    messages.push({ role: 'assistant', ...message });
    for (const call of message.tool_calls) {
      options.signal.throwIfAborted();
      options.onToolStart?.(call.function.name);
      let input: unknown;
      let output: unknown;
      try {
        input = JSON.parse(call.function.arguments);
      } catch {
        output = { ok: false, error: { code: 'INVALID_JSON', message: '工具参数必须是有效 JSON' } };
      }
      if (output === undefined) output = await options.execute(call.function.name, input);
      const result = { id: call.id, name: call.function.name, input, output };
      toolResults.push(result);
      options.onToolResult?.(result);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return {
    content: '已达到本次执行步数上限。已完成的操作保留，请查看工具结果后继续。',
    toolResults,
  };
}
