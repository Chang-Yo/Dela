import { describe, expect, it, vi } from 'vitest';
import type { ChatSessionSummary, ChatStreamEvent, WorkspaceChat } from '../../shared/api';
import { initSessionsMirror, poolKey, querySessions, useSessions } from './store';

// 镜像订阅在模块加载时因无 window 而跳过；测试先装 mock（文件级，全文件共享）再手动挂接，
// 之后各用例只重编程 mock 的返回值（沿用 workspace.test.ts 的 Object.defineProperty 模式）。
const sessionList =
  vi.fn<(projectId: string | null, query: string) => Promise<ChatSessionSummary[]>>();
const updateListeners: Array<(sessionId: string, chat: WorkspaceChat) => void> = [];
const streamListeners: Array<(event: ChatStreamEvent) => void> = [];

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    dela: {
      session: {
        list: (...args: Parameters<typeof sessionList>) => sessionList(...args),
        onSessionUpdate: (listener: (sessionId: string, chat: WorkspaceChat) => void) => {
          updateListeners.push(listener);
          return () => {};
        },
        onStream: (listener: (event: ChatStreamEvent) => void) => {
          streamListeners.push(listener);
          return () => {};
        },
      },
    },
  },
});
initSessionsMirror();

function summary(id: string, updatedAt = '2026-09-29T10:00:00.000Z'): ChatSessionSummary {
  return { id, title: `会话 ${id}`, updatedAt };
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
  it('refresh 经 session:list 读取并按池缓存列表', async () => {
    sessionList.mockResolvedValue([summary('s1'), summary('s2')]);
    useSessions.setState({ lists: {}, chats: {} });
    await useSessions.getState().refresh('p1');
    expect(sessionList).toHaveBeenCalledWith('p1', '');
    expect(useSessions.getState().lists[poolKey('p1')]?.map((item) => item.id)).toEqual([
      's1',
      's2',
    ]);
  });

  it('通用池与项目池分开缓存（null → general）', async () => {
    sessionList.mockResolvedValue([summary('g1')]);
    useSessions.setState({ lists: {}, chats: {} });
    await useSessions.getState().refresh(null);
    expect(sessionList).toHaveBeenCalledWith(null, '');
    expect(useSessions.getState().lists['general']).toHaveLength(1);
    expect(useSessions.getState().lists['p1']).toBeUndefined();
  });

  it('on-update 推送写入对应会话的快照缓存', () => {
    useSessions.setState({ chats: {} });
    updateListeners[0]!('s1', chat('s1', 2));
    expect(useSessions.getState().chats['s1']?.messages).toHaveLength(2);
    updateListeners[0]!('s1', chat('s1', 3));
    expect(useSessions.getState().chats['s1']?.messages).toHaveLength(3);
  });

  it('流式增量只替换运行中会话的末条 assistant 消息，历史消息保持对象身份', () => {
    useSessions.setState({ chats: {} });
    updateListeners[0]!('s1', {
      ...chat('s1', 1),
      running: true,
      messages: [
        { role: 'user', content: '问' },
        { role: 'assistant', content: '', startedAt: 100, parts: [] },
      ],
    });
    const history = useSessions.getState().chats['s1']!;
    const userMessage = history.messages[0]!;
    streamListeners[0]!({
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
    streamListeners[0]!({
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
    updateListeners[0]!('s1', {
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
    streamListeners[0]!({
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
    sessionList.mockResolvedValue([summary('s1')]);
    useSessions.setState({ lists: {}, chats: {} });

    // 首条消息落库（main 此刻才写标题，空会话本来就不在 list 里）。
    updateListeners[0]!('s1', chat('s1', 1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sessionList).toHaveBeenCalledWith(null, '');
    expect(useSessions.getState().lists.general?.map((item) => item.id)).toEqual(['s1']);

    // 条数没变（同一轮的工具边界重复推送）不重读列表，避免每个边界都查一次库。
    sessionList.mockClear();
    updateListeners[0]!('s1', chat('s1', 1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sessionList).not.toHaveBeenCalled();

    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('不经推送写入的快照（分支、ask 结果）同样触发重读，两个池前后脚变化各自刷新', async () => {
    vi.useFakeTimers();
    sessionList.mockResolvedValue([summary('s1')]);
    useSessions.setState({ lists: {}, chats: {} });

    useSessions.getState().putChat('fork', { ...chat('fork', 2), projectId: 'p1' });
    useSessions.getState().putChat('g', chat('g', 1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sessionList).toHaveBeenCalledWith('p1', '');
    expect(sessionList).toHaveBeenCalledWith(null, '');

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

  it('querySessions 透传 projectId 与查询词，结果不落镜像', async () => {
    sessionList.mockResolvedValue([summary('s9')]);
    useSessions.setState({ lists: {}, chats: {} });
    await expect(querySessions('p2', '复习')).resolves.toHaveLength(1);
    expect(sessionList).toHaveBeenCalledWith('p2', '复习');
    expect(useSessions.getState().lists).toEqual({});
  });
});
