import { create } from 'zustand';

export type ChatReference = { key: string; title: string };

type ChatDraft = { prompt: string; references: ChatReference[] };

export const emptyDraft: ChatDraft = { prompt: '', references: [] };

// localStorage 键名沿用 dela.* 前缀约定；跨页面切换与重启保留输入。
// 键从 scope 换成 sessionId（阶段三批次 3A 身份切换）：旧 dela.chat.drafts 的 scope 键
// 无映射可迁移，留在原键位由旧实现继续使用，双通道期互不干扰。
const STORAGE_KEY = 'dela.session.drafts';
// 会话草稿数量上限：超出时丢弃最早写入的草稿，避免无限增长。
const MAX_SESSIONS = 30;

function loadStored(): Record<string, ChatDraft> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, ChatDraft>;
  } catch {
    return {};
  }
}

function store(drafts: Record<string, ChatDraft>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // 存储不可用（如配额）时放弃持久化，会话内的内存草稿仍然工作。
  }
}

function prune(drafts: Record<string, ChatDraft>): Record<string, ChatDraft> {
  const keys = Object.keys(drafts);
  if (keys.length <= MAX_SESSIONS) return drafts;
  const kept = { ...drafts };
  for (const key of keys.slice(0, keys.length - MAX_SESSIONS)) delete kept[key];
  return kept;
}

/** 按 sessionId 保存 composer 草稿：组件卸载（切换标签）与重启后输入不丢失。 */
export const useChatDrafts = create<{
  drafts: Record<string, ChatDraft>;
  update: (sessionId: string, patch: Partial<ChatDraft>) => void;
  clear: (sessionId: string) => void;
}>((set) => ({
  drafts: loadStored(),
  update: (sessionId, patch) =>
    set((state) => {
      const drafts = prune({
        ...state.drafts,
        [sessionId]: { ...(state.drafts[sessionId] ?? emptyDraft), ...patch },
      });
      store(drafts);
      return { drafts };
    }),
  clear: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.drafts)) return state;
      const drafts = { ...state.drafts };
      delete drafts[sessionId];
      store(drafts);
      return { drafts };
    }),
}));
