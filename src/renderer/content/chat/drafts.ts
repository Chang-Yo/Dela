import { create } from 'zustand';
import type { ChatComment } from '../../../shared/api';
import { hasChatImages } from '../../../shared/chat-input';

export type ChatReference = { key: string; title: string };

/** comments：对回复正文的评论，随草稿持久化；没有评论时省略。 */
type ChatDraft = { prompt: string; comments?: ChatComment[] };

export const emptyDraft: ChatDraft = { prompt: '' };

// localStorage 键名沿用 dela.* 前缀约定；跨页面切换与重启保留输入。
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

const isComment = (value: unknown): value is ChatComment =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as ChatComment).quote === 'string' &&
  typeof (value as ChatComment).comment === 'string';

function loadStored(): Record<string, ChatDraft> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const drafts: Record<string, ChatDraft> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        !key.startsWith('sidechat:') &&
        value &&
        typeof value === 'object' &&
        'prompt' in value &&
        typeof value.prompt === 'string'
      ) {
        const comments =
          'comments' in value && Array.isArray(value.comments) && value.comments.every(isComment)
            ? value.comments
            : [];
        drafts[key] = comments.length
          ? { prompt: value.prompt, comments }
          : { prompt: value.prompt };
      }
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
