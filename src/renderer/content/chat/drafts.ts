import { create } from 'zustand';
import { hasChatImages } from '../../../shared/chat-input';

export type ChatReference = { key: string; title: string };

type ChatDraft = { prompt: string };

export const emptyDraft: ChatDraft = { prompt: '' };

// localStorage 键名沿用 dela.* 前缀约定；跨页面切换与重启保留输入。
// 旧 dela.chat.drafts 的 scope 键无映射，不迁移。
const STORAGE_KEY = 'dela.session.drafts';
// 会话草稿数量上限：超出时丢弃最早写入的草稿，避免无限增长。
const MAX_SESSIONS = 30;
const attachmentChecks = new Set<() => boolean>();

export function registerChatAttachmentCheck(check: () => boolean): () => void {
  attachmentChecks.add(check);
  return () => {
    attachmentChecks.delete(check);
  };
}

export function saveChatDrafts(): void {
  const drafts = useChatDrafts.getState().drafts;
  if (
    [...attachmentChecks].some((check) => check()) ||
    Object.values(drafts).some((draft) => hasChatImages(draft.prompt))
  ) {
    throw new Error('聊天中有尚未发送的附件或图片，请先发送或移除，再安装更新。');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

/** 逐条校验持久化草稿形状，脏 prompt 整条丢弃。旧版 references 数组迁移成 prompt 内联
 *  @token；source: 资料引用已无生产入口，迁移时丢弃。 */
function asChatDraft(value: unknown): ChatDraft | null {
  if (!value || typeof value !== 'object') return null;
  const { prompt, references } = value as Record<string, unknown>;
  if (typeof prompt !== 'string') return null;
  if (!Array.isArray(references)) return { prompt };
  let migrated = prompt;
  for (const item of references) {
    if (!item || typeof item !== 'object') continue;
    const { key, title } = item as Record<string, unknown>;
    if (typeof key !== 'string' || typeof title !== 'string') continue;
    if (key.startsWith('source:') || title.includes('\n')) continue;
    migrated += ` @${title}`;
  }
  return { prompt: migrated };
}

function loadStored(): Record<string, ChatDraft> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const drafts: Record<string, ChatDraft> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const draft = asChatDraft(value);
      if (draft) drafts[key] = draft;
    }
    return drafts;
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
