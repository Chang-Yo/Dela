// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceEntry, WorkspaceState } from '../../../../modules/workspace/contract';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好；会话镜像也在加载时订阅推送。
const { api, desktop, mediaStub } = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const subscribe = () => () => {};
  const desktop = {
    bridge: {
      // 远程连接与通道状态随目录树加载，这里的用例不依赖它们。
      invoke: async (channel: string, input: never) =>
        channel.startsWith('remotes:') ? [] : handlers[channel.slice('workspace:'.length)]?.(input),
      subscribe,
    },
  } as unknown as NonNullable<typeof window.dela>;
  window.dela = desktop;
  // explorer-state 在模块求值时就调 window.matchMedia，jsdom 没有这个 API。
  const mediaStub = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal('matchMedia', mediaStub);
  // Radix 的浮层要量尺寸；jsdom 没有 ResizeObserver。
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return { api: handlers, desktop, mediaStub };
});
import { useTreeState } from '../../navigation/store';
import { useWorkspaceStore } from '../../../../modules/workspace/view';
import { WorkbenchExplorer, currentContainerOf } from '../WorkbenchExplorer';

let container: HTMLDivElement;
let root: Root;

const remoteProject: WorkspaceEntry = {
  id: 'p-remote',
  parentId: null,
  name: '远端项目',
  kind: 'project',
  sourceId: null,
  path: '/home/u/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const localProject: WorkspaceEntry = {
  id: 'p-local',
  parentId: null,
  name: '本地项目',
  kind: 'project',
  sourceId: null,
  path: 'D:/dela/workspace/本地项目',
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const localFolder: WorkspaceEntry = {
  id: 'f-local',
  parentId: 'p-local',
  name: '资料',
  kind: 'folder',
  sourceId: null,
  path: 'D:/dela/workspace/本地项目/资料',
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const workspace: WorkspaceState = {
  entries: [remoteProject, localProject],
  directory: 'D:/dela',
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', mediaStub);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // 选中行会滚进视口；jsdom 没有 scrollIntoView。
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  delete window.dela;
  for (const name of Object.keys(api)) delete api[name];
  useWorkspaceStore.setState({ workspace, loaded: true, error: null });
  useTreeState.setState({ expanded: [], query: '', selected: null, pendingCreate: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const newButton = () => document.querySelector<HTMLElement>('[aria-label="新建"]');
const collapseButton = () => document.querySelector('[aria-label="全部收起"]');
const blank = () => document.querySelector<HTMLElement>('#workspace-explorer > .overflow-y-auto')!;

const nameInput = () => document.querySelector<HTMLInputElement>('[aria-label="新文件名称"]');

async function render(projectId: string | null, activeDocKey: string | null = null) {
  const onAction = vi.fn();
  const onCreated = vi.fn();
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkbenchExplorer
          activeDocKey={activeDocKey}
          onAction={onAction}
          onCreated={onCreated}
          onOpenDocument={() => {}}
          onOpenToSide={() => {}}
          projectId={projectId}
        />
      </QueryClientProvider>,
    ),
  );
  return { onAction, onCreated };
}

it('hides the write entries while a remote project is open', async () => {
  const { onAction } = await render(remoteProject.id);
  expect(newButton()).toBeNull();
  expect(collapseButton()).toBeTruthy();

  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onAction).not.toHaveBeenCalled();
  expect(nameInput()).toBeNull();
});

/** 受控 input 要走原生 setter 才会触发 React 的 onChange。 */
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const key = (input: HTMLInputElement, name: string) =>
  input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

it('creates files inline: double-click shows a name row, Enter submits, no dialog', async () => {
  const created: WorkspaceEntry = {
    ...localProject,
    id: 'D:/dela/workspace/本地项目/a/b.md',
    name: 'b.md',
    kind: 'file',
  };
  const create = vi.fn(async () => created);
  api.create = create;
  api.state = async () => workspace;
  window.dela = desktop;
  const { onAction, onCreated } = await render(localProject.id);
  expect(newButton()).toBeTruthy();

  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onAction).not.toHaveBeenCalled();
  const input = nameInput()!;
  expect(document.activeElement).toBe(input);
  await act(async () => type(input, 'a/b.md'));
  await act(async () => key(input, 'Enter'));
  expect(create).toHaveBeenCalledWith({ name: 'a/b.md', parentId: localProject.id, kind: 'file' });
  expect(onCreated).toHaveBeenCalledWith(created);
  expect(nameInput()).toBeNull();
});

// #91：切到空项目后，上一个项目选中的文件夹不能再当新建目标。
it('falls back to the current project root when the selection belongs to another project', () => {
  useWorkspaceStore.setState({
    workspace: { ...workspace, entries: [...workspace.entries, localFolder] },
    loaded: true,
    error: null,
  });
  expect(currentContainerOf(localFolder.id, remoteProject.id)).toBe(remoteProject.id);
  expect(currentContainerOf(localFolder.id, localProject.id)).toBe(localFolder.id);
  expect(currentContainerOf(null, localProject.id)).toBe(localProject.id);
  expect(currentContainerOf(localProject.id, null)).toBe(localProject.id);
});

const treeRow = (label: string) =>
  [...document.querySelectorAll('[role="treeitem"]')].find(
    (el) => el.getAttribute('aria-label') === label,
  );

it('hides remote and external projects from the library tree', async () => {
  const externalProject: WorkspaceEntry = {
    ...localProject,
    id: 'p-external',
    name: '外部项目',
    path: 'D:/code/外部项目',
  };
  const externalFolder: WorkspaceEntry = {
    ...localFolder,
    id: 'f-external',
    name: '外部资料',
    parentId: externalProject.id,
    path: 'D:/code/外部项目/外部资料',
  };
  useWorkspaceStore.setState({
    workspace: { ...workspace, entries: [...workspace.entries, externalProject, externalFolder] },
    loaded: true,
    error: null,
  });
  useTreeState.setState({ expanded: [externalProject.id] });
  await render(null);
  expect(treeRow('本地项目')).toBeTruthy();
  expect(treeRow('远端项目')).toBeUndefined();
  expect(treeRow('外部项目')).toBeUndefined();
  expect(treeRow('外部资料')).toBeUndefined();
});
