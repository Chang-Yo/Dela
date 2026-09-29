/**
 * Pi 集成面（core/pi.ts）的桥层断言：Model 构造、compat 自动检测、streamFn 的
 * maxTokens 注入与档位映射、思考剥离。runAgent 的行为契约见 run.test.ts。
 * 迁移自阶段一探针（docs/refactor/pi-integration-report.md §3 的有用断言）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { buildPiModel, createDelaStreamFn, stripThinking } from '../pi';
import { MockOpenAiServer, mockFrames, type RecordedRequest } from './mock-openai-server';

type ChatMessage = { role: string; content: unknown; reasoning_content?: string };
type ChatRequestBody = {
  store?: boolean;
  stream_options?: { include_usage: boolean };
  messages?: ChatMessage[];
  reasoning_effort?: string;
  thinking?: { type: string };
  max_tokens?: number;
  max_completion_tokens?: number;
};
const bodyOf = (request: RecordedRequest) => request.body as ChatRequestBody;
const textOf = (message: AssistantMessage) =>
  message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

const PI_TEST_KEY = 'pi-test-key';

let server: MockOpenAiServer;

function makeAgent(input: {
  modelId?: string;
  provider?: string;
  reasoning?: boolean;
  thinkingLevel?: 'high' | 'max';
  thinkingLevelMap?: Record<string, string | null>;
}) {
  return new Agent({
    initialState: {
      systemPrompt: '你是测试助手',
      model: buildPiModel({
        baseUrl: server.baseUrl,
        modelId: input.modelId ?? 'test-model',
        ...(input.provider ? { provider: input.provider } : {}),
        reasoning: input.reasoning ?? false,
        ...(input.thinkingLevelMap ? { thinkingLevelMap: input.thinkingLevelMap } : {}),
      }),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    },
    streamFn: createDelaStreamFn({ retryDelays: [] }),
    getApiKey: () => PI_TEST_KEY,
    convertToLlm: stripThinking,
  });
}

describe('Pi 桥层（buildPiModel + createDelaStreamFn + stripThinking）', () => {
  beforeAll(async () => {
    server = await MockOpenAiServer.start();
  });

  afterAll(async () => {
    await server.close();
  });

  it('通用 OpenAI 兼容 provider：请求装配与输出上限注入', async () => {
    const before = server.requests.length;
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.textDelta('你好'),
        mockFrames.finishFrame('stop'),
        mockFrames.usageFrame(12, 3),
      ],
    });
    const agent = makeAgent({});
    await agent.prompt('打个招呼');
    const body = bodyOf(server.requests[before]!);
    expect(body.store).toBe(false);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages?.[0]?.role).toBe('system');
    // 未知 baseUrl 走 OpenAI 默认 compat：max_completion_tokens 字段 + 注入的 32768 上限。
    expect(body.max_completion_tokens).toBe(32768);
    expect(body.max_tokens).toBeUndefined();
    // usage 从流末帧解析。
    const last = agent.state.messages.at(-1) as AssistantMessage;
    expect(textOf(last)).toBe('你好');
    expect(last.usage.input).toBe(12);
    expect(last.usage.output).toBe(3);
  });

  it('DeepSeek 风格 provider：thinking/reasoning_effort/max_tokens 命中 compat 检测', async () => {
    const before = server.requests.length;
    const agent = makeAgent({
      modelId: 'deepseek-reasoner',
      provider: 'deepseek',
      reasoning: true,
      thinkingLevel: 'high',
    });
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.reasoningDelta('先想'),
        mockFrames.reasoningDelta('一想'),
        mockFrames.textDelta('答'),
        mockFrames.finishFrame('stop'),
      ],
    });
    await agent.prompt('想一想');
    const body = bodyOf(server.requests[before]!);
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('high');
    // DeepSeek 检测使用 max_tokens 字段（而非 max_completion_tokens）。
    expect(body.max_tokens).toBe(32768);
    expect(body.max_completion_tokens).toBeUndefined();
    const last = agent.state.messages.at(-1) as AssistantMessage;
    expect(last.content.map((block) => block.type)).toEqual(['thinking', 'text']);

    // 第二问：stripThinking 剥离思考块，回灌只剩 DeepSeek compat 要求的空 reasoning_content。
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('继续'), mockFrames.finishFrame('stop')],
    });
    await agent.prompt('还有吗');
    const second = bodyOf(server.requests[before + 1]!);
    const assistant = second.messages!.find((message) => message.role === 'assistant')!;
    expect(assistant.reasoning_content).toBe('');
    expect(textOf(agent.state.messages.at(-1) as AssistantMessage)).toBe('继续');
  });

  it('扩展档位经 thinkingLevelMap 原样下发，不被压到 high', async () => {
    const before = server.requests.length;
    const agent = makeAgent({
      modelId: 'glm-test',
      reasoning: true,
      thinkingLevel: 'max',
      // Dela 超集里的 ultra 档：挂到 Pi 的 max 档并映射回原名。
      thinkingLevelMap: { max: 'ultra' },
    });
    server.enqueue({
      kind: 'sse',
      frames: [mockFrames.textDelta('答'), mockFrames.finishFrame('stop')],
    });
    await agent.prompt('想一想');
    expect(bodyOf(server.requests[before]!).reasoning_effort).toBe('ultra');
  });
});
