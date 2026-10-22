// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspaceEntry } from '../../../shared/api';
import { useProjectNavPrefs } from '../../navigation/store';
import { EntryDialogs, type EntryDialogRequest } from '../entry-dialogs';
import { useWorkspaceStore } from '../store';

function entry(
  id: string,
  kind: WorkspaceEntry['kind'],
  parentId: string | null = null,
): WorkspaceEntry {
  return { id, name: id, kind, parentId, sourceId: null, updatedAt: '2026-10-19' };
}

const workspace = {
  directory: '/tmp/dela',
  views: {},
  entries: [
    entry('课程项目', 'project'),
    entry('子文件夹', 'folder', '课程项目'),
    entry('附件目录', 'folder', '子文件夹'),
    entry('嵌套项目', 'project', '子文件夹'),
    entry('嵌套笔记', 'file', '嵌套项目'),
    entry('第二项目', 'project'),
    entry('隐藏项目', 'project'),
    { ...entry('远程项目', 'project'), remoteId: 'ssh-1' },
    entry('普通文件夹', 'folder'),
  ],
};
let root: Root;
let container: HTMLDivElement;
const create = vi.fn(async (input) => ({ ...entry('created', input.kind), ...input }));
const getState = vi.fn(async () => workspace);
const update = vi.fn(async () => undefined);
const scrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useWorkspaceStore.setState({ workspace, loaded: true, error: null });
  useProjectNavPrefs.setState({ projects: { 隐藏项目: { hidden: true } } });
  window.dela = { workspace: { create, getState, update } } as unknown as DelaApi;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  Element.prototype.scrollIntoView = scrollIntoView;
  useProjectNavPrefs.setState({ projects: {} });
  vi.unstubAllGlobals();
});

async function render(initialTarget?: string, action: EntryDialogRequest['action'] = 'link') {
  await act(async () =>
    root.render(
      <EntryDialogs
        request={{ action, id: 'source:file:123', initialTarget }}
        onClose={() => {}}
      />,
    ),
  );
}

async function expand() {
  await act(async () =>
    document
      .querySelector('[role="combobox"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  );
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

async function choose(text: string) {
  const option = (await expand()).find((element) => element.textContent === text)!;
  await act(async () =>
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
}

async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

it('offers only visible local project entries without rescanning directories', async () => {
  await render();
  const options = (await expand()).map((element) => element.textContent);
  // 前三项是可见的本地项目；文件夹、远端项目、隐藏项目都不出现，只多一个新建入口。
  expect(options).toHaveLength(4);
  expect(options.slice(0, 3)).toEqual(['课程项目', '嵌套项目', '第二项目']);
  expect(getState).not.toHaveBeenCalled();
});

it.each([
  ['附件目录', '课程项目'],
  ['嵌套笔记', '嵌套项目'],
  ['第二项目', '第二项目'],
])('links from %s to its nearest project root %s', async (initialTarget, parentId) => {
  await render(initialTarget);
  expect(document.querySelector('[role="combobox"]')?.textContent).toBe(parentId);
  await submit();
  expect(create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      kind: 'source',
      parentId,
      sourceId: 'file:123',
    }),
  );
});

it('links to the project the user selects', async () => {
  await render('附件目录');
  await choose('第二项目');
  await submit();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ parentId: '第二项目' }));
});

it.each([undefined, '普通文件夹', 'missing', '远程项目', '隐藏项目'])(
  'requires a project choice for initial target %s',
  async (initialTarget) => {
    await render(initialTarget);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await submit();
    expect(create).not.toHaveBeenCalled();
  },
);

it('can create a project and link to its root when no projects exist', async () => {
  useWorkspaceStore.setState({ workspace: { ...workspace, entries: [] } });
  await render();
  await choose('新建项目…');
  const input = document.querySelector<HTMLInputElement>('input[aria-label="名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      '新项目',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await submit();
  expect(create).toHaveBeenNthCalledWith(1, { name: '新项目', parentId: null, kind: 'project' });
  expect(create).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ kind: 'source', parentId: 'created' }),
  );
});

it('clears an unavailable project target instead of silently using the workspace root', async () => {
  await render('课程项目');
  await act(async () => useProjectNavPrefs.getState().setProject('课程项目', { hidden: true }));
  await submit();
  expect(create).not.toHaveBeenCalled();
});

it('preserves folder and workspace-root destinations for moves', async () => {
  await render('附件目录', 'move');
  expect(document.querySelector('[role="combobox"]')?.textContent).toBe(
    '课程项目 / 子文件夹 / 附件目录',
  );
  await submit();
  expect(update).toHaveBeenLastCalledWith('source:file:123', { parentId: '附件目录' });
  await choose('我的内容');
  await submit();
  expect(update).toHaveBeenLastCalledWith('source:file:123', { parentId: null });
});
