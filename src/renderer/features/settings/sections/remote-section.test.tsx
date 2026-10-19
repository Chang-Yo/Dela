// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, RemoteConnection } from '../../../../shared/api';
import { useToastStore } from '../../../app/toasts';
import { RemoteSection } from './RemoteSection';

let container: HTMLDivElement;
let root: Root;

const connection: RemoteConnection = {
  id: 'r-1',
  label: '实验室主机',
  host: 'gpu-box',
  port: 2222,
  keyPath: null,
  createdAt: '2026-10-09T00:00:00.000Z',
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useToastStore.setState({ toasts: [] });
  delete window.dela;
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

it('lists connections and reports the probe result of a test', async () => {
  window.dela = {
    remotes: {
      list: async () => [connection],
      probe: async () => ({ ok: true, message: 'gpu-01 · Linux x86_64' }),
    },
  } as unknown as DelaApi;

  await act(async () => root.render(<RemoteSection />));
  expect(container.textContent).toContain('gpu-box:2222');
  expect(container.textContent).toContain('ssh 默认');
  expect(container.textContent).toContain('未连接');
  // 头像方块用该连接自己的取色，而不是固定的灰底。
  expect(
    container.querySelector('[data-setting-id="remote-r-1"] [aria-hidden]')?.getAttribute('style'),
  ).toMatch(/--cal-/);

  await act(async () => button('测试连接').click());
  expect(container.textContent).toContain('可用');
  expect(container.textContent).toContain('gpu-01 · Linux x86_64');
});

it('shows the reason main refused the removal verbatim', async () => {
  const remove = vi.fn(async () => {
    throw new Error('该连接下还有项目，请先移除项目');
  });
  window.dela = {
    remotes: { list: async () => [connection], remove },
  } as unknown as DelaApi;

  await act(async () => root.render(<RemoteSection />));
  await act(async () => button('删除').click());
  expect(remove).toHaveBeenCalledWith('r-1');
  expect(useToastStore.getState().toasts[0]).toMatchObject({
    variant: 'error',
    title: '删除连接失败',
    description: '该连接下还有项目，请先移除项目',
  });
  expect(container.textContent).toContain('实验室主机');
});

it('guides to the wizard when there is no connection yet', async () => {
  window.dela = { remotes: { list: async () => [] } } as unknown as DelaApi;

  await act(async () => root.render(<RemoteSection />));
  expect(container.textContent).toContain('还没有 SSH 连接');
  // 空状态给的是可执行的下一步，而不是一句「去别处找」。
  expect(button('新建连接').textContent).toContain('新建连接');
});
