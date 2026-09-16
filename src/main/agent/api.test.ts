import { describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  rows: new Map<string, { id: string; scope: string; messages: string }>(),
  run: vi.fn(),
}));
vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      get: (id: string) => fixtures.rows.get(id),
      run: (...args: string[]) => {
        if (sql.startsWith('INSERT'))
          fixtures.rows.set(args[0]!, { id: args[0]!, scope: args[1]!, messages: args[3]! });
        if (sql.startsWith('UPDATE')) fixtures.rows.get(args[2]!)!.messages = args[0]!;
      },
    }),
  }),
}));
vi.mock('../canvas/api', () => ({ readCanvasSource: vi.fn() }));
vi.mock('../workspace/api', () => ({ readWorkspaceEntry: vi.fn() }));
vi.mock('./providers', () => ({
  getActiveLlmProvider: () => ({
    name: 'fixture',
    baseUrl: 'https://example.test',
    model: 'fixture',
    models: [],
    apiKey: 'fixture',
  }),
}));
vi.mock('./tools', () => ({ modelToolDefinitions: () => [], executeAgentTool: vi.fn() }));
vi.mock('./loop', () => ({ runAgent: fixtures.run }));
import { ask, getChat } from './api';
import type { runAgent } from './loop';
type Callbacks = Parameters<typeof runAgent>[0];
const result = { id: 'tool', name: 'search_sources', input: {}, output: { ok: true } };

describe('persisted chat timeline', () => {
  it('retains commentary across model rounds and publishes it at tool start', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onText?.('先查');
      callbacks.onText?.('先查资料');
      callbacks.onToolStart?.({ id: 'tool', name: 'search_sources', input: { query: 'lab' } });
      // 工具开始时的持久化不丢此前流式输出的说明文字。
      expect(getChat('ordered').messages.at(-1)?.content).toBe('先查资料');
      // 开始即出现无输出的占位步骤：UI 能实时展示运行中的动作。
      const running = getChat('ordered').messages.at(-1)?.parts?.at(-1);
      expect(running).toMatchObject({
        type: 'tools',
        results: [{ id: 'tool', name: 'search_sources', input: { query: 'lab' } }],
      });
      expect(running && running.type === 'tools' && running.results[0]?.output).toBeUndefined();
      callbacks.onToolResult?.(result);
      callbacks.onText?.('找到');
      callbacks.onText?.('找到资料，已完成');
      return { content: '找到资料，已完成', toolResults: [result] };
    });
    const chat = await ask('ordered', '查找资料', []);
    const parts = chat.messages.at(-1)?.parts!;
    expect(parts[0]).toEqual({ type: 'text', text: '先查资料' });
    expect(parts[1]?.type).toBe('tools');
    const step = parts[1]!.type === 'tools' ? parts[1]!.results[0]! : null;
    expect(step).toMatchObject({
      id: 'tool',
      name: 'search_sources',
      input: {},
      output: { ok: true },
    });
    expect(step!.startedAt).toBeGreaterThan(0);
    expect(step!.finishedAt).toBeGreaterThanOrEqual(step!.startedAt!);
    expect(parts[2]).toEqual({ type: 'text', text: '找到资料，已完成' });
    expect(getChat('ordered').messages.at(-1)?.content).toBe('先查资料\n\n找到资料，已完成');
    expect(chat.messages.at(-1)?.finishedAt).toBeGreaterThanOrEqual(
      chat.messages.at(-1)!.startedAt!,
    );
  });
  it('preserves partial output and completed tools when interrupted', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onText?.('先查资料');
      callbacks.onToolStart?.({ id: 'tool', name: 'search_sources', input: {} });
      callbacks.onToolResult?.(result);
      callbacks.onText?.('部分回答');
      throw new Error('取消');
    });
    await expect(ask('cancelled', '查找资料', [])).rejects.toThrow('取消');
    const reply = getChat('cancelled').messages.at(-1)!;
    expect(reply.content).toContain('部分回答');
    const group = reply.parts?.[1];
    expect(group?.type === 'tools' && group.results[0]).toMatchObject({
      id: 'tool',
      name: 'search_sources',
      output: { ok: true },
      startedAt: expect.any(Number),
      finishedAt: expect.any(Number),
    });
    expect(reply.interrupted).toBe(true);
    expect(getChat('cancelled').running).toBe(false);
    expect(getChat('cancelled').activeTool).toBeUndefined();
  });
  it('keeps the started placeholder unfinished when cancelled mid-tool', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onToolStart?.({ id: 'pending', name: 'search_mail', input: { query: '成绩' } });
      throw new Error('取消');
    });
    await expect(ask('mid-tool', '查邮件', [])).rejects.toThrow('取消');
    // 中断文案追加在占位步骤之后；未完成的步骤保留 startedAt、没有输出。
    const group = getChat('mid-tool').messages.at(-1)?.parts?.[0];
    expect(group?.type === 'tools' && group.results[0]).toMatchObject({
      id: 'pending',
      name: 'search_mail',
      startedAt: expect.any(Number),
    });
    expect(group && group.type === 'tools' && group.results[0]?.output).toBeUndefined();
  });
  it('keeps reasoning separate from the public content', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onReasoning?.('先分析请求');
      callbacks.onReasoning?.('先分析请求，再规划工具');
      callbacks.onText?.('回答正文');
      return { content: '回答正文', toolResults: [] };
    });
    const chat = await ask('reasoning', '问题', []);
    const reply = chat.messages.at(-1)!;
    const reasoning = reply.parts?.[0];
    expect(reasoning).toMatchObject({
      type: 'reasoning',
      text: '先分析请求，再规划工具',
      startedAt: expect.any(Number),
      finishedAt: expect.any(Number),
    });
    expect(reply.parts?.[1]).toEqual({ type: 'text', text: '回答正文' });
    // 思考不进入公开正文：复制、保存笔记与回灌模型的上下文都不包含它。
    expect(reply.content).toBe('回答正文');
  });
  it('closes unfinished reasoning when the run is interrupted mid-thought', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onReasoning?.('想了一半');
      throw new Error('取消');
    });
    await expect(ask('mid-thought', '问题', [])).rejects.toThrow('取消');
    const reasoning = getChat('mid-thought').messages.at(-1)?.parts?.[0];
    expect(reasoning).toMatchObject({ type: 'reasoning', text: '想了一半' });
    expect(reasoning?.type === 'reasoning' && reasoning.finishedAt).toBeGreaterThan(0);
  });
});
