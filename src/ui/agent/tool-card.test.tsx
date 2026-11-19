// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ToolCard } from './tool-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  await act(async () => createRoot(host).render(node));
  return host;
}

it('有 copyText 时出现复制按钮，点击写入剪贴板', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const host = await render(
    <ToolCard copyText="原文" icon={null} title="a.ts">
      body
    </ToolCard>,
  );
  await act(async () => host.querySelector('button')!.click());
  expect(writeText).toHaveBeenCalledWith('原文');
});

it('没有 copyText 时不出现复制按钮，增删统计照常显示', async () => {
  const host = await render(
    <ToolCard icon={null} stats={{ added: 3, deleted: 1 }} title="a.ts">
      body
    </ToolCard>,
  );
  expect(host.querySelector('button')).toBeNull();
  expect(host.textContent).toContain('+3');
  expect(host.textContent).toContain('-1');
});
