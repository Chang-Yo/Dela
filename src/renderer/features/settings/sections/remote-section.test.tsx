// @vitest-environment jsdom
// 设置 › 远程：列出已保存连接与实时通道状态（不可用时给出原因）；编辑走共用的连接表单，
// 删除失败（连接下还有项目）原样提示 main 的原因。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, RemoteChannelState, RemoteConnection } from '../../../../shared/api';
import { useRemoteState } from '../../../workspace/remote/remote-state';
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
  useRemoteState.setState({ connections: null, candidates: [], channels: {} });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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

it('lists connections with their live channel state', async () => {
  let emit: (states: RemoteChannelState[]) => void = () => {};
  window.dela = {
    remotes: {
      list: async () => [connection],
      configHosts: async () => [],
      onHelperState: (listener: (states: RemoteChannelState[]) => void) => {
        emit = listener;
        return () => {};
      },
    },
  } as unknown as DelaApi;

  await act(async () => root.render(<RemoteSection />));
  expect(container.textContent).toContain('gpu-box:2222');
  expect(container.textContent).toContain('未连接');
  // 头像方块用该连接自己的取色，而不是固定的灰底。
  expect(
    container.querySelector('[data-setting-id="remote-r-1"] [aria-hidden]')?.getAttribute('style'),
  ).toMatch(/--cal-/);

  await act(async () =>
    emit([{ destination: 'gpu-box', state: 'unavailable', reason: '认证失败', since: 0 }]),
  );
  expect(container.textContent).toContain('不可用');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('认证失败');
});

it('edits in the shared form and shows the reason main refused the removal verbatim', async () => {
  const remove = vi.fn(async () => {
    throw new Error('该连接下还有项目，请先移除项目');
  });
  window.dela = {
    remotes: {
      list: async () => [connection],
      configHosts: async () => [],
      onHelperState: () => () => {},
      remove,
    },
  } as unknown as DelaApi;

  await act(async () => root.render(<RemoteSection />));
  await act(async () => button('编辑').click());
  expect(document.querySelector<HTMLInputElement>('[aria-label="SSH 目的地"]')?.value).toBe(
    'gpu-box',
  );
  await act(async () => button('删除连接').click());
  expect(remove).toHaveBeenCalledWith('r-1');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    '该连接下还有项目，请先移除项目',
  );
});
