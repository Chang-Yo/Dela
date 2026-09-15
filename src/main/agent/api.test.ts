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
      callbacks.onToolStart?.('search_sources');
      expect(getChat('ordered').messages.at(-1)?.content).toBe('先查资料');
      callbacks.onToolResult?.(result);
      callbacks.onText?.('找到');
      callbacks.onText?.('找到资料，已完成');
      return { content: '找到资料，已完成', toolResults: [result] };
    });
    const chat = await ask('ordered', '查找资料', []);
    expect(chat.messages.at(-1)?.parts).toEqual([
      { type: 'text', text: '先查资料' },
      { type: 'tools', results: [result] },
      { type: 'text', text: '找到资料，已完成' },
    ]);
    expect(getChat('ordered').messages.at(-1)?.content).toBe('先查资料\n\n找到资料，已完成');
    expect(chat.messages.at(-1)?.finishedAt).toBeGreaterThanOrEqual(
      chat.messages.at(-1)!.startedAt!,
    );
  });
  it('preserves partial output and completed tools when interrupted', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onText?.('先查资料');
      callbacks.onToolStart?.('search_sources');
      callbacks.onToolResult?.(result);
      callbacks.onText?.('部分回答');
      throw new Error('取消');
    });
    await expect(ask('cancelled', '查找资料', [])).rejects.toThrow('取消');
    const reply = getChat('cancelled').messages.at(-1)!;
    expect(reply.content).toContain('部分回答');
    expect(reply.parts?.[1]).toEqual({ type: 'tools', results: [result] });
    expect(reply.interrupted).toBe(true);
    expect(getChat('cancelled').running).toBe(false);
    expect(getChat('cancelled').activeTool).toBeUndefined();
  });
});
