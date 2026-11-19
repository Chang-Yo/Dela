// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { dismissToast, showToast, toasts, Toaster } from './toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  for (const toast of toasts()) dismissToast(toast.id);
});

it('最多保留 4 条打开的通知，超出丢最旧', () => {
  for (let index = 0; index < 5; index++) showToast({ variant: 'error', title: `t${index}` });
  expect(toasts().map((toast) => toast.title)).toEqual(['t1', 't2', 't3', 't4']);
});

it('关闭后不再出现在打开列表，并在宿主里渲染与移除', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Toaster />));

  await act(async () => showToast({ variant: 'success', title: '已保存' }));
  expect(document.body.textContent).toContain('已保存');

  await act(async () => dismissToast(toasts()[0]!.id));
  expect(toasts()).toHaveLength(0);

  await act(async () => root.unmount());
  host.remove();
});
