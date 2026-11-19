// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ErrorCard, MessageChip } from './message';
import { Trace } from './trace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  await act(async () => createRoot(host).render(node));
  return host;
}

it('错误卡只在提供 onRetry 时出现重试按钮，点击触发回调', async () => {
  const onRetry = vi.fn();
  const withRetry = await render(<ErrorCard onRetry={onRetry} reason="失败" />);
  await act(async () => withRetry.querySelector('button')!.click());
  expect(onRetry).toHaveBeenCalledOnce();
  const without = await render(<ErrorCard reason="失败" />);
  expect(without.querySelector('button')).toBeNull();
});

it('chip 有 onClick 时是按钮，否则是纯文本', async () => {
  const onClick = vi.fn();
  const host = await render(
    <>
      <MessageChip onClick={onClick}>可点</MessageChip>
      <MessageChip>纯文本</MessageChip>
    </>,
  );
  expect(host.querySelectorAll('button')).toHaveLength(1);
  await act(async () => host.querySelector('button')!.click());
  expect(onClick).toHaveBeenCalledOnce();
});

it('给出 foldLabel 时过程块被隐藏，展开后可见，最后一块始终可见', async () => {
  const host = await render(
    <Trace
      blocks={[
        { key: 0, node: <p>过程</p> },
        { key: 1, node: <p>结论</p> },
      ]}
      foldLabel="已处理"
    />,
  );
  const process = host.querySelector('p')!.parentElement!;
  expect(process.hidden).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(process.hidden).toBe(false);
  expect(host.querySelectorAll('[hidden]')).toHaveLength(0);
});
