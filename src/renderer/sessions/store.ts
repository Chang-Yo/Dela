import { create } from 'zustand';
import type { ChatSessionSummary, WorkspaceChat } from '../../shared/api';

// 会话列表镜像（docs/refactor/structure.md §3.4）：renderer 只持有视图状态与镜像，
// 会话事实（chat_sessions 表）在 main；本模块全部数据来自 session:list 与
// session:on-update 订阅，只读不发起执行（「打开视图不启动执行」）。

/** 会话池键：projectId 为 null（通用池）时用占位符；projectId 为 UUID，不会与其冲突。 */
export function poolKey(projectId: string | null): string {
  return projectId ?? 'general';
}

interface SessionsState {
  /** 按池缓存的基础会话摘要列表（query 为空），供导航与切换条共用。 */
  lists: Record<string, ChatSessionSummary[]>;
  /** sessionId → 最新快照缓存：session:on-update 推送与 open/ask 结果都写这里。 */
  chats: Record<string, WorkspaceChat>;
  /** 重读某池的基础列表（session:list）。 */
  refresh: (projectId: string | null) => Promise<void>;
  putChat: (sessionId: string, chat: WorkspaceChat) => void;
  /** 会话删除后清出镜像（on-update 不会为已删会话推送）。 */
  forgetSession: (sessionId: string) => void;
}

export const useSessions = create<SessionsState>((set) => ({
  lists: {},
  chats: {},
  refresh: async (projectId) => {
    if (typeof window === 'undefined' || !window.dela) return;
    const sessions = await window.dela.session.list(projectId, '');
    set((state) => ({ lists: { ...state.lists, [poolKey(projectId)]: sessions } }));
  },
  putChat: (sessionId, chat) => set((state) => ({ chats: { ...state.chats, [sessionId]: chat } })),
  forgetSession: (sessionId) =>
    set((state) => {
      const chats = { ...state.chats };
      delete chats[sessionId];
      const lists: Record<string, ChatSessionSummary[]> = {};
      for (const [key, list] of Object.entries(state.lists))
        lists[key] = list.filter((item) => item.id !== sessionId);
      return { chats, lists };
    }),
}));

/** 面板搜索直查（session:list 带查询词）：查询态属于调用方，结果不进镜像。 */
export function querySessions(
  projectId: string | null,
  query: string,
): Promise<ChatSessionSummary[]> {
  return typeof window !== 'undefined' && window.dela
    ? window.dela.session.list(projectId, query)
    : Promise.resolve([]);
}

let sessionUpdateSubscription: (() => void) | null = null;

/** 订阅 session:on-update（幂等）：快照推送写入镜像缓存，供同一会话的多个入口共享。
 *  模块加载时自动挂接；测试环境先装 window mock 再手动调用。 */
export function initSessionsMirror(): void {
  if (sessionUpdateSubscription || typeof window === 'undefined' || !window.dela) return;
  sessionUpdateSubscription = window.dela.session.onSessionUpdate((sessionId, chat) => {
    useSessions.getState().putChat(sessionId, chat);
  });
}

initSessionsMirror();
