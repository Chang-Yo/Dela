// @vitest-environment jsdom
// 远程连接向导：探测失败原样显示 main 的 message 且不保存；探测成功才落库（已存在的连接
// 不重复保存），随后逐层选目录并登记项目。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  DelaApi,
  RemoteConnection,
  RemoteProbe,
  WorkspaceEntry,
  WorkspaceState,
} from '../../../shared/api';
import { RemoteConnectionWizard } from '../remote-wizard';
import { useWorkspaceStore } from '../store';

let container: HTMLDivElement;
let root: Root;

const emptyState: WorkspaceState = { entries: [], views: {}, directory: '/tmp/dela' };

const saved: RemoteConnection = {
  id: 'r-1',
  label: '实验室主机',
  host: 'gpu-box',
  port: 2222,
  keyPath: '~/.ssh/id_ed25519',
  createdAt: '2026-10-09T00:00:00.000Z',
};

const created: WorkspaceEntry = {
  id: 'p-remote',
  parentId: null,
  name: 'proj',
  kind: 'project',
  sourceId: null,
  path: '/home/u/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useWorkspaceStore.setState({ workspace: emptyState, loaded: true, error: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

/** 弹窗经 Portal 挂到 body，按可见文字取按钮；exact 用于区分「连接」与「新建连接」。 */
function button(text: string, exact = false): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    exact ? item.textContent?.trim() === text : item.textContent?.includes(text),
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const inputByLabel = (label: string) =>
  document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;

async function renderWizard(onImported = vi.fn()) {
  await act(async () =>
    root.render(<RemoteConnectionWizard onClose={() => {}} onImported={onImported} open />),
  );
  return onImported;
}

it('shows the probe failure message verbatim and does not save', async () => {
  const probe = vi.fn(async (): Promise<RemoteProbe> => ({
    ok: false,
    message: '认证失败：Permission denied (publickey)',
  }));
  const save = vi.fn();
  window.dela = {
    remotes: { list: async () => [saved], probe, save },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('实验室主机').click());
  // 已存在的连接直接进入「连接」一步，字段沿用已保存值。
  expect(document.body.textContent).toContain('~/.ssh/id_ed25519');
  await act(async () => button('连接', true).click());

  expect(probe).toHaveBeenCalledWith({
    label: '实验室主机',
    host: 'gpu-box',
    port: 2222,
    keyPath: '~/.ssh/id_ed25519',
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    '认证失败：Permission denied (publickey)',
  );
  expect(save).not.toHaveBeenCalled();
});

it('saves a new connection only after a successful probe, then registers the directory', async () => {
  const save = vi.fn(async () => ({ ...saved, id: 'r-9', port: null, keyPath: null }));
  const browse = vi.fn(async (_draft: unknown, path: string | null) =>
    path === null
      ? {
          path: '/home/u',
          parent: '/home',
          home: '/home/u',
          directory: true,
          directories: [
            { name: 'proj', path: '/home/u/proj', directory: true, size: null, modifiedAt: null },
          ],
        }
      : { path, parent: '/home/u', home: null, directory: true, directories: [] },
  );
  const importRemoteProject = vi.fn(async () => created);
  const getState = vi.fn(async () => ({ ...emptyState, entries: [created] }));
  window.dela = {
    remotes: {
      list: async () => [],
      probe: async () => ({ ok: true, message: 'gpu-01 · Linux x86_64' }),
      save,
      browse,
    },
    workspace: { importRemoteProject, getState },
  } as unknown as DelaApi;

  const onImported = await renderWizard();
  await act(async () => button('新建连接', true).click());
  await act(async () => setValue(inputByLabel('SSH 目的地'), 'gpu-box'));
  await act(async () => button('下一步', true).click());
  await act(async () => button('连接', true).click());

  expect(save).toHaveBeenCalledWith({
    label: undefined,
    host: 'gpu-box',
    port: null,
    keyPath: null,
  });
  expect(document.body.textContent).toContain('gpu-01 · Linux x86_64');

  await act(async () => button('下一步：选择目录', true).click());
  expect(browse).toHaveBeenNthCalledWith(
    1,
    { label: undefined, host: 'gpu-box', port: null, keyPath: null },
    null,
  );
  expect(document.body.textContent).toContain('/home/u');

  await act(async () => button('proj', true).click());
  expect(browse).toHaveBeenNthCalledWith(
    2,
    { label: undefined, host: 'gpu-box', port: null, keyPath: null },
    '/home/u/proj',
  );

  await act(async () => button('添加为项目', true).click());
  expect(importRemoteProject).toHaveBeenCalledWith('r-9', '/home/u/proj');
  expect(getState).toHaveBeenCalledTimes(1);
  expect(onImported).toHaveBeenCalledWith(created);
});

it('requires a destination before advancing', async () => {
  window.dela = {
    remotes: { list: async () => [] },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('新建连接', true).click());
  await act(async () => button('下一步', true).click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('请输入 SSH 目的地');
});
