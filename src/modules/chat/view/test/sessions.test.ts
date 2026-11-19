import { describe, expect, it, vi } from 'vitest';
import type {
  ChatSessionSummary,
  ChatStreamEvent,
  WorkspaceChat,
} from '../../../../core/protocol/agent';

// 契约客户端与镜像订阅在模块加载时取 bridge，须先于导入 store 装好（全文件共享）；
// 之后各用例只重编程 invoke 的返回值。
const { invoke, listeners } = vi.hoisted(() => {
  const listeners: Record<string, Array<(payload: unknown) => void>> = {};
  const invoke = vi.fn<(channel: string, input: unknown) => Promise<unknown>>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: {
        bridge: {
          invoke,
          subscribe: (channel: string, listener: (payload: unknown) => void) => {
            (listeners[channel] ??= []).push(listener);
            return () => {};
          },
        },
      },
    },
  });
  return { invoke, listeners };
});
import { poolKey, useSessions } from '../sessions';

const pushUpdate = (sessionId: string, chat: WorkspaceChat) =>
  listeners['agent:session-update']![0]!({ sessionId, chat });
const pushStream = (event: ChatStreamEvent) => listeners['agent:session-stream']![0]!(event);

function summary(id: string, updatedAt = '2026-09-29T10:00:00.000Z'): ChatSessionSummary {
  return { id, title: `会话 ${id}`, updatedAt, createdAt: updatedAt };
}

function chat(sessionId: string, messageCount: number): WorkspaceChat {
  return {
    sessionId,
    projectId: null,
    cwd: null,
    configured: true,
    providerId: null,
    providerName: null,
    model: 'm',
    modelUnavailable: false,
    effortLevels: [],
    effort: null,
    messages: Array.from({ length: messageCount }, () => ({
      role: 'user' as const,
      content: 'hi',
    })),
  };
}

describe('sessions mirror store', () => {
  it('refresh 经 list-sessions 读取并按池缓存列表', async () => {
    invoke.mockResolvedValue([summary('s1'), summary('s2')]);
    useSessions.setState({ lists: {}, chats: {} });
    await useSessions.getState().refresh('p1');
    expect(invoke).toHaveBeenCalledWith('agent:list-sessions', { projectId: 'p1' });
    expect(useSessions.getState().lists[poolKey('p1')]?.map((item) => item.id)).toEqual([
      's1',
      's2',
    ]);
  });

  it('流式增量只替换运行中会话的末条 assistant 消息，历史消息保持对象身份', () => {
    useSessions.setState({ chats: {} });
    pushUpdate('s1', {
      ...chat('s1', 1),
      running: true,
      messages: [
        { role: 'user', content: '问' },
        { role: 'assistant', content: '', startedAt: 100, parts: [] },
      ],
    });
    const history = useSessions.getState().chats['s1']!;
    const userMessage = history.messages[0]!;
    pushStream({
      sessionId: 's1',
      activeTool: 'Read',
      message: { role: 'assistant', content: '正在回答', startedAt: 100, parts: [] },
    });
    const merged = useSessions.getState().chats['s1']!;
    expect(merged.messages).toHaveLength(2);
    expect(merged.messages[1]).toMatchObject({ content: '正在回答' });
    expect(merged.activeTool).toBe('Read');
    // 历史消息对象身份不变：memo 化的消息组件依赖引用相等跳过重渲。
    expect(merged.messages[0]).toBe(userMessage);
    // 非运行态（终态已到或未开始）的增量被丢弃，等待全量推送兜底。
    useSessions.setState({ chats: { s2: { ...chat('s2', 1), running: false } } });
    pushStream({
      sessionId: 's2',
      message: { role: 'assistant', content: '迟到增量', startedAt: 200, parts: [] },
    });
    expect(useSessions.getState().chats['s2']?.messages).toHaveLength(1);
  });

  it('流式增量不重传工具图片，替换末条消息时按 toolCallId 回填', () => {
    useSessions.setState({ chats: {} });
    const image = { mimeType: 'image/jpeg', data: 'aGVsbG8=' };
    const step = (withImage: boolean) => ({
      id: 't1',
      name: 'read',
      input: { path: '05.jpg' },
      output: {
        text: 'Read image file [image/jpeg]',
        ...(withImage ? { image } : {}),
      },
      finishedAt: 2,
    });
    pushUpdate('s1', {
      ...chat('s1', 1),
      running: true,
      messages: [
        { role: 'user', content: '看图' },
        {
          role: 'assistant',
          content: '',
          startedAt: 100,
          toolResults: [step(true)],
          parts: [{ type: 'tools', results: [step(true)] }],
        },
      ],
    });
    pushStream({
      sessionId: 's1',
      message: {
        role: 'assistant',
        content: '看到了',
        startedAt: 100,
        toolResults: [step(false)],
        parts: [{ type: 'tools', results: [step(false)] }],
      },
    });
    const merged = useSessions.getState().chats['s1']!.messages[1]!;
    expect(merged.toolResults?.[0]?.output?.image).toEqual(image);
    const part = merged.parts?.[0];
    expect(part?.type === 'tools' && part.results[0]?.output?.image).toEqual(image);
  });

  it('会话条数变化的推送触发该池列表重读，侧栏标题与排序才跟得上', async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue([summary('s1')]);
    useSessions.setState({ lists: {}, chats: {} });

    // 首条消息落库（main 此刻才写标题，空会话本来就不在 list 里）。
    pushUpdate('s1', chat('s1', 1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).toHaveBeenCalledWith('agent:list-sessions', { projectId: null });
    expect(useSessions.getState().lists.general?.map((item) => item.id)).toEqual(['s1']);

    // 条数没变（同一轮的工具边界重复推送）不重读列表，避免每个边界都查一次库。
    invoke.mockClear();
    pushUpdate('s1', chat('s1', 1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).not.toHaveBeenCalled();

    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('forgetSession 同时清出快照缓存与各池列表条目', () => {
    useSessions.setState({
      lists: {
        [poolKey('p1')]: [summary('s1'), summary('s2')],
        general: [summary('g1')],
      },
      chats: { s1: chat('s1', 1) },
    });
    useSessions.getState().forgetSession('s1');
    expect(useSessions.getState().chats['s1']).toBeUndefined();
    expect(useSessions.getState().lists[poolKey('p1')]?.map((item) => item.id)).toEqual(['s2']);
    expect(useSessions.getState().lists.general).toHaveLength(1);
  });
});
