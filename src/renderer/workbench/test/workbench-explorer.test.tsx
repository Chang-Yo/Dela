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
let currentContainerOf: typeof import('../WorkbenchExplorer').currentContainerOf;

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
  ({ WorkbenchExplorer, currentContainerOf } = await import('../WorkbenchExplorer'));
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

const deepFolder: WorkspaceEntry = {
  id: 'f-deep',
  parentId: localFolder.id,
  name: '子目录',
  kind: 'folder',
  sourceId: null,
  path: 'D:/code/本地项目/资料/子目录',
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const deepNote: WorkspaceEntry = {
  id: 'D:/code/本地项目/资料/子目录/n.md',
  parentId: deepFolder.id,
  name: 'n.md',
  kind: 'file',
  sourceId: null,
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const localImage: WorkspaceEntry = {
  id: 'D:/code/本地项目/资料/b.png',
  parentId: localFolder.id,
  name: 'b.png',
  kind: 'file',
  sourceId: null,
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const localUnknown: WorkspaceEntry = {
  id: 'D:/code/本地项目/资料/c.xyz',
  parentId: localFolder.id,
  name: 'c.xyz',
  kind: 'file',
  sourceId: null,
  remoteId: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const localDockerfile: WorkspaceEntry = {
  id: 'D:/code/本地项目/资料/Dockerfile',
  parentId: localFolder.id,
  name: 'Dockerfile',
  kind: 'file',
  sourceId: null,
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

async function render(projectId: string | null, activeDocKey: string | null = null) {
  const onAction = vi.fn();
  const onCreated = vi.fn();
  await act(async () =>
    root.render(
      <WorkbenchExplorer
        activeDocKey={activeDocKey}
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

/** 行内输入框与其目标目录行的先后关系：输入框必须在目录行之后（它的子项首位）。 */
function inputFollowsRow(label: string) {
  const row = [...document.querySelectorAll('[role="treeitem"]')].find((el) =>
    el.getAttribute('aria-label')?.startsWith(label),
  );
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="新文件名称"], [aria-label="新文件夹名称"]',
  );
  expect(row).toBeTruthy();
  expect(input).toBeTruthy();
  expect(row!.compareDocumentPosition(input!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  // 输入行画在目标目录行的子项首位，而不是树顶。
  inputFollowsRow('资料');
});

// 目标文件夹藏在折叠的父级下（活动文档在收起的项目深处）时，要展开祖先链让输入行
// 落到目标之下，而不是被 Explorer 的兜底逻辑丢到树顶。
it('places the pending row inside the target folder when its ancestors are collapsed', async () => {
  useWorkspaceStore.setState({
    workspace: {
      ...workspace,
      entries: [...workspace.entries, localFolder, deepFolder, deepNote],
    },
    loaded: true,
    error: null,
  });
  // 全局视图：项目行收起，目标子目录两代都不可见。
  await render(null, deepNote.id);
  await chooseMenu(newButton()!, '新建文件');
  expect(useTreeState.getState().pendingCreate).toEqual({ kind: 'file', parentId: deepFolder.id });
  inputFollowsRow('子目录');

  // 项目视图：项目行不在树里，但「资料」是收起的，目标子目录同样不可见。
  act(() => useTreeState.setState({ pendingCreate: null, expanded: [] }));
  await render(localProject.id, deepNote.id);
  await chooseMenu(newButton()!, '新建文件夹');
  expect(useTreeState.getState().pendingCreate).toEqual({
    kind: 'folder',
    parentId: deepFolder.id,
  });
  inputFollowsRow('子目录');
});

// 文件树目录行不画 folder 图标（折叠箭头已表达目录语义）；文件行用逐扩展名的彩色图标，
// 未收录的扩展名回落通用文档图标。
it('shows no folder icons and picks file icons by extension', async () => {
  useWorkspaceStore.setState({
    workspace: {
      ...workspace,
      entries: [
        ...workspace.entries,
        localFolder,
        deepFolder,
        deepNote,
        localImage,
        localUnknown,
        localDockerfile,
      ],
    },
    loaded: true,
    error: null,
  });
  await render(localProject.id);
  act(() => useTreeState.setState({ expanded: [localFolder.id, deepFolder.id] }));
  const row = (label: string) =>
    [...document.querySelectorAll('[role="treeitem"]')].find(
      (el) => el.getAttribute('aria-label') === label,
    )!;
  expect(row('资料').querySelector('.lucide-folder, .lucide-folder-open')).toBeNull();
  expect(row('子目录').querySelector('.lucide-folder, .lucide-folder-open')).toBeNull();
  const markdownIcon = row('n.md').querySelector('img')!;
  const imageIcon = row('b.png').querySelector('img')!;
  expect(markdownIcon).toBeTruthy();
  expect(imageIcon).toBeTruthy();
  // dev 下 SVG 直读 node_modules（/@fs/），资产来源即上游包的 icons/ 目录。
  expect(markdownIcon.getAttribute('src')).toMatch(/material-icon-theme\/icons\/markdown\.svg$/);
  expect(imageIcon.getAttribute('src')).toMatch(/material-icon-theme\/icons\/image\.svg$/);
  // 未收录的扩展名回落 lucide 文档图标；无扩展名文件按完整文件名命中。
  expect(row('c.xyz').querySelector('img')).toBeNull();
  expect(row('c.xyz').querySelector('.lucide-file-text')).toBeTruthy();
  expect(row('Dockerfile').querySelector('img')).toBeTruthy();

  // 全局视图里项目行的看板图标保留：它标记的是项目，不是目录。
  await render(null);
  expect(row('本地项目').querySelector('.lucide-folder-kanban')).toBeTruthy();
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
  // 全局视图（rootId 为空）保持旧行为：选中项目时新建到项目内。
  expect(currentContainerOf(localProject.id, null)).toBe(localProject.id);
});

// 点空白处 = 把新建目标切回项目根，后续新建落在二级而不是上次选中的子文件夹。
it('clicking the blank area targets the project root for new entries', async () => {
  useWorkspaceStore.setState({
    workspace: { ...workspace, entries: [...workspace.entries, localFolder] },
    loaded: true,
    error: null,
  });
  await render(localProject.id);
  act(() => useTreeState.getState().select(localFolder.id));
  await act(async () => blank().click());
  expect(useTreeState.getState().selected).toBe(localProject.id);
});
