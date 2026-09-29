// 运行内修剪：transformContext 钩子按预算修剪较早工具结果，保留最近 2 轮完整；
// 不做运行中模型调用，也不影响会话状态。fetch 层走本地 mock 服务，不走真网。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  createToolResultPruner,
  estimateAgentMessageTokens,
  PRUNE_KEEP_CHARS,
  pruneToolResults,
} from '../pi';
import { runAgent } from '../run';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

const bigText = 'x'.repeat(40000);

function toolResult(name: string, text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: `call-${name}`,
    toolName: name,
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: Date.now(),
  };
}

function assistant(): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'c', name: 'read_resource', arguments: {} }],
    api: 'openai-completions',
    provider: 'dela-openai-compatible',
    model: 'm',
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
}

describe('pruneToolResults（单元）', () => {
  it('未超预算时原样返回', () => {
    const messages: AgentMessage[] = [
      { role: 'system', content: 'sys', timestamp: Date.now() },
      { role: 'user', content: '问', timestamp: Date.now() },
      assistant(),
      toolResult('a', '短结果'),
    ];
    expect(pruneToolResults(messages, { budget: 20480, keepChars: 100, keepRounds: 2 })).toBe(
      messages,
    );
  });

  it('超预算时修剪较早轮的工具结果，最近两轮保持完整', () => {
    const messages: AgentMessage[] = [
      { role: 'system', content: 'sys', timestamp: Date.now() },
      { role: 'user', content: '问', timestamp: Date.now() },
      assistant(),
      toolResult('r1', bigText),
      assistant(),
      toolResult('r2', bigText),
      assistant(),
      toolResult('r3', bigText),
      assistant(),
      toolResult('r4', bigText),
      assistant(),
      toolResult('r5', bigText),
    ];
    const pruned = pruneToolResults(messages, { budget: 25000, keepChars: 100, keepRounds: 2 });
    // 最近两轮（r4、r5）保持原文。
    const byName = (name: string) =>
      pruned.find(
        (message) => message.role === 'toolResult' && message.toolName === name,
      ) as Extract<AgentMessage, { role: 'toolResult' }>;
    expect(byName('r4').content[0]).toMatchObject({ type: 'text', text: bigText });
    expect(byName('r5').content[0]).toMatchObject({ type: 'text', text: bigText });
    // 较早轮替换为占位：含工具名、保留前缀字符数与关键结果前 100 字符。
    const placeholder = byName('r1').content[0] as { type: string; text: string };
    expect(placeholder.type).toBe('text');
    expect(placeholder.text).toContain('[已修剪的工具结果：r1，关键结果保留前 100 字符]');
    expect(placeholder.text).toContain(bigText.slice(0, 100));
    // 修剪后回到预算内。
    const total = pruned.reduce((sum, message) => sum + estimateAgentMessageTokens(message), 0);
    expect(total).toBeLessThanOrEqual(25000);
    // 原数组未被修改（transformContext 不得改会话状态）。
    expect(messages.find((m) => m.role === 'toolResult' && m.toolName === 'r1')).toMatchObject({
      content: [{ type: 'text', text: bigText }],
    });
  });

  it('修剪图片内容（占位为纯文本，图片 token 不再计入）', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: '问', timestamp: Date.now() },
      assistant(),
      {
        role: 'toolResult',
        toolCallId: 'c-img',
        toolName: 'read_resource',
        content: [
          { type: 'text', text: bigText },
          { type: 'image', mimeType: 'image/png', data: 'QUJD' },
        ],
        isError: false,
        timestamp: Date.now(),
      },
    ];
    const pruned = pruneToolResults(messages, { budget: 500, keepChars: 100, keepRounds: 0 });
    const message = pruned[2] as Extract<AgentMessage, { role: 'toolResult' }>;
    expect(message.content).toHaveLength(1);
    expect(message.content[0]!.type).toBe('text');
  });

  it('createToolResultPruner 使用缺省预算与保留字符数', async () => {
    const pruner = createToolResultPruner();
    const messages: AgentMessage[] = [
      assistant(),
      toolResult('r1', 'x'.repeat(PRUNE_KEEP_CHARS + 5)),
    ];
    // 未超缺省预算（20480）时原样返回。
    expect(await pruner(messages)).toBe(messages);
  });
});

describe('runAgent prunePolicy（集成）', () => {
  let server: MockOpenAiServer;

  beforeAll(async () => {
    server = await MockOpenAiServer.start();
  });

  afterAll(async () => {
    await server.close();
  });

  const readTool = {
    type: 'function' as const,
    function: {
      name: 'read_resource',
      description: '读取资源',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    },
  };
  const toolCallSse = (id: string) => ({
    kind: 'sse' as const,
    frames: [
      mockFrames.toolCallDelta({ index: 0, id, name: 'read_resource' }),
      mockFrames.toolCallDelta({ index: 0, arguments: '{"id":1}' }),
      mockFrames.finishFrame('tool_calls'),
    ],
  });
  const textSse = (text: string) => ({
    kind: 'sse' as const,
    frames: [mockFrames.textDelta(text), mockFrames.finishFrame('stop')],
  });

  it('多轮大工具结果：较早轮在后续请求中被修剪，最近两轮完整', async () => {
    const before = server.requests.length;
    // 四轮工具调用 + 最终文本。
    for (let round = 1; round <= 4; round += 1) server.enqueue(toolCallSse(`c-${round}`));
    server.enqueue(textSse('完成'));
    const result = await runAgent({
      baseUrl: server.baseUrl,
      model: 'test-model',
      key: 'test-only',
      messages: [
        { role: 'system', content: '你是测试助手' },
        { role: 'user', content: 'read' },
      ],
      tools: [readTool],
      signal: new AbortController().signal,
      execute: vi.fn().mockResolvedValue({ ok: true, result: bigText }),
      retryDelays: [],
      // 小预算：第 4 轮请求时总量超限，第 1 轮（较早于最近两轮）被修剪。
      // （每条工具结果回灌前已被截断到约 20000 字符 ≈ 5000 token。）
      prunePolicy: { budgetTokens: 11000 },
    });
    expect(result.content).toBe('完成');
    // 第 4 次请求携带前 3 轮工具结果：第 1 轮已修剪（最近两轮 c-2/c-3 完整）。
    const fourth = server.requests[before + 3]!.body as {
      messages: { role: string; tool_call_id?: string; content?: unknown }[];
    };
    const toolMessages = fourth.messages.filter((message) => message.role === 'tool');
    expect(toolMessages).toHaveLength(3);
    expect(String(toolMessages[0]!.content)).toContain('[已修剪的工具结果：read_resource');
    expect(String(toolMessages[1]!.content)).toContain(bigText.slice(0, 50));
    expect(String(toolMessages[2]!.content)).toContain(bigText.slice(0, 50));
    // 最终请求（第 5 次）中最近两轮保持完整、更早轮保持修剪后的形态。
    const fifth = server.requests[before + 4]!.body as {
      messages: { role: string; content?: unknown }[];
    };
    const fifthTools = fifth.messages.filter((message) => message.role === 'tool');
    expect(fifthTools).toHaveLength(4);
    expect(String(fifthTools[0]!.content)).toContain('已修剪的工具结果');
    expect(String(fifthTools[2]!.content)).not.toContain('已修剪的工具结果');
    expect(String(fifthTools[3]!.content)).not.toContain('已修剪的工具结果');
  });
});
