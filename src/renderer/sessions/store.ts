import { create } from 'zustand';
import type { AgentToolOutput, ChatSessionSummary, WorkspaceChat } from '../../shared/api';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { walkGroups } from '../workbench/layout-schema';

// 会话列表镜像：会话事实（chat_sessions 表）在 main，本模块数据全来自 session:list 与
// session:on-update，只读不发起执行（「打开视图不启动执行」）。

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

export const useSessions = create<SessionsState>((set, get) => ({
  lists: {},
  chats: {},
  refresh: async (projectId) => {
    if (typeof window === 'undefined' || !window.dela) return;
    const sessions = await window.dela.session.list(projectId, '');
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

/** 列表重读抖动（毫秒）：一轮问答里 on-update 会按工具边界多次到达，合并成一次查询。 */
const listRefreshDelayMs = 300;
const listRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 标题（首条消息才写）与「最近优先」排序都只体现在列表里，快照本身不带列表，
 *  所以任何来源（推送、ask/fork 结果）写入的快照条数变化后重读该池；按池各自防抖，
 *  两个池前后脚变化时不会只刷到后一个。 */
function scheduleListRefresh(projectId: string | null): void {
  const key = poolKey(projectId);
  clearTimeout(listRefreshTimers.get(key));
  listRefreshTimers.set(
    key,
    setTimeout(() => {
      listRefreshTimers.delete(key);
      void useSessions
        .getState()
        .refresh(projectId)
        .catch(() => {});
    }, listRefreshDelayMs),
  );
}

/** 订阅 session:on-update（幂等）：快照推送写入镜像缓存，供同一会话的多个入口共享。
 *  模块加载时自动挂接；测试环境先装 window mock 再手动调用。 */
export function initSessionsMirror(): void {
  if (sessionUpdateSubscription || typeof window === 'undefined' || !window.dela) return;
  sessionUpdateSubscription = window.dela.session.onSessionUpdate((sessionId, chat) => {
    useSessions.getState().putChat(sessionId, chat);
  });
  // 流式增量只改末条 assistant 消息：历史消息保持对象身份，memo 化的消息组件
  // 不重渲（全量推送会让整线程每 100ms 重新解析一次 markdown）。
  window.dela.session.onStream(({ sessionId, message, activeTool, contextUsage }) => {
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
}

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

initSessionsMirror();

/** 所有入口共用归档/置顶后的镜像刷新，归档仅关闭标签，不停止运行或删除消息。 */
export async function updateSession(
  sessionId: string,
  patch: { archived?: boolean; pinned?: boolean },
): Promise<void> {
  if (!window.dela) throw new Error('会话管理仅在桌面端可用');
  await window.dela.session.update(sessionId, patch);
  if (patch.archived) closeSessionTabs([sessionId]);
  await refreshSessionLists();
}

export function closeSessionTabs(ids: string[]): void {
  const idsToClose = new Set(ids.map((id) => `chat:${id}`));
  for (const group of walkGroups(useWorkbenchLayout.getState().root))
    for (const tab of group.tabs)
      if (idsToClose.has(tab)) useWorkbenchLayout.getState().closeTab(tab, group.id);
}

export async function refreshSessionLists(): Promise<void> {
  await Promise.all(
    Object.keys(useSessions.getState().lists).map((key) =>
      useSessions.getState().refresh(key === 'general' ? null : key),
    ),
  );
}
