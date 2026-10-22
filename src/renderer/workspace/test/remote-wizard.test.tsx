// @vitest-environment jsdom
// 远程连接向导：自检失败原样透出 main 的 message 且不落库；helper 起不来时降级但仍可继续。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  DelaApi,
  RemoteConnection,
  RemotePrepare,
  RemoteSetupProgress,
  WorkspaceEntry,
  WorkspaceState,
} from '../../../shared/api';
import { RemoteConnectionWizard } from '../remote-wizard';
import { useWorkspaceStore } from '../store';
import { useProjectNavPrefs } from '../../navigation/store';

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

/** 主进程推进度：订阅者由组件注册，这里只负责把事件按真实顺序喂进去。 */
function progressChannel() {
  const listeners: ((progress: RemoteSetupProgress) => void)[] = [];
  return {
    onSetupProgress: (listener: (progress: RemoteSetupProgress) => void) => {
      listeners.push(listener);
      return () => {};
    },
    emit(...progress: RemoteSetupProgress[]) {
      for (const listener of listeners) for (const item of progress) listener(item);
    },
  };
}

async function renderWizard(onImported = vi.fn()) {
  await act(async () =>
    root.render(<RemoteConnectionWizard onClose={() => {}} onImported={onImported} open />),
  );
  return onImported;
}

it('shows the prepare failure message verbatim and does not save', async () => {
  const prepare = vi.fn(async (): Promise<RemotePrepare> => {
    progress.emit({ step: 'probe', ok: false, detail: '认证失败：Permission denied (publickey)' });
    return {
      ok: false,
      message: '认证失败：Permission denied (publickey)',
    };
  });
  const save = vi.fn();
  const progress = progressChannel();
  window.dela = {
    remotes: {
      list: async () => [saved],
      prepare,
      save,
      onSetupProgress: progress.onSetupProgress,
    },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('实验室主机').click());
  // 已存在的连接直接进入「连接」一步：摘要里的目的地就是刚选中的那台主机。
  expect(document.body.textContent).toContain('gpu-box:2222');
  await act(async () => button('连接', true).click());

  expect(prepare).toHaveBeenCalledWith({
    label: '实验室主机',
    host: 'gpu-box',
    port: 2222,
    keyPath: '~/.ssh/id_ed25519',
  });
  expect(document.querySelector('[role="log"]')?.textContent).toContain(
    '认证失败：Permission denied (publickey)',
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    '认证失败：Permission denied (publickey)',
  );
  expect(save).not.toHaveBeenCalled();
});

// 远程项目只走 helper：它在这台服务器上起不来，向导就停在「连接」，不保存也不往下走。
it('blocks and does not save when the helper cannot run on the server', async () => {
  const progress = progressChannel();
  const prepare = vi.fn(async (): Promise<RemotePrepare> => {
    progress.emit({ step: 'probe', detail: 'gpu-01 · Linux x86_64' });
    progress.emit({ step: 'upload', detail: '开始上传 6912345 字节' });
    progress.emit({ step: 'start', ok: false, detail: 'helper 启动失败（诊断：noexec）' });
    return { ok: false, message: 'helper 无法在这台服务器上运行：helper 启动失败（诊断：noexec）' };
  });
  const browse = vi.fn();
  window.dela = {
    remotes: {
      list: async () => [saved],
      prepare,
      save: vi.fn(),
      browse,
      onSetupProgress: progress.onSetupProgress,
    },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('实验室主机').click());
  await act(async () => button('连接', true).click());

  const log = document.querySelector('[role="log"]');
  expect(log?.textContent).toContain('开始上传 6912345 字节');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('noexec');
  // 停在这一步：提交按钮还是「连接」，没有进入目录选择。
  expect(document.querySelector('button[type="submit"]')?.textContent).toContain('连接');
  expect(browse).not.toHaveBeenCalled();
});

it('reports a failed helper step with its reason in the log', async () => {
  const progress = progressChannel();
  const prepare = vi.fn(async (): Promise<RemotePrepare> => {
    progress.emit({ step: 'probe', detail: 'gpu-01 · Linux x86_64' });
    progress.emit({ step: 'tunnel', ok: false, detail: '隧道未就绪' });
    return { ok: false, message: 'helper 无法在这台服务器上运行：隧道未就绪' };
  });
  window.dela = {
    remotes: {
      list: async () => [saved],
      prepare,
      save: vi.fn(),
      onSetupProgress: progress.onSetupProgress,
    },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('实验室主机').click());
  await act(async () => button('连接', true).click());

  const failed = document.querySelector('[role="alert"]');
  expect(failed?.textContent).toContain('隧道未就绪');
  // 失败可以「上一步」改了再试：按钮还在，没有被禁用。
  expect(button('上一步').disabled).toBe(false);
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
  const progress = progressChannel();
  const prepare = vi.fn(async (): Promise<RemotePrepare> => {
    progress.emit({ step: 'probe', detail: 'gpu-01 · Linux x86_64' });
    progress.emit({ step: 'ready', ok: true, detail: 'helper 通道已就绪' });
    return { ok: true, message: 'gpu-01 · Linux x86_64' };
  });
  window.dela = {
    remotes: {
      list: async () => [],
      prepare,
      save,
      browse,
      onSetupProgress: progress.onSetupProgress,
    },
    workspace: { importRemoteProject, getState },
  } as unknown as DelaApi;
  // 这条项目行早先被侧栏的「移除项目入口」隐藏过：重新加进来时要能再看见。
  useProjectNavPrefs.setState({ projects: { [created.id]: { hidden: true } } });

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
  expect(document.body.textContent).toContain('helper 通道已就绪');

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
  // 「移除项目入口」只写隐藏偏好；同一远端目录重新导入会复用同一条，导入后必须撤掉隐藏。
  expect(useProjectNavPrefs.getState().projects[created.id]?.hidden).toBe(false);
});

it('fills the key path from the picker', async () => {
  const pickKey = vi.fn(async () => '/home/me/.ssh/id_ed25519');
  window.dela = {
    remotes: { list: async () => [], pickKey, onSetupProgress: progressChannel().onSetupProgress },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('新建连接', true).click());
  expect(inputByLabel('私钥文件').value).toBe('');

  await act(async () => button('选择…', true).click());
  expect(inputByLabel('私钥文件').value).toBe('/home/me/.ssh/id_ed25519');
});

it('requires a destination before advancing', async () => {
  window.dela = {
    remotes: { list: async () => [], onSetupProgress: progressChannel().onSetupProgress },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('新建连接', true).click());
  await act(async () => button('下一步', true).click());
  // 目的地为空时给出错误并停在「填写连接」，不进入带日志区的「连接」一步。
  expect(document.querySelector('[role="alert"]')).toBeTruthy();
  expect(document.querySelector('[role="log"]')).toBeNull();
});
