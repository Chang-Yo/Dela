// @vitest-environment jsdom
// 远程项目在文件树里的懒加载：展开时才拉一层（listRemoteDirectory），子条目 id 用
// 「项目 id + 远端绝对路径」，行提示显示「目的地:路径」；远端文件点击不发起打开动作。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspaceEntry } from '../../shared/api';
import { ProjectFileTree } from './ProjectFileTree';

let container: HTMLDivElement;
let root: Root;

const remoteProject: WorkspaceEntry = {
  id: 'p-remote',
  parentId: null,
  name: 'proj',
  kind: 'project',
  sourceId: null,
  path: '/home/u/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const entries: WorkspaceEntry[] = [remoteProject];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

async function renderTree(
  expanded: string[],
  onSelect = vi.fn(),
  onExpand = vi.fn(),
  rootId: string | null = null,
) {
  await act(async () =>
    root.render(
      <ProjectFileTree
        entries={entries}
        expanded={expanded}
        onAction={() => {}}
        onExpand={onExpand}
        onSelect={onSelect}
        query=""
        rootId={rootId}
        selected={null}
      />,
    ),
  );
  return { onSelect, onExpand };
}

const row = (name: string) =>
  document.querySelector<HTMLElement>(`[role="treeitem"][aria-label="${name}"]`)!;

it('loads one remote level when the project is expanded and browses without opening files', async () => {
  const listRemoteDirectory = vi.fn(async (_projectId: string, path: string) =>
    path === '/home/u/proj'
      ? [
          { name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null },
          {
            name: 'README.md',
            path: '/home/u/proj/README.md',
            directory: false,
            size: 12,
            modifiedAt: null,
          },
        ]
      : [
          {
            name: 'main.ts',
            path: '/home/u/proj/src/main.ts',
            directory: false,
            size: 3,
            modifiedAt: null,
          },
        ],
  );
  window.dela = {
    remotes: { list: async () => [{ id: 'r-1', host: 'user@10.0.0.5' }] },
    workspace: { listRemoteDirectory },
  } as unknown as DelaApi;

  const { onSelect, onExpand } = await renderTree(['p-remote']);
  expect(listRemoteDirectory).toHaveBeenCalledWith('p-remote', '/home/u/proj');
  expect(row('src')).toBeTruthy();
  // 目的地来自 remotes.list()，与远端绝对路径拼成行提示。
  expect(row('README.md').querySelector('[title]')?.getAttribute('title')).toBe(
    'user@10.0.0.5:/home/u/proj/README.md',
  );

  // 远程文件不打开：给出口提示，不回调 onSelect。
  await act(async () => row('README.md').click());
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    '远程文件的打开与预览在下一阶段',
  );

  // 远程目录点击 = 展开（第二层在展开后才拉取）；展开键带项目身份。
  await act(async () => row('src').click());
  expect(onExpand).toHaveBeenCalledWith('p-remote:/home/u/proj/src', true);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(1);
});

it('lists a subdirectory lazily and collapses it again', async () => {
  const listRemoteDirectory = vi.fn(async (_projectId: string, path: string) =>
    path === '/home/u/proj'
      ? [{ name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null }]
      : [
          {
            name: 'main.ts',
            path: '/home/u/proj/src/main.ts',
            directory: false,
            size: 3,
            modifiedAt: null,
          },
        ],
  );
  window.dela = {
    remotes: { list: async () => [] },
    workspace: { listRemoteDirectory },
  } as unknown as DelaApi;

  const { onExpand } = await renderTree(['p-remote', 'p-remote:/home/u/proj/src']);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(2);
  expect(row('main.ts')).toBeTruthy();

  await act(async () => row('src').click());
  expect(onExpand).toHaveBeenCalledWith('p-remote:/home/u/proj/src', false);
});

it('refreshes a remote directory when it is collapsed and expanded again', async () => {
  // 远端没有文件监听：收起时丢掉清单，再展开就是重新读一次（用户手动刷新）。
  const listRemoteDirectory = vi.fn(async () => [
    { name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null },
  ]);
  window.dela = {
    remotes: { list: async () => [] },
    workspace: { listRemoteDirectory },
  } as unknown as DelaApi;

  await renderTree(['p-remote']);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(1);

  await act(async () =>
    root.render(
      <ProjectFileTree
        entries={entries}
        expanded={[]}
        onAction={() => {}}
        onExpand={() => {}}
        onSelect={() => {}}
        query=""
        rootId={null}
        selected={null}
      />,
    ),
  );
  await renderTree(['p-remote']);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(2);
});

it('loads the remote root when the project itself is the open tree', async () => {
  const listRemoteDirectory = vi.fn(async () => [
    { name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null },
  ]);
  window.dela = {
    remotes: { list: async () => [] },
    workspace: { listRemoteDirectory },
  } as unknown as DelaApi;

  // 打开的项目工作台：项目行不显示，也没有展开态，远端内容直接挂在顶层。
  await renderTree([], vi.fn(), vi.fn(), remoteProject.id);
  expect(listRemoteDirectory).toHaveBeenCalledWith('p-remote', '/home/u/proj');
  expect(row('src')).toBeTruthy();
});

it('keeps two connections on the same remote path apart', async () => {
  // 两台服务器都开着 /home/u/proj：条目身份必须带项目，否则清单、展开态与选中态会串。
  const first: WorkspaceEntry = { ...remoteProject, id: 'p-a', name: 'a', remoteId: 'r-1' };
  const second: WorkspaceEntry = { ...remoteProject, id: 'p-b', name: 'b', remoteId: 'r-2' };
  const listRemoteDirectory = vi.fn(async (projectId: string) =>
    projectId === 'p-a'
      ? [
          {
            name: 'src-a',
            path: '/home/u/proj/src-a',
            directory: true,
            size: null,
            modifiedAt: null,
          },
          {
            name: 'only-a.txt',
            path: '/home/u/proj/only-a.txt',
            directory: false,
            size: 1,
            modifiedAt: null,
          },
        ]
      : [
          {
            name: 'src-b',
            path: '/home/u/proj/src-b',
            directory: true,
            size: null,
            modifiedAt: null,
          },
          {
            name: 'only-b.txt',
            path: '/home/u/proj/only-b.txt',
            directory: false,
            size: 1,
            modifiedAt: null,
          },
        ],
  );
  window.dela = {
    remotes: { list: async () => [] },
    workspace: { listRemoteDirectory },
  } as unknown as DelaApi;
  const onExpand = vi.fn();

  await act(async () =>
    root.render(
      <ProjectFileTree
        entries={[first, second]}
        expanded={['p-a', 'p-b']}
        onAction={() => {}}
        onExpand={onExpand}
        onSelect={() => {}}
        query=""
        rootId={null}
        selected={null}
      />,
    ),
  );

  expect(listRemoteDirectory).toHaveBeenCalledWith('p-a', '/home/u/proj');
  expect(listRemoteDirectory).toHaveBeenCalledWith('p-b', '/home/u/proj');
  expect(row('only-a.txt')).toBeTruthy();
  expect(row('only-b.txt')).toBeTruthy();

  await act(async () => row('src-a').click());
  expect(onExpand).toHaveBeenCalledWith('p-a:/home/u/proj/src-a', true);
});
