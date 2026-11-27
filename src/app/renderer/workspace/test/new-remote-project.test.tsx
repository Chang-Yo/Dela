// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../preload/api';
import type { WorkspaceEntry, WorkspaceState } from '../../../../modules/workspace/contract';
import type {
  RemoteBrowseResult,
  RemoteConnection,
  RemoteSetupProgress,
} from '../../../../modules/remotes/contract';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好；会话镜像也在加载时订阅推送。
const { workspaceApi, remotesApi, listeners, bridge } = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const remotes: Record<string, (input: never) => unknown> = {};
  const listeners = new Map<string, (payload: unknown) => void>();
  const subscribe = (channel: string, listener: (payload: unknown) => void) => {
    listeners.set(channel, listener);
    return () => {};
  };
  const bridge = {
    invoke: async (channel: string, input: never) => {
      const [namespace, name] = channel.split(':');
      return (namespace === 'remotes' ? remotes : handlers)[name!]!(input);
    },
    subscribe,
  };
  window.dela = {
    bridge,
  } as unknown as DelaApi;
  return { workspaceApi: handlers, remotesApi: remotes, listeners, bridge };
});
import { NewRemoteProjectDialog } from '../remote/NewRemoteProjectDialog';
import { usePreferences } from '../../shell/preferences';
import { useRemoteState } from '../../../../modules/remotes/view';
import { useWorkspaceStore } from '../../../../modules/workspace/view';

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const emptyState: WorkspaceState = { entries: [], directory: '/tmp/dela' };

const saved: RemoteConnection = {
  id: 'r-1',
  label: '实验室主机',
  host: 'gpu-box',
  port: 2222,
  keyPath: null,
  createdAt: '2026-10-09T00:00:00.000Z',
};

const created: WorkspaceEntry = {
  id: 'p-remote',
  parentId: null,
  name: '我的实验',
  kind: 'project',
  sourceId: null,
  path: '/home/u/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const listing = (path: string, names: string[]): RemoteBrowseResult => ({
  path,
  parent: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/',
  directories: names.map((name) => ({
    name,
    path: `${path === '/' ? '' : path}/${name}`,
    directory: true,
    size: null,
    modifiedAt: null,
  })),
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Radix 的 Checkbox、Switch 要量尺寸；jsdom 没有 ResizeObserver。
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  localStorage.clear();
  Element.prototype.scrollIntoView ??= () => {};
  useWorkspaceStore.setState({ workspace: emptyState, loaded: true, error: null });
  usePreferences.setState({ remoteLastDirectory: {} });
  useRemoteState.setState({ pushedChannels: null, homes: {}, setupLog: [] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

const input = (label: string) =>
  document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;

function setValue(target: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value);
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

const Providers = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

// 查询的通知按宏任务派发：连接、读目录各占一拍。
const flush = () =>
  act(async () => {
    for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

function api(overrides: Record<string, unknown> = {}, workspace = {}) {
  const remotes = {
    list: vi.fn(async () => [saved]),
    configHosts: vi.fn(async () => []),
    helperStates: vi.fn(async () => []),
    prepare: vi.fn(async () => ({ ok: true, message: '', home: '/home/u' })),
    browse: vi.fn(async ({ path }: { path: string }) =>
      path === '/home/u' ? listing('/home/u', ['proj', '.cache']) : listing(path, []),
    ),
    ...overrides,
  };
  Object.assign(remotesApi, remotes);
  Object.assign(workspaceApi, { state: async () => emptyState, ...workspace });
  window.dela = { bridge } as unknown as DelaApi;
  return {
    remotes,
    emit: (progress: RemoteSetupProgress) => listeners.get('remotes:setupProgress')!(progress),
  };
}

async function render(onImported = vi.fn()) {
  await act(async () =>
    root.render(
      <Providers>
        <NewRemoteProjectDialog onClose={() => {}} onImported={onImported} open />
      </Providers>,
    ),
  );
  await flush();
  return onImported;
}

it('connects the first saved server and browses from its home directory', async () => {
  const { remotes } = api();
  await render();
  expect(remotes.prepare).toHaveBeenCalledWith({
    label: '实验室主机',
    host: 'gpu-box',
    port: 2222,
    keyPath: null,
  });
  expect(remotes.browse).toHaveBeenCalledWith({
    draft: expect.objectContaining({ host: 'gpu-box' }),
    path: '/home/u',
  });
  expect(document.body.textContent).toContain('proj');
  expect(document.body.textContent).not.toContain('.cache');
  expect(input('项目名称').value).toBe('u');
});

it('selects on click, enters on double click, and imports under a custom name', async () => {
  const importRemoteProject = vi.fn(async () => created);
  const state = vi.fn(async () => ({ ...emptyState, entries: [created] }));
  const { remotes } = api({}, { importRemoteProject, state });
  const onImported = await render();

  const row = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"] button')][0]!;
  await act(async () => row().click());
  expect(input('项目名称').value).toBe('proj');
  expect(document.body.textContent).toContain('~/proj');

  await act(async () => setValue(input('项目名称'), '我的实验'));
  await act(async () => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await flush();
  expect(remotes.browse).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: '/home/u/proj' }),
  );
  expect(input('项目名称').value).toBe('我的实验');

  await act(async () => button('添加项目').click());
  expect(importRemoteProject).toHaveBeenCalledWith({
    remoteId: 'r-1',
    path: '/home/u/proj',
    name: '我的实验',
  });
  expect(onImported).toHaveBeenCalledWith(created);
  expect(usePreferences.getState().remoteLastDirectory['gpu-box']).toBe('/home/u/proj');
});

it('saves an ~/.ssh/config host as a connection when it is picked', async () => {
  const added: RemoteConnection = { ...saved, id: 'r-2', label: 'lab', host: 'lab', port: null };
  let list = [saved];
  const save = vi.fn(async () => {
    list = [saved, added];
    return added;
  });
  const { remotes } = api({
    list: vi.fn(async () => list),
    configHosts: vi.fn(async () => [{ alias: 'lab', hostName: '10.0.0.9', user: 'u', port: null }]),
    save,
  });
  await render();

  // Radix Select 在 jsdom 里用键盘展开（与 entry-dialogs-link 的测试同一种方式）。
  await act(async () =>
    document
      .querySelector('[aria-label="服务器"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes('10.0.0.9'),
  )!;
  expect(option.textContent).toContain('lab');
  await act(async () =>
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  await flush();
  expect(save).toHaveBeenCalledWith({ label: 'lab', host: 'lab', port: null, keyPath: null });
  expect(remotes.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'lab' }));
});
