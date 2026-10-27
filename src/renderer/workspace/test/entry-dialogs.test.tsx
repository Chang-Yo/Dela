// @vitest-environment jsdom
// 新建项目弹窗的「导入已有文件夹」入口：调用主进程登记外部目录，成功后与新建项目
// 走同一套后续动作（刷新镜像、关弹窗、打开项目）；取消选择时什么都不发生。
// 「连接远程目录」入口把外层弹窗交给远程向导。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspaceEntry, WorkspaceState } from '../../../shared/api';
import { EntryDialogs, type EntryDialogRequest } from '../entry-dialogs';
import { useWorkspaceStore } from '../store';

let container: HTMLDivElement;
let root: Root;

const emptyState: WorkspaceState = { entries: [], directory: '/tmp/dela' };

const external: WorkspaceEntry = {
  id: 'p-1',
  parentId: null,
  name: '我的代码',
  kind: 'project',
  sourceId: null,
  path: 'D:/code/我的代码',
  updatedAt: '2026-10-08T00:00:00.000Z',
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

/** 弹窗经 Portal 挂到 body，不在 container 子树里。 */
function dialogButton(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

async function render(request: EntryDialogRequest, callbacks: object = {}) {
  await act(async () =>
    root.render(<EntryDialogs onClose={() => {}} request={request} {...callbacks} />),
  );
}

it('imports an existing folder as a project and opens it', async () => {
  const importProjectFolder = vi.fn(async () => external);
  const getState = vi.fn(async () => ({ ...emptyState, entries: [external] }));
  window.dela = { workspace: { importProjectFolder, getState } } as unknown as DelaApi;
  const onClose = vi.fn();
  const onOpenProject = vi.fn();
  await render({ action: 'project', id: null }, { onClose, onOpenProject });
  await act(async () => dialogButton('导入已有文件夹').click());
  expect(importProjectFolder).toHaveBeenCalledOnce();
  expect(getState).toHaveBeenCalledOnce();
  expect(onOpenProject).toHaveBeenCalledWith('p-1');
  expect(onClose).toHaveBeenCalledOnce();
});

it('keeps the dialog open when the folder picker is cancelled', async () => {
  const getState = vi.fn(async () => emptyState);
  window.dela = {
    workspace: { importProjectFolder: async () => null, getState },
  } as unknown as DelaApi;
  const onClose = vi.fn();
  const onOpenProject = vi.fn();
  await render({ action: 'project', id: null }, { onClose, onOpenProject });
  await act(async () => dialogButton('导入已有文件夹').click());
  expect(onOpenProject).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(getState).not.toHaveBeenCalled();
});

it('reports a rejected folder without closing', async () => {
  window.dela = {
    workspace: {
      importProjectFolder: async () => {
        throw new Error('请选择一个文件夹');
      },
      getState: async () => emptyState,
    },
  } as unknown as DelaApi;
  const onClose = vi.fn();
  await render({ action: 'project', id: null }, { onClose });
  await act(async () => dialogButton('导入已有文件夹').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('请选择一个文件夹');
  expect(onClose).not.toHaveBeenCalled();
});

it('hands the new-project dialog over to the remote project panel', async () => {
  const list = vi.fn(async () => []);
  window.dela = {
    remotes: {
      list,
      configHosts: async () => [],
      onHelperState: () => () => {},
      onSetupProgress: () => () => {},
    },
    workspace: { getState: async () => emptyState },
  } as unknown as DelaApi;
  await render({ action: 'project', id: null });
  expect(list).not.toHaveBeenCalled();

  await act(async () => dialogButton('新建远程项目').click());
  // 面板接管并自己拉一次连接列表；外层弹窗让出，不会两层叠在一起。
  expect(list).toHaveBeenCalledOnce();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
});
