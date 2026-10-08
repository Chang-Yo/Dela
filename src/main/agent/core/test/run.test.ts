import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAgent, type ChatContentPart } from '../run';
import { MockOpenAiServer, mockFrames, type RecordedRequest } from './mock-openai-server';

type ChatPart = { type: string; text?: string; image_url?: { url: string } };
type ChatMessage = {
  role: string;
  content: unknown;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  reasoning_content?: string;
};
type ChatRequestBody = {
  model?: string;
  stream?: boolean;
  store?: boolean;
  messages?: ChatMessage[];
  tools?: { type: string; function: { name: string; parameters: Record<string, unknown> } }[];
  reasoning_effort?: string;
  max_tokens?: number;
  max_completion_tokens?: number;
};
const bodyOf = (request: RecordedRequest) => request.body as ChatRequestBody;
const NUDGE =
  '已接近本次执行步数上限，请直接总结已完成的工作并给出最终回答，不要发起新的工具调用。';

const readTool = {
  type: 'function' as const,
  function: {
    name: 'read_resource',
    description: '读取资源',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number', description: '资源 ID' } },
      required: ['id'],
    },
  },
};

let server: MockOpenAiServer;

const makeOptions = () => ({
  baseUrl: server.baseUrl,
  model: 'test-model',
  key: 'test-only',
  messages: [
    { role: 'system', content: '你是测试助手' },
    { role: 'user', content: 'read' },
  ],
  tools: [readTool],
  signal: new AbortController().signal,
  execute: vi.fn().mockResolvedValue({ ok: true, result: 'body' }),
  // 默认不重试：错误分支要么断言单次失败，要么显式传入 0 延迟退避。
  retryDelays: [] as number[],
});

/** 一轮工具调用响应：按 index 聚合的 name + arguments 分片，finish 为 tool_calls。 */
const toolCallSse = (id: string, name = 'read_resource', args = '{"id":1}') => ({
  kind: 'sse' as const,
  frames: [
    mockFrames.toolCallDelta({ index: 0, id, name }),
    mockFrames.toolCallDelta({ index: 0, arguments: args }),
    mockFrames.finishFrame('tool_calls'),
  ],
});
const textSse = (text: string) => ({
  kind: 'sse' as const,
  frames: [mockFrames.textDelta(text), mockFrames.finishFrame('stop')],
});

describe('runAgent（Pi Agent Core 桥）', () => {
  beforeAll(async () => {
    server = await MockOpenAiServer.start();
  });

  afterAll(async () => {
    await server.close();
  });

  it('a. 流式文本：onText 收到本轮累计文本，请求装配带模型与输出上限', async () => {
    const before = server.requests.length;
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.textDelta('你'),
        mockFrames.textDelta('好'),
        mockFrames.textDelta('！'),
        mockFrames.finishFrame('stop'),
      ],
    });
    const onText = vi.fn();
    const result = await runAgent({ ...makeOptions(), onText });
    expect(onText.mock.calls.map(([text]) => text)).toEqual(['你', '你好', '你好！']);
    expect(result.content).toBe('你好！');
    expect(result.toolResults).toEqual([]);
    const first = server.requests[before]!;
    expect(first.url).toBe('/v1/chat/completions');
    expect(first.authorization).toBe('Bearer test-only');
    const body = bodyOf(first);
    expect(body.model).toBe('test-model');
    expect(body.stream).toBe(true);
    expect(body.messages?.[0]?.role).toBe('system');
    expect(body.messages?.at(-1)?.role).toBe('user');
    // 未开启推理强度时不携带 reasoning_effort；输出上限按 streamFn 包装注入。
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_completion_tokens).toBe(128000);
  });

  it('effort 档位随每个请求下发，none 视为关闭不下发', async () => {
    // 每用例独立捕获：共享 requests 数组的按位切片在冷启动等场景下可能混入相邻用例
    // 的在途请求（曾致 reasoning_effort 偶发实收 undefined）。
    const withHigh: RecordedRequest[] = [];
    const stopHighCapture = server.onRequest((request) => withHigh.push(request));
    server.enqueue(toolCallSse('call-effort'));
    server.enqueue(textSse('Done'));
    await runAgent({ ...makeOptions(), effort: 'high' });
    stopHighCapture();
    expect(withHigh.length).toBeGreaterThan(0);
    for (const request of withHigh) {
      expect(bodyOf(request).reasoning_effort).toBe('high');
      expect(bodyOf(request).max_completion_tokens).toBe(128000);
    }
    const withNone: RecordedRequest[] = [];
    const stopNoneCapture = server.onRequest((request) => withNone.push(request));
    server.enqueue(textSse('Quiet'));
    await runAgent({ ...makeOptions(), effort: 'none' });
    stopNoneCapture();
    expect(withNone).toHaveLength(1);
    expect(bodyOf(withNone[0]!).reasoning_effort).toBeUndefined();
  });

  it('b. 工具往返：入参已解析、结果以 JSON 回灌、事件形状对齐持久化层', async () => {
    const before = server.requests.length;
    server.enqueue(toolCallSse('call1'));
    server.enqueue(textSse('Done'));
    const input = makeOptions();
    const onToolStart = vi.fn();
    const onToolResult = vi.fn();
    const result = await runAgent({ ...input, onToolStart, onToolResult });
    // 开始执行即收到解析后的输入：时间线可以先行展示动作摘要。
    expect(onToolStart).toHaveBeenCalledWith({
      id: 'call1',
      name: 'read_resource',
      input: { id: 1 },
    });
    expect(input.execute).toHaveBeenCalledWith(
      'read_resource',
      { id: 1 },
      expect.objectContaining({ signal: expect.any(AbortSignal), onUpdate: expect.any(Function) }),
    );
    expect(result.content).toBe('Done');
    // 工具声明：JSON Schema 原样进入 function.parameters。
    const first = bodyOf(server.requests[before]!);
    expect(first.tools?.[0]?.function).toMatchObject({ name: 'read_resource' });
    expect(first.tools?.[0]?.function.parameters).toMatchObject({
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    });
    // 回灌：assistant 携带 tool_calls，其后跟 role:'tool' 的结果消息。
    const second = bodyOf(server.requests[before + 1]!);
    const toolMessage = second.messages?.find((message) => message.role === 'tool');
    expect(toolMessage).toMatchObject({
      role: 'tool',
      tool_call_id: 'call1',
      content: JSON.stringify({ ok: true, result: 'body' }),
    });
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      id: 'call1',
      name: 'read_resource',
      input: { id: 1 },
      output: { ok: true, result: 'body' },
    });
    expect(onToolResult).toHaveBeenCalledWith(result.toolResults[0]);
  });

  it('b. 非法工具参数不执行，以 INVALID_INPUT 外壳回灌模型', async () => {
    server.enqueue(toolCallSse('call-bad', 'read_resource', '{}'));
    server.enqueue(textSse('Corrected'));
    const input = makeOptions();
    const result = await runAgent(input);
    expect(input.execute).not.toHaveBeenCalled();
    expect(result.toolResults[0]!.output).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    const toolMessage = bodyOf(server.requests.at(-1)!).messages!.find(
      (message) => message.role === 'tool',
    )!;
    expect(String(toolMessage.content)).toContain('Validation failed');
  });

  it('b. 未知工具名映射为 UNKNOWN_TOOL 外壳', async () => {
    server.enqueue(toolCallSse('call-unknown', 'nonexistent', '{}'));
    server.enqueue(textSse('Fine'));
    const input = makeOptions();
    const result = await runAgent(input);
    expect(input.execute).not.toHaveBeenCalled();
    expect(result.toolResults[0]!.output).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_TOOL' },
    });
  });

  it('b. 工具页图像经合成 user 消息附出，工具结果与持久化输出只留元数据', async () => {
    server.enqueue(toolCallSse('call-img'));
    server.enqueue(textSse('Seen'));
    const input = makeOptions();
    input.execute.mockResolvedValueOnce({
      ok: true,
      result: {
        title: 'Scan.pdf',
        pageImages: [{ page: 1 }],
        images: [{ page: 1, dataUrl: 'data:image/jpeg;base64,QUJD' }],
      },
    });
    const onToolResult = vi.fn();
    const result = await runAgent({ ...input, onToolResult });
    expect(result.content).toBe('Seen');
    const second = bodyOf(server.requests.at(-1)!);
    const toolMessage = second.messages!.find((message) => message.role === 'tool')!;
    expect(String(toolMessage.content)).not.toContain('data:image');
    expect(String(toolMessage.content)).toContain('【read_resource 附图】《Scan.pdf》第 1 页');
    expect(JSON.stringify(onToolResult.mock.calls[0]![0].output)).not.toContain('data:image');
    // 页图像走标准多模态 parts：以合成 user 消息附在工具结果之后。
    const attachment = second.messages!.at(-1)!;
    expect(attachment.role).toBe('user');
    const parts = attachment.content as ChatPart[];
    expect(
      parts.some(
        (part) =>
          part.type === 'image_url' && part.image_url?.url === 'data:image/jpeg;base64,QUJD',
      ),
    ).toBe(true);
  });

  it('b. 附图按每运行 12 张封顶并提示余量', async () => {
    server.enqueue(toolCallSse('call-big'));
    server.enqueue(textSse('Enough'));
    const input = makeOptions();
    input.execute.mockResolvedValueOnce({
      ok: true,
      result: {
        title: 'Big.pdf',
        images: Array.from({ length: 13 }, (_, index) => ({
          page: index + 1,
          dataUrl: `data:image/jpeg;base64,${index}`,
        })),
      },
    });
    await runAgent(input);
    const second = bodyOf(server.requests.at(-1)!);
    const attachment = second.messages!.at(-1)!;
    expect(attachment.role).toBe('user');
    expect(
      (attachment.content as ChatPart[]).filter((part) => part.type === 'image_url'),
    ).toHaveLength(12);
    const toolMessage = second.messages!.find((message) => message.role === 'tool')!;
    expect(String(toolMessage.content)).toContain('上限');
  });

  it('b. 超长工具结果回灌时截断，持久化输出保留全文', async () => {
    server.enqueue(toolCallSse('call-large'));
    server.enqueue(textSse('Ok'));
    const input = makeOptions();
    input.execute.mockResolvedValueOnce({ ok: true, result: 'x'.repeat(21000) });
    const onToolResult = vi.fn();
    await runAgent({ ...input, onToolResult });
    const toolMessage = bodyOf(server.requests.at(-1)!).messages!.find(
      (message) => message.role === 'tool',
    )!;
    const fedBack = String(toolMessage.content);
    expect(fedBack.length).toBeLessThanOrEqual(21000);
    expect(fedBack).toContain('结果过大已截断');
    expect((onToolResult.mock.calls[0]![0].output as { result: string }).result).toHaveLength(
      21000,
    );
  });

  it('c. 用户中途 abort：runAgent 抛出，已产出内容已回调', async () => {
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.textDelta('部分回答'),
        // 慢流：第二个增量前挂起，收到第一个增量后取消。
        { data: { choices: [{ index: 0, delta: { content: '迟到内容' } }] }, delayMs: 8000 },
        mockFrames.finishFrame('stop'),
      ],
    });
    const controller = new AbortController();
    const onText = vi.fn((text: string) => {
      if (text === '部分回答') controller.abort();
    });
    // abort 以异常形式抛出（manager 靠 catch + signal.aborted 判断 stopped）。
    await expect(
      runAgent({ ...makeOptions(), signal: controller.signal, onText }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(onText).toHaveBeenCalledWith('部分回答');
  });

  it('c. 请求发出前已取消则直接抛出，不发请求', async () => {
    const before = server.requests.length;
    await expect(runAgent({ ...makeOptions(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(server.requests.length).toBe(before);
  });

  it('d. 永久性客户端错误不重试，抛出含状态码的中文错误', async () => {
    const before = server.requests.length;
    server.enqueue({
      kind: 'status',
      status: 400,
      json: { error: { message: 'bad request' } },
    });
    await expect(runAgent(makeOptions())).rejects.toThrow('模型请求失败（HTTP 400）');
    expect(server.requests.length - before).toBe(1);
  });

  it('d. 429/5xx 瞬时错误按退避重试后恢复，不重复执行工具', async () => {
    const before = server.requests.length;
    server.enqueue({ kind: 'status', status: 503 });
    server.enqueue({ kind: 'status', status: 429 });
    server.enqueue(textSse('Recovered'));
    const result = await runAgent({ ...makeOptions(), retryDelays: [0, 0] });
    expect(result.content).toBe('Recovered');
    expect(server.requests.length - before).toBe(3);
  });

  it('d. 重试耗尽后抛出，仍含状态码', async () => {
    const before = server.requests.length;
    server.enqueue({ kind: 'status', status: 429 });
    server.enqueue({ kind: 'status', status: 429 });
    server.enqueue({ kind: 'status', status: 429 });
    await expect(runAgent({ ...makeOptions(), retryDelays: [0, 0] })).rejects.toThrow(
      '模型请求失败（HTTP 429）',
    );
    expect(server.requests.length - before).toBe(3);
  });

  it('d. 工具完成后的下一轮请求失败不重复执行已完成变更', async () => {
    server.enqueue(toolCallSse('call-mid'));
    server.enqueue({ kind: 'status', status: 503 });
    const input = makeOptions();
    const onToolResult = vi.fn();
    await expect(runAgent({ ...input, onToolResult })).rejects.toThrow('模型请求失败（HTTP 503）');
    expect(input.execute).toHaveBeenCalledTimes(1);
    expect(onToolResult).toHaveBeenCalledTimes(1);
  });

  it('e. max_tokens 被拒时降参到 8192 重发', async () => {
    const before = server.requests.length;
    server.enqueue({
      kind: 'status',
      status: 400,
      json: {
        error: { message: 'max_completion_tokens must be less than or equal to 8192' },
      },
    });
    server.enqueue(textSse('Done'));
    const result = await runAgent(makeOptions());
    expect(result.content).toBe('Done');
    expect(bodyOf(server.requests[before]!).max_completion_tokens).toBe(128000);
    expect(bodyOf(server.requests[before + 1]!).max_completion_tokens).toBe(8192);
    expect(server.requests.length - before).toBe(2);
  });

  it('e. 降参后仍被拒则失败，不再无限降级', async () => {
    const before = server.requests.length;
    server.enqueue({
      kind: 'status',
      status: 400,
      json: { error: { message: 'max_completion_tokens is too large' } },
    });
    server.enqueue({
      kind: 'status',
      status: 400,
      json: { error: { message: 'max_completion_tokens is too large' } },
    });
    await expect(runAgent(makeOptions())).rejects.toThrow('模型请求失败（HTTP 400）');
    expect(server.requests.length - before).toBe(2);
  });

  it('f. 思考增量按轮回调，回灌请求不携带 reasoning_content（L1 剥离）', async () => {
    const before = server.requests.length;
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.reasoningDelta('第一轮思考'),
        mockFrames.toolCallDelta({ index: 0, id: 'call-f', name: 'read_resource' }),
        mockFrames.toolCallDelta({ index: 0, arguments: '{"id":1}' }),
        mockFrames.finishFrame('tool_calls'),
      ],
    });
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.reasoningDelta('第二轮思考'),
        mockFrames.textDelta('完成'),
        mockFrames.finishFrame('stop'),
      ],
    });
    const onReasoning = vi.fn();
    const result = await runAgent({ ...makeOptions(), onReasoning });
    expect(onReasoning.mock.calls.map(([text]) => text)).toEqual(['第一轮思考', '第二轮思考']);
    expect(result.content).toBe('完成');
    const second = bodyOf(server.requests[before + 1]!);
    const assistant = second.messages!.find((message) => message.role === 'assistant')!;
    // 回灌给模型的 assistant 消息不得携带 reasoning_content（DeepSeek 明确要求不回传）。
    expect(assistant.reasoning_content).toBeUndefined();
    expect(assistant.tool_calls).toMatchObject([
      { id: 'call-f', type: 'function', function: { name: 'read_resource' } },
    ]);
  });

  it('f2. 同一消息内思考与正文增量交错：回调按消息累计（分段合并由会话层负责）', async () => {
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.reasoningDelta('第一段思考'),
        mockFrames.textDelta('中间正文'),
        mockFrames.reasoningDelta('第二段思考'),
        mockFrames.textDelta('最终回答'),
        mockFrames.finishFrame('stop'),
      ],
    });
    const onText = vi.fn();
    const onReasoning = vi.fn();
    const result = await runAgent({ ...makeOptions(), onText, onReasoning });
    // pi-ai 每条消息只产出一个思考块与一个正文块，交错增量按通道并入同一块：
    // 回调必须携带消息内累计文本；若按通道切换清零，会切碎块并丢失前半段正文。
    expect(onReasoning.mock.calls.map(([text]) => text)).toEqual([
      '第一段思考',
      '第一段思考第二段思考',
    ]);
    expect(onText.mock.calls.map(([text]) => text)).toEqual(['中间正文', '中间正文最终回答']);
    expect(result.content).toBe('中间正文最终回答');
  });

  it('g. 末轮前注入收尾提示，末轮仍调工具则按上限结束', async () => {
    const before = server.requests.length;
    for (let round = 1; round <= 50; round += 1) {
      server.enqueue(toolCallSse(`call-${round}`));
    }
    const input = makeOptions();
    const result = await runAgent(input);
    expect(server.requests.length - before).toBe(50);
    // 前面的轮次没有提示；末轮请求在工具结果之后带收尾提示 user 消息。
    for (let index = 0; index < 49; index += 1) {
      const messages = bodyOf(server.requests[before + index]!).messages!;
      expect(messages.some((message) => message.role === 'user' && message.content === NUDGE)).toBe(
        false,
      );
    }
    const final = bodyOf(server.requests[before + 49]!).messages!;
    expect(final.some((message) => message.role === 'user' && message.content === NUDGE)).toBe(
      true,
    );
    // 末轮的工具调用仍执行（结果保留），随后以上限文案收尾。
    expect(input.execute).toHaveBeenCalledTimes(50);
    expect(result.toolResults).toHaveLength(50);
    expect(result.content).toBe('已达到本次执行步数上限。已完成的操作保留，请查看工具结果后继续。');
  });

  it('g. 末轮不再调用工具则正常返回该轮回答', async () => {
    const before = server.requests.length;
    for (let round = 1; round <= 49; round += 1) {
      server.enqueue(toolCallSse(`call-final-${round}`));
    }
    server.enqueue(textSse('总结收尾'));
    const result = await runAgent(makeOptions());
    expect(server.requests.length - before).toBe(50);
    expect(result.content).toBe('总结收尾');
  });

  it('末轮输出被长度上限截断时按旧语义报错', async () => {
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('半截回答'), mockFrames.finishFrame('length')],
    });
    await expect(runAgent(makeOptions())).rejects.toThrow('模型输出达到长度限制');
  });

  it('携带重建的历史消息上下文', async () => {
    const before = server.requests.length;
    server.enqueue(textSse('第二答'));
    const result = await runAgent({
      ...makeOptions(),
      messages: [
        { role: 'system', content: '你是测试助手' },
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' },
        { role: 'user', content: '第二问' },
      ],
    });
    expect(result.content).toBe('第二答');
    const roles = bodyOf(server.requests[before]!).messages!.map((message) => message.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('用户消息里的内联图片以多模态 parts 下发', async () => {
    const before = server.requests.length;
    server.enqueue(textSse('看到图片'));
    const content: ChatContentPart[] = [
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ];
    await runAgent({
      ...makeOptions(),
      messages: [
        { role: 'system', content: '你是测试助手' },
        { role: 'user', content },
      ],
    });
    const user = bodyOf(server.requests[before]!).messages!.at(-1)!;
    const parts = user.content as ChatPart[];
    expect(parts.some((part) => part.type === 'text' && part.text === '看图')).toBe(true);
    expect(
      parts.some(
        (part) => part.type === 'image_url' && part.image_url?.url === 'data:image/png;base64,QUJD',
      ),
    ).toBe(true);
  });
});
