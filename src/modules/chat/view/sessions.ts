import { create } from 'zustand';
import type {
  AgentToolOutput,
  ChatSessionSummary,
  WorkspaceChat,
} from '../../../core/protocol/agent';
import { agentClient, chatClient, onAgentEvent } from './client';

// 会话列表镜像：会话事实（sessions 表）在 main，本模块数据全来自 list-sessions 与
// session-update 推送，只读不发起执行（「打开视图不启动执行」）。

/** 会话池键：projectId 为 null（通用池）时用占位符；projectId 为 UUID，不会与其冲突。 */
export function poolKey(projectId: string | null): string {
  return projectId ?? 'general';
}

interface SessionsState {
  lists: Record<string, ChatSessionSummary[]>;
  chats: Record<string, WorkspaceChat>;
  /** 首页上次停留的会话：切走再回首页接着上次，只活在本次运行内（重启后首页回到新对话）。 */
  homeSessionId: string | null;
  refreshTimers: Record<string, ReturnType<typeof setTimeout>>;
  refresh: (projectId: string | null) => Promise<void>;
  putChat: (sessionId: string, chat: WorkspaceChat) => void;
  forgetSession: (sessionId: string) => void;
}

/** 列表重读抖动（毫秒）：一轮问答里 session-update 会按工具边界多次到达，合并成一次查询。 */
const listRefreshDelayMs = 300;

export const useSessions = create<SessionsState>((set, get) => {
  // 标题与排序只体现在列表里，快照不带列表，所以快照条数变化后要重读该池；按池各自防抖。
  const scheduleListRefresh = (projectId: string | null) => {
    const key = poolKey(projectId);
    clearTimeout(get().refreshTimers[key]);
    const timer = setTimeout(() => {
      set((state) => ({
        refreshTimers: Object.fromEntries(
          Object.entries(state.refreshTimers).filter(([pool]) => pool !== key),
        ),
      }));
      void get()
        .refresh(projectId)
        .catch(() => {});
    }, listRefreshDelayMs);
    set((state) => ({ refreshTimers: { ...state.refreshTimers, [key]: timer } }));
  };

  return {
    lists: {},
    chats: {},
    homeSessionId: null,
    refreshTimers: {},
    refresh: async (projectId) => {
      if (typeof window === 'undefined' || !window.dela) return;
      const sessions = await agentClient['list-sessions']({ projectId });
      set((state) => ({ lists: { ...state.lists, [poolKey(projectId)]: sessions } }));
    },
    putChat: (sessionId, chat) => {
      const previous = get().chats[sessionId];
      set((state) => ({ chats: { ...state.chats, [sessionId]: chat } }));
      if ((previous?.messages.length ?? 0) !== chat.messages.length)
        scheduleListRefresh(chat.projectId);
    },
    forgetSession: (sessionId) =>
      set((state) => {
        const chats = { ...state.chats };
        delete chats[sessionId];
        const lists: Record<string, ChatSessionSummary[]> = {};
        for (const [key, list] of Object.entries(state.lists))
          lists[key] = list.filter((item) => item.id !== sessionId);
        return { chats, lists };
      }),
  };
});

export function querySessions(
  projectId: string | null,
  query: string,
): Promise<ChatSessionSummary[]> {
  return typeof window !== 'undefined' && window.dela
    ? agentClient['list-sessions']({ projectId, query })
    : Promise.resolve([]);
}

onAgentEvent('session-update', ({ sessionId, chat }) => {
  useSessions.getState().putChat(sessionId, chat);
});
// 流式增量只改末条 assistant 消息：历史消息保持对象身份，memo 化的消息组件
// 不重渲（全量推送会让整线程每 100ms 重新解析一次 markdown）。
onAgentEvent('session-stream', ({ sessionId, message, activeTool, contextUsage }) => {
  const current = useSessions.getState().chats[sessionId];
  // 无缓存（会话未打开）或非运行态：丢弃增量，等待工具边界/终态的全量推送兜底。
  if (!current?.running) return;
  const last = current.messages.at(-1);
  const replaceLast =
    last?.role === 'assistant' &&
    last.startedAt === message.startedAt &&
    last.finishedAt === undefined;
  const messages = replaceLast
    ? [...current.messages.slice(0, -1), keepToolImages(last, message)]
    : [...current.messages, message];
  useSessions.getState().putChat(sessionId, { ...current, messages, activeTool, contextUsage });
});
onAgentEvent('queue', ({ sessionId, queued }) => {
  const current = useSessions.getState().chats[sessionId];
  if (current) useSessions.getState().putChat(sessionId, { ...current, queued });
});

type ChatMessage = WorkspaceChat['messages'][number];
type ToolStep = NonNullable<ChatMessage['toolResults']>[number];

/** 流式增量不带工具图片（见 ChatStreamEvent），替换末条消息时按 toolCallId 从旧消息回填：
 *  图片仍停留在界面，但不必每帧重传 base64。 */
export function keepToolImages(previous: ChatMessage | undefined, next: ChatMessage): ChatMessage {
  const images = new Map<string, NonNullable<AgentToolOutput['image']>>();
  for (const step of previous?.toolResults ?? [])
    if (step.output?.image) images.set(step.id, step.output.image);
  if (!images.size) return next;
  const fill = (step: ToolStep): ToolStep => {
    const image = images.get(step.id);
    return image && step.output && !step.output.image
      ? { ...step, output: { ...step.output, image } }
      : step;
  };
  return {
    ...next,
    ...(next.toolResults && { toolResults: next.toolResults.map(fill) }),
    ...(next.parts && {
      parts: next.parts.map((part) =>
        part.type === 'tools' ? { ...part, results: part.results.map(fill) } : part,
      ),
    }),
  };
}

/** 所有入口共用归档/置顶后的镜像刷新；归档不停止主运行、不删除消息，标签由调用方经工作台关闭。 */
export async function updateSession(
  sessionId: string,
  patch: { archived?: boolean; pinned?: boolean },
): Promise<void> {
  if (!window.dela) throw new Error('会话管理仅在桌面端可用');
  await chatClient.update({ id: sessionId, patch });
  await refreshSessionLists();
}

export async function refreshSessionLists(): Promise<void> {
  await Promise.all(
    Object.keys(useSessions.getState().lists).map((key) =>
      useSessions.getState().refresh(key === 'general' ? null : key),
    ),
  );
}
