import { describe, expect, it, vi } from 'vitest';
import type { ChatSessionSummary, WorkspaceChat } from '../../shared/api';
import { initSessionsMirror, poolKey, querySessions, useSessions } from './store';

// 镜像订阅在模块加载时因无 window 而跳过；测试先装 mock（文件级，全文件共享）再手动挂接，
// 之后各用例只重编程 mock 的返回值（沿用 workspace.test.ts 的 Object.defineProperty 模式）。
const sessionList =
  vi.fn<(projectId: string | null, query: string) => Promise<ChatSessionSummary[]>>();
const updateListeners: Array<(sessionId: string, chat: WorkspaceChat) => void> = [];

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
      },
    },
  },
});
initSessionsMirror();

function summary(id: string, updatedAt = '2026-09-29T10:00:00.000Z'): ChatSessionSummary {
  return { id, title: `会话 ${id}`, updatedAt, messageCount: 1 };
}

function chat(sessionId: string, messageCount: number): WorkspaceChat {
  return {
    sessionId,
    configured: true,
    providerName: null,
    model: 'm',
    models: [],
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
