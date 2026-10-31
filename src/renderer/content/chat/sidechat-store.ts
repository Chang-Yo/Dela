// 旁问镜像：旁问本身在主进程（不入库、关闭即丢弃），这里按主会话 id 缓存它的快照与面板折叠态，
// 切走标签再回来面板照旧。推送与流式增量的合并方式与会话镜像相同。
import { create } from 'zustand';
import type { SidechatView } from '../../../shared/api';
import { keepToolImages } from '../../sessions/store';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import { emptyDraft, useChatDrafts } from './drafts';

interface SidechatState {
  views: Record<string, SidechatView>;
  collapsed: Record<string, boolean>;
  put: (view: SidechatView) => void;
  forget: (parentId: string) => void;
  setCollapsed: (parentId: string, collapsed: boolean) => void;
}

export const useSidechats = create<SidechatState>((set) => ({
  views: {},
  collapsed: {},
  put: (view) => set((state) => ({ views: { ...state.views, [view.parentId]: view } })),
  forget: (parentId) =>
    set((state) => {
      const views = { ...state.views };
      const collapsed = { ...state.collapsed };
      delete views[parentId];
      delete collapsed[parentId];
      return { views, collapsed };
    }),
  setCollapsed: (parentId, value) =>
    set((state) => ({ collapsed: { ...state.collapsed, [parentId]: value } })),
}));

export const sidechatDraftKey = (parentId: string) => `sidechat:${parentId}`;

/** 打开旁问（已开着就展开）；quote 非空时作为评论放进旁问输入框，首条提问就带上这段原文。 */
export async function openSidechat(
  parentId: string,
  options: { quote?: string; prompt?: string } = {},
) {
  const api = window.dela?.sidechat;
  if (!api) return;
  const key = sidechatDraftKey(parentId);
  const drafts = useChatDrafts.getState();
  const draft = drafts.drafts[key] ?? emptyDraft;
  if (options.quote)
    drafts.update(key, {
      comments: [...(draft.comments ?? []), { quote: options.quote, comment: '' }],
    });
  if (options.prompt) drafts.update(key, { prompt: options.prompt });
  useSidechats.getState().setCollapsed(parentId, false);
  try {
    useSidechats.getState().put(await api.open(parentId));
  } catch (error) {
    showToast({ variant: 'error', title: '打开旁问失败', description: errorText(error) });
  }
}

let subscribed = false;

/** 订阅 sidechat:* 推送（幂等）；模块加载时挂接，测试先装 window mock 再手动调用。 */
export function initSidechatMirror(): void {
  if (subscribed || typeof window === 'undefined' || !window.dela?.sidechat) return;
  subscribed = true;
  const api = window.dela.sidechat;
  api.onUpdate((view) => {
    // 已关闭的旁问可能还有迟到的推送：只更新仍在镜像里的。
    if (useSidechats.getState().views[view.parentId]) useSidechats.getState().put(view);
  });
  api.onStream(({ sessionId, message, activeTool }) => {
    const current = useSidechats.getState().views[sessionId];
    if (!current?.running) return;
    const last = current.messages.at(-1);
    const replaceLast =
      last?.role === 'assistant' &&
      last.startedAt === message.startedAt &&
      last.finishedAt === undefined;
    const messages = replaceLast
      ? [...current.messages.slice(0, -1), keepToolImages(last, message)]
      : [...current.messages, message];
    useSidechats.getState().put({ ...current, messages, activeTool });
  });
  api.onClosed((parentId) => useSidechats.getState().forget(parentId));
}

initSidechatMirror();
