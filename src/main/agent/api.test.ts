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
vi.mock('./media', () => ({
  readChatAttachment: vi.fn((id: string) => ({
    name: `附件-${id.slice(0, 4)}.md`,
    bytes: Buffer.from('# 附件内容'),
  })),
  readChatMediaBytes: vi.fn(() => Buffer.from('pngbytes')),
  releaseChatAttachments: vi.fn(),
}));
import { ask, cancelAsk, getChat } from './api';
import { releaseChatAttachments } from './media';
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
    const chat = await ask('ordered', { text: '查找资料', attachments: [], context: [] });
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
    await expect(
      ask('cancelled', { text: '查找资料', attachments: [], context: [] }),
    ).rejects.toThrow('取消');
    const reply = getChat('cancelled').messages.at(-1)!;
    expect(reply.content).toContain('部分回答');
    expect(reply.parts?.[1]).toEqual({ type: 'tools', results: [result] });
    expect(reply.interrupted).toBe(true);
    expect(getChat('cancelled').running).toBe(false);
    expect(getChat('cancelled').activeTool).toBeUndefined();
  });
  it('records the accumulated reasoning text as thinking', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onReasoning?.('先想');
      callbacks.onReasoning?.('先想清楚');
      callbacks.onText?.('回答');
      return { content: '回答', toolResults: [] };
    });
    const chat = await ask('thinking', { text: '查找资料', attachments: [], context: [] });
    expect(chat.messages.at(-1)?.thinking).toBe('先想清楚');
    expect(chat.messages.at(-1)?.content).toBe('回答');
  });
  it('resolves with partial content and a stopped flag when the user cancels', async () => {
    fixtures.run.mockImplementation(async (callbacks: Callbacks) => {
      callbacks.onText?.('部分回答');
      cancelAsk('stopped');
      // 模拟 runAgent 被用户中止后抛出的 AbortError。
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    const chat = await ask('stopped', { text: '查找资料', attachments: [], context: [] });
    const reply = chat.messages.at(-1)!;
    expect(reply.stopped).toBe(true);
    expect(reply.interrupted).toBeUndefined();
    expect(reply.content).toBe('部分回答');
    expect(JSON.stringify(reply)).not.toContain('本次执行中断');
    expect(getChat('stopped').running).toBe(false);
    expect(getChat('stopped').activeTool).toBeUndefined();
  });
});

describe('multimodal ask input', () => {
  it('sends ordered text/image parts, inlines attachments and persists stripped content', async () => {
    fixtures.run.mockImplementation(async () => ({ content: '好的', toolResults: [] }));
    const imageId = '01234567-89ab-cdef-0123-456789abcdef';
    const attachmentId = '22222222-2222-2222-2222-222222222222';
    const text = `看这张图\n![截图.png](dela-img:${imageId})\n再补充说明`;
    const chat = await ask('mixed', { text, attachments: [attachmentId], context: [] });
    const last = fixtures.run.mock.calls.at(-1)![0]!.messages.at(-1);
    const parts = last.content as {
      type: string;
      text?: string;
      image_url?: { url: string };
    }[];
    // 前言（资料/附件/用户请求）在首个 text part，其后按输入顺序排列文字与图片。
    expect(parts.map((part) => part.type)).toEqual(['text', 'text', 'image_url', 'text']);
    expect(parts[0]!.text).toContain('本次选中的资料');
    expect(parts[0]!.text).toContain('附件内容');
    expect(parts[0]!.text!.endsWith('用户请求：')).toBe(true);
    expect(parts[1]!.text).toBe('看这张图\n');
    expect(parts[2]!.image_url!.url).toMatch(/^data:image\/png;base64,/);
    expect(parts[3]!.text).toBe('\n再补充说明');
    const user = chat.messages[0]!;
    expect(user.role).toBe('user');
    expect(user.content).toBe('看这张图\n\n再补充说明');
    expect(user.images).toEqual([{ id: imageId, name: '截图.png' }]);
    expect(user.attachments).toEqual([{ name: `附件-${attachmentId.slice(0, 4)}.md` }]);
    expect(releaseChatAttachments).toHaveBeenCalledWith([attachmentId]);
  });

  it('accepts image-only input and rejects empty input', async () => {
    fixtures.run.mockImplementation(async () => ({ content: '好的', toolResults: [] }));
    const imageId = '01234567-89ab-cdef-0123-456789abcdef';
    const chat = await ask('imageonly', {
      text: `![仅图.png](dela-img:${imageId})`,
      attachments: [],
      context: [],
    });
    const parts = fixtures.run.mock.calls.at(-1)![0]!.messages.at(-1).content as { type: string }[];
    expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
    expect(chat.messages[0]!.content).toBe('');
    expect(chat.messages[0]!.images).toEqual([{ id: imageId, name: '仅图.png' }]);
    await expect(ask('empty', { text: '   ', attachments: [], context: [] })).rejects.toThrow(
      '请输入内容或添加图片',
    );
  });
});
