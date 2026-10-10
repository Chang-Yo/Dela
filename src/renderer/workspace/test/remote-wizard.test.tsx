// @vitest-environment jsdom
// 远程连接向导：自检失败原样显示 main 的 message 且不保存；自检通过才落库（已存在的连接
// 不重复保存），随后逐层选目录并登记项目。「连接」这一步现在真的引导 helper，所以还要覆盖
// 进度逐行进日志区、helper 起不来时给出失败原因与降级警告且允许继续。
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
      helper: false,
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

it('appends setup progress lines and shows the degraded warning without blocking', async () => {
  const progress = progressChannel();
  const prepare = vi.fn(async (): Promise<RemotePrepare> => {
    progress.emit({ step: 'probe', detail: 'gpu-01 · Linux x86_64' });
    progress.emit({ step: 'upload', detail: '开始上传 6912345 字节' });
    progress.emit({
      step: 'ready',
      ok: false,
      detail: 'helper 通道不可用（helper 只支持 Linux，远端是 Darwin），改用一次性 ssh',
    });
    return { ok: true, message: 'gpu-01 · Linux x86_64', helper: false };
  });
  window.dela = {
    remotes: {
      list: async () => [saved],
      prepare,
      save: vi.fn(),
      onSetupProgress: progress.onSetupProgress,
      browse: async (_draft: unknown, path: string | null) => ({
        path: path ?? '/home/u',
        parent: '/home',
        home: '/home/u',
        directory: true,
        directories: [],
      }),
    },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('实验室主机').click());
  await act(async () => button('连接', true).click());

  const log = document.querySelector('[role="log"]');
  expect(log?.textContent).toContain('探测');
  expect(log?.textContent).toContain('gpu-01 · Linux x86_64');
  expect(log?.textContent).toContain('上传');
  expect(log?.textContent).toContain('开始上传 6912345 字节');
  // 降级不是错误：日志里是警告行，而且仍然可以走到下一步。
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  expect(button('下一步：选择目录', true)).toBeTruthy();
});

it('reports a failed helper step with its reason in the log', async () => {
  const progress = progressChannel();
  const prepare = vi.fn(async (): Promise<RemotePrepare> => {
    progress.emit({ step: 'probe', detail: 'gpu-01 · Linux x86_64' });
    progress.emit({ step: 'tunnel', ok: false, detail: '隧道未就绪' });
    return { ok: true, message: 'gpu-01 · Linux x86_64', helper: false };
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
  expect(failed?.textContent).toContain('隧道');
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
    return { ok: true, message: 'gpu-01 · Linux x86_64', helper: true };
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

it('fills the key path from the picker and can clear it again', async () => {
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

  // 清空 = 交给 ssh config/agent：保存的动作在「连接」之后，这里只断言输入框回到了空。
  await act(async () => setValue(inputByLabel('私钥文件'), ''));
  expect(inputByLabel('私钥文件').value).toBe('');
});

it('requires a destination before advancing', async () => {
  window.dela = {
    remotes: { list: async () => [], onSetupProgress: progressChannel().onSetupProgress },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;

  await renderWizard();
  await act(async () => button('新建连接', true).click());
  await act(async () => button('下一步', true).click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('请输入 SSH 目的地');
});
