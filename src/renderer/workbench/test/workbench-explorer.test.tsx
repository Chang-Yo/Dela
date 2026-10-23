// @vitest-environment jsdom
// 打开远端项目时目录侧栏收掉写入口：「+ 新建」下拉不出现，空白处双击也不出现新建输入行；
// 只读操作（全部收起）保留。本地项目树里新建是 VS Code 式行内输入，不开弹窗。
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
  // Radix 的浮层要量尺寸；jsdom 没有 ResizeObserver。
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

const localFolder: WorkspaceEntry = {
  id: 'f-local',
  parentId: 'p-local',
  name: '资料',
  kind: 'folder',
  sourceId: null,
  path: 'D:/code/本地项目/资料',
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
  useTreeState.setState({ expanded: [], query: '', selected: null, pendingCreate: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
});

const newButton = () => document.querySelector<HTMLElement>('[aria-label="新建"]');
const collapseButton = () => document.querySelector('[aria-label="全部收起"]');
const blank = () => document.querySelector<HTMLElement>('#workspace-explorer > .overflow-y-auto')!;

const nameInput = () => document.querySelector<HTMLInputElement>('[aria-label="新文件名称"]');

/** 打开某个下拉菜单（Radix 靠 pointerdown 展开）并点其中一项。 */
async function chooseMenu(trigger: HTMLElement, label: string) {
  await act(async () => {
    // 真实点击会先聚焦触发按钮；不聚焦时焦点从 body 移入菜单，jsdom 会在 window 上派发 blur，
    // Radix 据此当作窗口失焦把菜单收起。
    trigger.focus();
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  });
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent?.trim() === label,
  )!;
  await act(async () => {
    item.click();
  });
  // 行内新建排在菜单关闭后的下一轮任务里，等它建好行。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(projectId: string) {
  const onAction = vi.fn();
  const onCreated = vi.fn();
  await act(async () =>
    root.render(
      <WorkbenchExplorer
        activeDocKey={null}
        onAction={onAction}
        onCreated={onCreated}
        onOpenDocument={() => {}}
        onOpenToSide={() => {}}
        projectId={projectId}
      />,
    ),
  );
  return { onAction, onCreated };
}

it('hides the write entries while a remote project is open', async () => {
  const { onAction } = await render(remoteProject.id);
  expect(newButton()).toBeNull();
  // 「全部收起」是只读操作，远端树照常保留。
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
    id: 'D:/code/本地项目/a/b.md',
    name: 'b.md',
    kind: 'file',
  };
  const create = vi.fn(async () => created);
  window.dela = { workspace: { create, getState: async () => workspace } } as never;
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

it('keeps the row open with a red border on failure, and Escape cancels', async () => {
  const create = vi.fn(async () => {
    throw new Error('「a.md」已存在');
  });
  window.dela = { workspace: { create, getState: async () => workspace } } as never;
  await render(localProject.id);
  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  const input = nameInput()!;
  await act(async () => type(input, 'a.md'));
  await act(async () => key(input, 'Enter'));
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.className).toContain('border-red');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('已存在');
  expect(input.value).toBe('a.md');

  await act(async () => key(input, 'Escape'));
  expect(nameInput()).toBeNull();
});

it('submits on blur when a name was typed, cancels on blur when empty', async () => {
  const create = vi.fn(async () => ({
    ...localProject,
    id: 'x',
    name: 'x',
    kind: 'file' as const,
  }));
  window.dela = { workspace: { create, getState: async () => workspace } } as never;
  await render(localProject.id);
  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await act(async () => nameInput()!.blur());
  expect(nameInput()).toBeNull();
  expect(create).not.toHaveBeenCalled();

  await act(async () => blank().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await act(async () => type(nameInput()!, 'x'));
  await act(async () => nameInput()!.blur());
  expect(create).toHaveBeenCalledTimes(1);
});

// 菜单关闭时 Radix 会把焦点还给触发按钮；行内新建的名称输入行必须留住焦点，否则用户还得再点一次。
it('focuses the inline name row started from the sidebar 新建 menu', async () => {
  await render(localProject.id);
  await chooseMenu(newButton()!, '新建文件');

  const input = nameInput();
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  expect(useTreeState.getState().pendingCreate).toEqual({
    kind: 'file',
    parentId: localProject.id,
  });
});

it('focuses the inline name row started from a row action menu', async () => {
  useWorkspaceStore.setState({
    workspace: { ...workspace, entries: [...workspace.entries, localFolder] },
    loaded: true,
    error: null,
  });
  await render(localProject.id);
  await chooseMenu(document.querySelector<HTMLElement>('[aria-label="资料 的操作"]')!, '新建文件');

  const input = nameInput();
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  expect(useTreeState.getState().pendingCreate).toEqual({ kind: 'file', parentId: localFolder.id });
});

it('shows the folder path in a tooltip instead of the native title', async () => {
  const nested: WorkspaceEntry = {
    id: 'D:/code/本地项目/资料/a.md',
    parentId: localFolder.id,
    name: 'a.md',
    kind: 'file',
    sourceId: null,
    path: 'D:/code/本地项目/资料/a.md',
    remoteId: null,
    updatedAt: '2026-10-09T00:00:00.000Z',
  };
  useWorkspaceStore.setState({
    workspace: { ...workspace, entries: [...workspace.entries, localFolder, nested] },
    loaded: true,
    error: null,
  });
  useTreeState.setState({ expanded: [localProject.id, localFolder.id] });
  await render(localProject.id);

  const row = document.querySelector('[aria-label="a.md"]')!;
  // 原生 title 会延迟约一秒、样式不可控，改为统一的自定义提示。
  expect(row.querySelector('[title]')).toBeNull();
  await act(async () => {
    row.querySelector('.truncate')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
  expect(document.body.textContent).toContain('资料 / a.md');
});
