// @vitest-environment jsdom
// 打开远端项目时目录侧栏收掉写入口：「+ 新建」下拉不出现，空白处双击也不开新建笔记弹窗；
// 只读操作（全部收起）保留。本地项目树的这两个入口原样保留。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceEntry, WorkspaceState } from '../../../shared/api';
import { useNavigationStore as useTreeState } from '../../navigation/store';
import { useWorkspaceStore } from '../../workspace/store';

const mediaStub = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
});

let container: HTMLDivElement;
let root: Root;
let WorkbenchExplorer: typeof import('../WorkbenchExplorer').WorkbenchExplorer;

beforeAll(async () => {
  // explorer-state 在模块求值时就调 window.matchMedia，jsdom 没有这个 API。
  vi.stubGlobal('matchMedia', mediaStub);
  ({ WorkbenchExplorer } = await import('../WorkbenchExplorer'));
});

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
  path: 'D:/code/本地项目',
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const workspace: WorkspaceState = {
  entries: [remoteProject, localProject],
  views: {},
  directory: 'D:/dela',
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', mediaStub);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useWorkspaceStore.setState({ workspace, loaded: true, error: null });
  useTreeState.setState({ expanded: [], query: '', selected: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
});

const newButton = () => document.querySelector('[aria-label="新建"]');
const collapseButton = () => document.querySelector('[aria-label="全部收起"]');
const blank = () => document.querySelector<HTMLElement>('#workspace-explorer > .overflow-y-auto')!;

async function render(projectId: string) {
  const onAction = vi.fn();
  await act(async () =>
    root.render(
      <WorkbenchExplorer
        activeDocKey={null}
        onAction={onAction}
        onOpenDocument={() => {}}
        onOpenToSide={() => {}}
        projectId={projectId}
      />,
    ),
  );
  return { onAction };
}

it('hides the write entries while a remote project is open', async () => {
  const { onAction } = await render(remoteProject.id);
  expect(newButton()).toBeNull();
  // 「全部收起」是只读操作，远端树照常保留。
  expect(collapseButton()).toBeTruthy();

  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onAction).not.toHaveBeenCalled();
});

it('keeps the write entries for a local project', async () => {
  const { onAction } = await render(localProject.id);
  expect(newButton()).toBeTruthy();

  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onAction).toHaveBeenCalledWith('note', localProject.id);
});
