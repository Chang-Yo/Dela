import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from './loop';

afterEach(() => vi.unstubAllGlobals());
const answer = (message: unknown) =>
  new Response(JSON.stringify({ choices: [{ message }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
const call = (args = '{"id":1}') => ({
  content: null,
  tool_calls: [
    { id: 'call1', type: 'function', function: { name: 'read_resource', arguments: args } },
  ],
});
// SSE 流式响应：每个事件一行 data: 载荷，末尾补 [DONE] 结束流。
const stream = (payloads: unknown[]) =>
  new Response(
    [...payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`), 'data: [DONE]\n\n'].join(
      '',
    ),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
const delta = (partial: object) => ({ choices: [{ delta: partial }] });
const options = () => ({
  baseUrl: 'https://model.example.test/v1',
  model: 'test',
  key: 'test-only',
  messages: [{ role: 'user', content: 'read' }],
  tools: [],
  signal: new AbortController().signal,
  execute: vi.fn().mockResolvedValue({ ok: true, result: 'body' }),
  retryDelays: [0, 0],
});

describe('Agent loop', () => {
  it('feeds the matching tool result into the next model turn', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(answer(call()))
      .mockResolvedValueOnce(answer({ content: 'Done' }));
    vi.stubGlobal('fetch', fetcher);
    const input = options();
    const result = await runAgent(input);
    expect(input.execute).toHaveBeenCalledWith('read_resource', { id: 1 });
    expect(result.content).toBe('Done');
    // 端点由提供商配置拼接：{baseUrl}/chat/completions。
    expect(fetcher.mock.calls[0]![0]).toBe('https://model.example.test/v1/chat/completions');
    const second = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(second.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call1',
      content: JSON.stringify({ ok: true, result: 'body' }),
    });
    expect(result.toolResults).toHaveLength(1);
  });

  it('returns malformed arguments to the model without executing them', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(answer(call('invalid')))
        .mockResolvedValueOnce(answer({ content: 'Corrected' })),
    );
    const input = options();
    const result = await runAgent(input);
    expect(input.execute).not.toHaveBeenCalled();
    expect(result.toolResults[0]!.output).toMatchObject({
      ok: false,
      error: { code: 'INVALID_JSON' },
    });
  });

  it('honors cancellation before making a request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(runAgent({ ...options(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not repeat completed mutations when the next model request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(answer(call()))
        .mockResolvedValue(new Response('', { status: 503 })),
    );
    const input = options();
    const onToolResult = vi.fn();
    await expect(runAgent({ ...input, onToolResult })).rejects.toThrow('503');
    expect(input.execute).toHaveBeenCalledTimes(1);
    expect(onToolResult).toHaveBeenCalledTimes(1);
  });

  it('retries transient server errors without re-executing tools', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(answer({ content: 'Recovered' }));
    vi.stubGlobal('fetch', fetcher);
    const input = options();
    const result = await runAgent(input);
    expect(result.content).toBe('Recovered');
    expect(input.execute).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not retry permanent client errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(runAgent(options())).rejects.toThrow('400');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('streams reasoning_content deltas as accumulated onReasoning text', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          stream([
            delta({ reasoning_content: '想' }),
            delta({ reasoning_content: '一下' }),
            delta({ content: '答' }),
            delta({ content: '案' }),
          ]),
        ),
    );
    const onReasoning = vi.fn();
    const result = await runAgent({ ...options(), onReasoning });
    expect(onReasoning.mock.calls.map(([text]) => text)).toEqual(['想', '想一下']);
    expect(result.content).toBe('答案');
  });

  it('accepts OpenRouter-style reasoning deltas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(stream([delta({ reasoning: '思考' }), delta({ content: '回' })])),
    );
    const onReasoning = vi.fn();
    const result = await runAgent({ ...options(), onReasoning });
    expect(onReasoning).toHaveBeenCalledWith('思考');
    expect(result.content).toBe('回');
  });

  it('accumulates reasoning across rounds and never feeds reasoning back to the model', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        stream([
          delta({ reasoning_content: '第一轮思考' }),
          delta({ tool_calls: [{ index: 0, ...call().tool_calls[0] }] }),
        ]),
      )
      .mockResolvedValueOnce(
        stream([delta({ reasoning_content: '第二轮思考' }), delta({ content: '完成' })]),
      );
    vi.stubGlobal('fetch', fetcher);
    const onReasoning = vi.fn();
    const result = await runAgent({ ...options(), onReasoning });
    expect(onReasoning.mock.calls.map(([text]) => text)).toEqual([
      '第一轮思考',
      '第一轮思考\n\n第二轮思考',
    ]);
    expect(result.content).toBe('完成');
    // 回灌给模型的 assistant 消息不得携带 reasoning_content（DeepSeek 明确要求不回传）。
    const second = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(second.messages).toEqual([
      { role: 'user', content: 'read' },
      {
        role: 'assistant',
        content: '',
        tool_calls: call().tool_calls,
      },
      {
        role: 'tool',
        tool_call_id: 'call1',
        content: JSON.stringify({ ok: true, result: 'body' }),
      },
    ]);
  });
});
