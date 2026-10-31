import { expect, it, vi } from 'vitest';
import type { ChatStreamEvent, SidechatView } from '../../../shared/api';
import { useChatDrafts } from './drafts';
import { initSidechatMirror, openSidechat, sidechatDraftKey, useSidechats } from './sidechat-store';

const listeners = {
  update: [] as ((view: SidechatView) => void)[],
  stream: [] as ((event: ChatStreamEvent) => void)[],
  closed: [] as ((parentId: string) => void)[],
};
const open = vi.fn(async (parentId: string): Promise<SidechatView> => ({
  parentId,
  running: false,
  messages: [],
}));

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    dela: {
      sidechat: {
        open,
        onUpdate: (listener: (view: SidechatView) => void) => listeners.update.push(listener),
        onStream: (listener: (event: ChatStreamEvent) => void) => listeners.stream.push(listener),
        onClosed: (listener: (parentId: string) => void) => listeners.closed.push(listener),
      },
    },
  },
});
initSidechatMirror();

it('从选中文字打开旁问：引用作为评论放进旁问草稿，面板展开', async () => {
  useSidechats.getState().setCollapsed('p1', true);
  await openSidechat('p1', { quote: '选中的原文' });
  expect(open).toHaveBeenCalledWith('p1');
  expect(useChatDrafts.getState().drafts[sidechatDraftKey('p1')]?.comments).toEqual([
    { quote: '选中的原文', comment: '' },
  ]);
  expect(useSidechats.getState().collapsed.p1).toBe(false);
  expect(useSidechats.getState().views.p1?.messages).toEqual([]);
});

it('流式增量替换末条回复；关闭推送清掉镜像，迟到的快照不再写回', () => {
  useSidechats.getState().put({
    parentId: 'p2',
    running: true,
    messages: [
      { role: 'user', content: '问' },
      { role: 'assistant', content: '', startedAt: 1, parts: [] },
    ],
  });
  listeners.stream[0]!({
    sessionId: 'p2',
    message: { role: 'assistant', content: '答', startedAt: 1, parts: [] },
  });
  expect(useSidechats.getState().views.p2?.messages.map((m) => m.content)).toEqual(['问', '答']);

  listeners.closed[0]!('p2');
  expect(useSidechats.getState().views.p2).toBeUndefined();
  listeners.update[0]!({ parentId: 'p2', running: false, messages: [] });
  expect(useSidechats.getState().views.p2).toBeUndefined();
});
