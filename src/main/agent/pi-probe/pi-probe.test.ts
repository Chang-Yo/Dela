/**
 * Pi Agent Core 最小接入验证探针（docs/agent-workspace-plan.md §5.1）。
 * 用本地 mock OpenAI 兼容 SSE 服务实测关键路径；不含任何真实密钥或个人数据。
 * 各用例结论汇总见 docs/refactor/pi-integration-report.md。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentTool, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Model } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { MockOpenAiServer, mockFrames, type RecordedRequest } from './mock-openai-server';
import {
  buildOpenAiCompatibleModel,
  openAiCompatibleStreamFn,
  subscribeDelaCallbacks,
  textToolResult,
  Type,
  zodParameters,
} from './pi-runtime';

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
  stream_options?: { include_usage: boolean };
  messages?: ChatMessage[];
  tools?: { type: string; function: { name: string; parameters: Record<string, unknown> } }[];
  reasoning_effort?: string;
  thinking?: { type: string };
};
const bodyOf = (request: RecordedRequest) => request.body as ChatRequestBody;
const textOf = (message: AssistantMessage) =>
  message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

// ---------------------------------------------------------------- 工具与 Agent 装配

const echoParameters = Type.Object({ value: Type.String({ description: '要回显的文本' }) });
const echoExecutions: { toolCallId: string; value: string }[] = [];
const echoTool: AgentTool<typeof echoParameters> = {
  name: 'echo',
  label: '回显',
  description: '原样返回输入文本',
  parameters: echoParameters,
  async execute(toolCallId, params) {
    echoExecutions.push({ toolCallId, value: params.value });
    return textToolResult(JSON.stringify({ ok: true, echo: params }));
  },
};

const searchParameters = zodParameters(z.object({ query: z.string().describe('搜索词') }));
const searchExecutions: { query: string }[] = [];
const searchTool: AgentTool = {
  name: 'search_notes',
  label: '搜索笔记',
  description: '按关键词搜索笔记',
  parameters: searchParameters,
  async execute(_toolCallId, params) {
    const { query } = params as { query: string };
    searchExecutions.push({ query });
    return textToolResult(JSON.stringify({ ok: true, hits: [`${query}-命中`] }));
  },
};

const PROBE_KEY = 'probe-test-key';

let server: MockOpenAiServer;

function makeAgent(input: {
  tools?: AgentTool[];
  thinkingLevel?: ThinkingLevel;
  model?: Model<'openai-completions'>;
}): Agent {
  return new Agent({
    initialState: {
      systemPrompt: '你是测试助手',
      model:
        input.model ??
        buildOpenAiCompatibleModel({ baseUrl: server.baseUrl, modelId: 'probe-model' }),
      ...(input.tools ? { tools: input.tools } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    },
    streamFn: openAiCompatibleStreamFn,
    getApiKey: () => PROBE_KEY,
  });
}

// ---------------------------------------------------------------- 用例

describe('Pi Agent Core 接入探针', () => {
  beforeAll(async () => {
    server = await MockOpenAiServer.start();
  });

  afterAll(async () => {
    await server.close();
  });

  it('a. 流式文本增量：text_delta 顺序与累计文本、请求装配', async () => {
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.textDelta('你'),
        mockFrames.textDelta('好'),
        mockFrames.textDelta('！'),
        mockFrames.finishFrame('stop'),
        mockFrames.usageFrame(12, 3),
      ],
    });
    const agent = makeAgent({});
    const deltas: string[] = [];
    const texts: string[] = [];
    agent.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
        deltas.push(event.assistantMessageEvent.delta);
    });
    subscribeDelaCallbacks(agent, { onText: (text) => texts.push(text) });
    await agent.prompt('打个招呼');

    // Pi 的 text_delta 是增量；映射层为 Dela 还原为累计文本
    expect(deltas).toEqual(['你', '好', '！']);
    expect(texts).toEqual(['你', '你好', '你好！']);
    const last = agent.state.messages.at(-1) as AssistantMessage;
    expect(last.role).toBe('assistant');
    expect(last.stopReason).toBe('stop');
    expect(textOf(last)).toBe('你好！');
    expect(last.usage.output).toBe(3);
    expect(last.usage.input).toBe(12);

    // 请求装配：{baseUrl}/chat/completions、Bearer 密钥、模型 ID、system+user 消息
    const first = server.requests[0]!;
    expect(first.url).toBe('/v1/chat/completions');
    expect(first.authorization).toBe(`Bearer ${PROBE_KEY}`);
    const body = bodyOf(first);
    expect(body.model).toBe('probe-model');
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages?.[0]?.role).toBe('system');
    // 注意：Pi 对字符串 prompt 统一以 content parts 数组下发（非纯字符串），见报告限制清单
    expect(body.messages?.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: '打个招呼' }],
    });
  });

  it('b. 工具调用往返：执行、结果回灌、TypeBox 与 zod 参数两种装配', async () => {
    const before = server.requests.length;
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.toolCallDelta({ index: 0, id: 'call-echo-1', name: 'echo' }),
        mockFrames.toolCallDelta({ index: 0, arguments: '{"value":"wo' }),
        mockFrames.toolCallDelta({ index: 0, arguments: 'rld"}' }),
        mockFrames.finishFrame('tool_calls'),
      ],
    });
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.toolCallDelta({ index: 0, id: 'call-search-1', name: 'search_notes' }),
        mockFrames.toolCallDelta({ index: 0, arguments: '{"query":"pi"}' }),
        mockFrames.finishFrame('tool_calls'),
      ],
    });
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('两步都完成'), mockFrames.finishFrame('stop')],
    });
    const agent = makeAgent({ tools: [echoTool, searchTool] });
    const toolStarts: { id: string; name: string; input: unknown }[] = [];
    const toolResults: { id: string; name: string; input: unknown; output: unknown }[] = [];
    subscribeDelaCallbacks(agent, {
      onToolStart: (call) => toolStarts.push(call),
      onToolResult: (result) => toolResults.push(result),
    });
    await agent.prompt('先回显再搜索');

    // 自定义 AgentTool 真实执行，参数经 schema 校验
    expect(echoExecutions.at(-1)).toEqual({ toolCallId: 'call-echo-1', value: 'world' });
    expect(searchExecutions.at(-1)).toEqual({ query: 'pi' });
    expect(toolStarts.map(({ name, input }) => ({ name, input }))).toEqual([
      { name: 'echo', input: { value: 'world' } },
      { name: 'search_notes', input: { query: 'pi' } },
    ]);
    expect(toolResults.map(({ name }) => name)).toEqual(['echo', 'search_notes']);
    expect(toolResults[0]!.output).toBe(JSON.stringify({ ok: true, echo: { value: 'world' } }));

    // 工具声明：TypeBox 与 zod→JSON Schema 都以 function.parameters 下发
    const firstBody = bodyOf(server.requests[before]!);
    const wireTools = firstBody.tools ?? [];
    expect(wireTools.map((tool) => tool.function.name).sort()).toEqual(['echo', 'search_notes']);
    const echoWire = wireTools.find((tool) => tool.function.name === 'echo')!;
    expect(echoWire.function.parameters).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    });
    const searchWire = wireTools.find((tool) => tool.function.name === 'search_notes')!;
    expect(searchWire.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
    });

    // 回灌：assistant 携带 tool_calls，其后跟 role:'tool' 结果消息
    const secondBody = bodyOf(server.requests[before + 1]!);
    expect(secondBody.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [
          {
            id: 'call-echo-1',
            type: 'function',
            function: { name: 'echo', arguments: '{"value":"world"}' },
          },
        ],
      }),
      {
        role: 'tool',
        content: JSON.stringify({ ok: true, echo: { value: 'world' } }),
        tool_call_id: 'call-echo-1',
      },
    ]);
    const thirdBody = bodyOf(server.requests[before + 2]!);
    // 第三轮请求末尾：search 的工具结果消息回灌
    expect(thirdBody.messages?.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-search-1',
    });

    const last = agent.state.messages.at(-1) as AssistantMessage;
    expect(textOf(last)).toBe('两步都完成');
    // Dela 需要的工具结果在 Pi 侧落在 toolResult 消息与 tool_execution_end 事件里
    const toolResultMessages = agent.state.messages.filter(
      (message) => message.role === 'toolResult',
    );
    expect(toolResultMessages).toHaveLength(2);
  });

  it('c. 中途 abort：状态可读、已产出内容保留', async () => {
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.textDelta('已经生成到一半'),
        // 慢流：第二个增量前挂起，测试在收到第一个增量后 abort
        { data: { choices: [{ index: 0, delta: { content: '迟到内容' } }] }, delayMs: 8000 },
        mockFrames.finishFrame('stop'),
      ],
    });
    const agent = makeAgent({});
    let aborted = false;
    subscribeDelaCallbacks(agent, {
      onText: () => {
        if (!aborted) {
          aborted = true;
          agent.abort();
        }
      },
    });
    // 与自研 runAgent 不同：abort 后 prompt() 正常 resolve，不抛出
    await agent.prompt('慢慢回答');
    await agent.waitForIdle();

    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.errorMessage).toBeTruthy();
    const last = agent.state.messages.at(-1) as AssistantMessage;
    expect(last.role).toBe('assistant');
    expect(last.stopReason).toBe('aborted');
    expect(textOf(last)).toBe('已经生成到一半');
  });

  it('d. 错误路径：HTTP 500 与 429 以 error 事件表达，默认不自动重试', async () => {
    const before = server.requests.length;
    server.enqueue({
      kind: 'status',
      status: 500,
      json: { error: { message: 'mock internal error' } },
    });
    const agent500 = makeAgent({});
    await agent500.prompt('触发 500');
    const last500 = agent500.state.messages.at(-1) as AssistantMessage;
    expect(last500.stopReason).toBe('error');
    expect(last500.errorMessage).toContain('500');
    expect(agent500.state.errorMessage).toContain('500');

    server.enqueue({ kind: 'status', status: 429, json: { error: { message: 'rate limited' } } });
    const agent429 = makeAgent({});
    await agent429.prompt('触发 429');
    const last429 = agent429.state.messages.at(-1) as AssistantMessage;
    expect(last429.stopReason).toBe('error');
    expect(last429.errorMessage).toContain('429');
    // pi 默认 maxRetries=0：瞬时错误不会静默重试（重试由宿主决定）
    expect(server.requests.length - before).toBe(2);
  });

  it('e. 历史续接：从 JSON 持久化重建 initialState.messages 后携带完整上下文', async () => {
    // 依 docs/refactor/decisions-phase1.md 总裁决 2：不引入 Pi 的 SQLite Session 后端，
    // Pi 会话对象是 Run 生命周期内的内存执行态，从 Dela 持久历史（sessions.messages
    // JSON 列）重建。本用例以 JSON 序列化往返模拟该持久层，验证续接语义。
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.toolCallDelta({ index: 0, id: 'call-e-1', name: 'echo' }),
        mockFrames.toolCallDelta({ index: 0, arguments: '{"value":"历史"}' }),
        mockFrames.finishFrame('tool_calls'),
      ],
    });
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('第一答'), mockFrames.finishFrame('stop')],
    });
    const agent1 = makeAgent({ tools: [echoTool] });
    await agent1.prompt('第一问');

    // Dela 侧持久化形状：消息数组整体 JSON 序列化
    const reconstructed = JSON.parse(JSON.stringify(agent1.state.messages)) as AgentMessage[];

    // 第二段：全新 Agent 从持久历史重建 initialState，继续对话须能引用此前上下文
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('第二答'), mockFrames.finishFrame('stop')],
    });
    const model = buildOpenAiCompatibleModel({ baseUrl: server.baseUrl, modelId: 'probe-model' });
    const agent2 = new Agent({
      initialState: { messages: reconstructed, model, tools: [echoTool] },
      streamFn: openAiCompatibleStreamFn,
      getApiKey: () => PROBE_KEY,
    });
    await agent2.prompt('第二问');

    const request = server.requests.at(-1)!;
    const roles = bodyOf(request).messages?.map((message) => message.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
    const firstAnswer = bodyOf(request).messages?.find((message) => message.content === '第一答');
    expect(firstAnswer?.role).toBe('assistant');
    // 重建后的请求带上第一轮问答与工具结果：续接成立
    const restoredTool = bodyOf(request).messages?.find((message) => message.role === 'tool');
    expect(restoredTool?.tool_call_id).toBe('call-e-1');
    expect(restoredTool?.content).toContain('历史');
    expect(textOf(agent2.state.messages.at(-1) as AssistantMessage)).toBe('第二答');
  });

  it('f. DeepSeek 风格 provider：reasoning_content 增量与 reasoning_effort 映射', async () => {
    const before = server.requests.length;
    const model = buildOpenAiCompatibleModel({
      baseUrl: server.baseUrl,
      modelId: 'deepseek-reasoner',
      provider: 'deepseek',
      reasoning: true,
    });
    const agent = makeAgent({ model, thinkingLevel: 'high' });
    const reasoning: string[] = [];
    const texts: string[] = [];
    subscribeDelaCallbacks(agent, {
      onReasoning: (text) => reasoning.push(text),
      onText: (text) => texts.push(text),
    });
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.reasoningDelta('先想'),
        mockFrames.reasoningDelta('一想'),
        mockFrames.textDelta('答'),
        mockFrames.finishFrame('stop'),
        mockFrames.usageFrame(10, 5),
      ],
    });
    await agent.prompt('想一想');
    // reasoning_content 增量映射为 thinking 事件，Dela onReasoning 收到累计文本
    expect(reasoning).toEqual(['先想', '先想一想']);
    expect(texts).toEqual(['答']);
    const last = agent.state.messages.at(-1) as AssistantMessage;
    expect(last.content.map((block) => block.type)).toEqual(['thinking', 'text']);
    expect(last.usage.reasoning).toBe(0); // mock 未提供 reasoning_tokens 明细

    // thinkingLevel 'high' → DeepSeek compat：thinking:{type:enabled} + reasoning_effort
    const body1 = bodyOf(server.requests[before]!);
    expect(body1.reasoning_effort).toBe('high');
    expect(body1.thinking).toEqual({ type: 'enabled' });

    // 第二问：观察思考内容如何回灌（pi 对带 reasoning 签名的 thinking 块会原样回放）
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('继续'), mockFrames.finishFrame('stop')],
    });
    await agent.prompt('还有吗');
    const body2 = bodyOf(server.requests[before + 1]!);
    const assistant2 = body2.messages?.find((message) => message.role === 'assistant');
    expect(assistant2?.reasoning_content).toBe('先想一想');
    // 与 Dela 自研「不回传 reasoning」策略的差异：见验证报告限制清单
  });

  it('g. 图片消息：image_url content part 下发（多模态输入路径）', async () => {
    const model = buildOpenAiCompatibleModel({
      baseUrl: server.baseUrl,
      modelId: 'vision-probe',
      input: ['text', 'image'],
    });
    const agent = makeAgent({ model });
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('看到图片'), mockFrames.finishFrame('stop')],
    });
    const imageData = Buffer.from('probe-image-bytes').toString('base64');
    await agent.prompt('看图', [{ type: 'image', data: imageData, mimeType: 'image/png' }]);

    const user = bodyOf(server.requests.at(-1)!).messages?.at(-1);
    const parts = (user?.content as ChatPart[]) ?? [];
    expect(parts.some((part) => part.type === 'text' && part.text === '看图')).toBe(true);
    expect(
      parts.some(
        (part) =>
          part.type === 'image_url' && part.image_url?.url === `data:image/png;base64,${imageData}`,
      ),
    ).toBe(true);
    expect(textOf(agent.state.messages.at(-1) as AssistantMessage)).toBe('看到图片');
  });
});
