// @vitest-environment jsdom
// 新建远程项目面板：选中服务器就连（失败时原样给出原因、能重试），连上后从主目录起浏览，
// 单击选中 / 双击进入，名称跟着目录走、改过就不再跟；ssh config 里的主机选中即保存为连接。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  DelaApi,
  RemoteBrowseResult,
  RemoteConnection,
  RemoteSetupProgress,
  WorkspaceEntry,
  WorkspaceState,
} from '../../../shared/api';
import { NewRemoteProjectDialog } from '../remote/NewRemoteProjectDialog';
import { useRemoteState } from '../remote/remote-state';
import { useWorkspaceStore } from '../store';
import { showToast } from '../../app/toasts';

vi.mock('../../app/toasts', () => ({ showToast: vi.fn() }));

let container: HTMLDivElement;
let root: Root;

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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  localStorage.clear();
  Element.prototype.scrollIntoView ??= () => {};
  useWorkspaceStore.setState({ workspace: emptyState, loaded: true, error: null });
  useRemoteState.setState({
    connections: null,
    candidates: [],
    channels: {},
    homes: {},
    listings: {},
    lastDirectory: {},
  });
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

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

function api(overrides: Partial<DelaApi['remotes']> = {}, workspace = {}) {
  const listeners: ((progress: RemoteSetupProgress) => void)[] = [];
  const remotes = {
    list: vi.fn(async () => [saved]),
    configHosts: vi.fn(async () => []),
    onHelperState: () => () => {},
    onSetupProgress: (listener: (progress: RemoteSetupProgress) => void) => {
      listeners.push(listener);
      return () => {};
    },
    prepare: vi.fn(async () => ({ ok: true, message: '', home: '/home/u' })),
    browse: vi.fn(async (_draft: unknown, path: string) =>
      path === '/home/u' ? listing('/home/u', ['proj', '.cache']) : listing(path, []),
    ),
    ...overrides,
  };
  window.dela = {
    remotes,
    workspace: { getState: async () => emptyState, ...workspace },
  } as unknown as DelaApi;
  return {
    remotes,
    emit: (progress: RemoteSetupProgress) => listeners.forEach((l) => l(progress)),
  };
}

async function render(onImported = vi.fn()) {
  await act(async () =>
    root.render(<NewRemoteProjectDialog onClose={() => {}} onImported={onImported} open />),
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
  expect(remotes.browse).toHaveBeenCalledWith(
    expect.objectContaining({ host: 'gpu-box' }),
    '/home/u',
  );
  // 隐藏目录默认不显示，名称默认取当前目录名。
  expect(document.body.textContent).toContain('proj');
  expect(document.body.textContent).not.toContain('.cache');
  expect(input('项目名称').value).toBe('u');
});

it('shows why the server failed, keeps the log open, and retries on demand', async () => {
  let fail = true;
  const { remotes, emit } = api({
    prepare: vi.fn(async () => {
      emit({ step: 'probe', ok: true, detail: 'Linux x86_64' });
      emit({ step: 'start', ok: false, detail: 'helper 启动失败（诊断：noexec）' });
      return fail
        ? { ok: false, message: 'helper 启动失败（诊断：noexec）', home: null }
        : { ok: true, message: '', home: '/home/u' };
    }),
  });
  await render();
  const alert = document.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain('无法在这台服务器上启动 helper');
  expect(alert?.textContent).toContain('noexec');
  // 日志默认展开。
  expect(document.querySelector('[role="log"]')?.textContent).toContain('Linux x86_64');
  expect(button('添加项目').disabled).toBe(true);

  fail = false;
  await act(async () => button('重试').click());
  await flush();
  expect(remotes.prepare).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('proj');
});

it('selects on click, enters on double click, and imports under a custom name', async () => {
  const importRemoteProject = vi.fn(async () => created);
  const getState = vi.fn(async () => ({ ...emptyState, entries: [created] }));
  api({}, { importRemoteProject, getState });
  const onImported = await render();

  const row = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"] button')][0]!;
  await act(async () => row().click());
  expect(input('项目名称').value).toBe('proj');
  expect(document.body.textContent).toContain('~/proj');

  await act(async () => setValue(input('项目名称'), '我的实验'));
  await act(async () => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await flush();
  // 进到 proj 里面：项目目录就是当前路径；改过的名字不再跟着目录变。
  expect(window.dela!.remotes.browse).toHaveBeenLastCalledWith(expect.anything(), '/home/u/proj');
  expect(input('项目名称').value).toBe('我的实验');

  await act(async () => button('添加项目').click());
  expect(importRemoteProject).toHaveBeenCalledWith('r-1', '/home/u/proj', '我的实验');
  expect(onImported).toHaveBeenCalledWith(created);
  // 下次打开这台服务器回到这里。
  expect(useRemoteState.getState().lastDirectory['gpu-box']).toBe('/home/u/proj');
});

it('jumps to a typed path from the path bar', async () => {
  const { remotes } = api();
  await render();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="编辑路径"]')!.click(),
  );
  await act(async () => setValue(input('远端路径'), '~/data/'));
  await act(async () =>
    input('远端路径').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  await flush();
  expect(remotes.browse).toHaveBeenLastCalledWith(expect.anything(), '/home/u/data');
});

it('creates a folder in the current directory and selects it', async () => {
  let names = ['proj'];
  const mkdir = vi.fn(async (_draft: unknown, parent: string, name: string) => {
    names = [...names, name];
    return `${parent}/${name}`;
  });
  api({
    mkdir,
    browse: vi.fn(async (_draft: unknown, path: string) => listing(path, names)),
  });
  await render();

  await act(async () => button('新建文件夹').click());
  await act(async () => setValue(input('新文件夹名称'), 'exp2'));
  await act(async () =>
    input('新文件夹名称').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  await flush();
  expect(mkdir).toHaveBeenCalledWith(
    expect.objectContaining({ host: 'gpu-box' }),
    '/home/u',
    'exp2',
  );
  expect(document.querySelector('[aria-label="新文件夹名称"]')).toBeNull();
  expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain('exp2');
  expect(input('项目名称').value).toBe('exp2');
});

it('reports a failed or invalid folder name in a toast and keeps the name row open', async () => {
  const mkdir = vi.fn(async () => Promise.reject(new Error('mkdir: File exists')));
  api({ mkdir });
  await render();
  await act(async () => button('新建文件夹').click());
  const submit = (name: string) =>
    act(async () => {
      setValue(input('新文件夹名称'), name);
      input('新文件夹名称').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

  // 带路径分隔符的名字不发到远端，直接给出原因。
  await submit('aa/dd');
  await flush();
  expect(mkdir).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenLastCalledWith(
    expect.objectContaining({ variant: 'error', description: expect.stringContaining('/') }),
  );

  await submit('proj');
  await flush();
  expect(showToast).toHaveBeenLastCalledWith(
    expect.objectContaining({ description: expect.stringContaining('File exists') }),
  );
  expect(input('新文件夹名称').value).toBe('proj');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('stays open when a toast is clicked, but closes on a real outside click', async () => {
  api();
  const onClose = vi.fn();
  await act(async () =>
    root.render(<NewRemoteProjectDialog onClose={onClose} onImported={() => {}} open />),
  );
  await flush();
  // toast 与对话框不在同一个 portal：关掉它不能被当成点了对话框外面。
  const host = document.createElement('div');
  host.setAttribute('data-toast-host', '');
  const close = document.createElement('button');
  host.append(close);
  document.body.append(host);
  // Radix 把左键的「点到外面」推迟到随后的 click 才判定。
  const press = (target: Element) => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  };
  await act(async () => press(close));
  await flush();
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => press(document.body));
  await flush();
  expect(onClose).toHaveBeenCalled();
  host.remove();
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
  expect(useRemoteState.getState().candidates.map((host) => host.alias)).toEqual(['lab']);

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
