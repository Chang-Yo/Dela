// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CommentChip } from './comment-chip';
import { PromptInputSubmit } from './prompt-input';
import { QueuedMessages } from './queued-messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  await act(async () => createRoot(host).render(node));
  return host;
}

it('提交按钮：不可发送时禁用，停止态触发 onStop', async () => {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const idle = await render(
    <PromptInputSubmit
      onSend={onSend}
      onStop={onStop}
      sendable={false}
      sendTitle="发送"
      stoppable={false}
    />,
  );
  expect(idle.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!.disabled).toBe(true);

  const running = await render(
    <PromptInputSubmit onSend={onSend} onStop={onStop} sendable sendTitle="发送" stoppable />,
  );
  await act(async () => running.querySelector<HTMLButtonElement>('button')!.click());
  expect(onStop).toHaveBeenCalledOnce();
  expect(onSend).not.toHaveBeenCalled();
});

it('排队消息：有 onWithdraw 才出现撤回按钮', async () => {
  const onWithdraw = vi.fn();
  const without = await render(<QueuedMessages messages={['a']} />);
  expect(without.querySelector('button')).toBeNull();

  const withWithdraw = await render(
    <QueuedMessages messages={['a', 'b']} onWithdraw={onWithdraw} />,
  );
  await act(async () => withWithdraw.querySelector('button')!.click());
  expect(onWithdraw).toHaveBeenCalledOnce();
});

it('评论 chip：点击移除按钮触发 onRemove', async () => {
  const onRemove = vi.fn();
  const host = await render(
    <CommentChip item={{ quote: '原文', comment: '评论' }} onRemove={onRemove} onSave={() => {}} />,
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="移除评论"]')!.click(),
  );
  expect(onRemove).toHaveBeenCalledOnce();
});
