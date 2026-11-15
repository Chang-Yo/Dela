import { expect, it, vi } from 'vitest';
import type { ChatStreamEvent, SidechatView } from '../../../../core/protocol/agent';

// 契约客户端与旁问镜像在模块加载时取 bridge，须先于导入装好。
const { invoke, listeners } = vi.hoisted(() => {
  const listeners: Record<string, Array<(payload: unknown) => void>> = {};
  const invoke = vi.fn(async (_channel: string, input: { parentId: string }) => ({
    parentId: input.parentId,
    running: false,
    messages: [],
  }));
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: {
        bridge: {
          invoke,
          subscribe: (channel: string, listener: (payload: unknown) => void) => {
            (listeners[channel] ??= []).push(listener);
            return () => {};
          },
        },
      },
    },
  });
  return { invoke, listeners };
});
import { useChatDrafts } from '../drafts';
import { openSidechat, sidechatDraftKey, useSidechats } from '../sidechat-store';

const pushUpdate = (view: SidechatView) => listeners['agent:sidechat-update']![0]!(view);
const pushStream = (event: ChatStreamEvent) => listeners['agent:sidechat-stream']![0]!(event);
const pushClosed = (parentId: string) => listeners['agent:sidechat-closed']![0]!({ parentId });

it('从选中文字打开旁问：引用作为评论放进旁问草稿，面板展开', async () => {
  useSidechats.getState().setCollapsed('p1', true);
  await openSidechat('p1', { quote: '选中的原文' });
  expect(invoke).toHaveBeenCalledWith('agent:open-sidechat', { parentId: 'p1' });
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
  pushStream({
    sessionId: 'p2',
    message: { role: 'assistant', content: '答', startedAt: 1, parts: [] },
  });
  expect(useSidechats.getState().views.p2?.messages.map((m) => m.content)).toEqual(['问', '答']);

  pushClosed('p2');
  expect(useSidechats.getState().views.p2).toBeUndefined();
  pushUpdate({ parentId: 'p2', running: false, messages: [] });
  expect(useSidechats.getState().views.p2).toBeUndefined();
});
