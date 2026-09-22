import { create } from 'zustand';

export type ChatReference = { key: string; title: string };

type ChatDraft = { prompt: string; references: ChatReference[] };

export const emptyDraft: ChatDraft = { prompt: '', references: [] };

// localStorage 键名沿用 dela.* 前缀约定；跨页面切换与重启保留输入。
const STORAGE_KEY = 'dela.chat.drafts';
// scope 数量上限（首页、资料与各项目）：超出时丢弃最早写入的草稿，避免无限增长。
const MAX_SCOPES = 30;

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
  if (keys.length <= MAX_SCOPES) return drafts;
  const kept = { ...drafts };
  for (const key of keys.slice(0, keys.length - MAX_SCOPES)) delete kept[key];
  return kept;
}

/** 按 scope 保存 composer 草稿：组件卸载（切换页面）与重启后输入不丢失。 */
export const useChatDrafts = create<{
  drafts: Record<string, ChatDraft>;
  update: (scope: string, patch: Partial<ChatDraft>) => void;
  clear: (scope: string) => void;
}>((set) => ({
  drafts: loadStored(),
  update: (scope, patch) =>
    set((state) => {
      const drafts = prune({
        ...state.drafts,
        [scope]: { ...(state.drafts[scope] ?? emptyDraft), ...patch },
      });
      store(drafts);
      return { drafts };
    }),
  clear: (scope) =>
    set((state) => {
      if (!(scope in state.drafts)) return state;
      const drafts = { ...state.drafts };
      delete drafts[scope];
      store(drafts);
      return { drafts };
    }),
}));
