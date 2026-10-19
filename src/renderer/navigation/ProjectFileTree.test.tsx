// @vitest-environment jsdom
// 远程项目在文件树里的懒加载：展开时才拉一层（listRemoteDirectory），子条目 id 用
// 「项目 id + 远端绝对路径」，行提示显示「目的地:路径」；远端文件点击不发起打开动作。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  DelaApi,
  HelperDegradation,
  RemoteDirectoryEntry,
  WorkspaceEntry,
} from '../../shared/api';
import { CONNECT_HINT_DELAY_MS, ProjectFileTree } from './ProjectFileTree';
import { remoteAccent } from './remote-color';
import { useRemoteActivity } from './remote-activity';

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

/** jsdom 在第二个 root 里会莫名对 window 发 blur，Radix 收到就把刚打开的菜单收起：拦掉这个环境噪音。 */
const suppressStrayWindowBlur = (event: Event) => event.stopImmediatePropagation();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Radix 的浮层要量尺寸；jsdom 没有 ResizeObserver。
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.addEventListener('blur', suppressStrayWindowBlur, true);
  // 取数状态是模块级 store：逐条用例清空，免得「正在连接」从上一条带过来。
  useRemoteActivity.setState({ byProject: {} });
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

/** 打开某一行的右键菜单（Radix 菜单靠 pointerdown 展开，内容 Portal 到 body）。 */
const openRowMenu = (name: string) =>
  row(name)
    .querySelector<HTMLButtonElement>('[data-slot="dropdown-menu-trigger"]')!
    .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));

const menuItems = () => document.querySelectorAll('[role="menuitem"]');

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

  // 远程文件点击 = 打开只读预览：回调 onSelect（渲染端没有本地条目标识）。
  await act(async () => row('README.md').click());
  expect(onSelect).toHaveBeenCalledWith('p-remote:/home/u/proj/README.md');
  expect(document.querySelector('[role="status"]')).toBeNull();

  // 远程目录点击 = 展开（第二层在展开后才拉取）；展开键带项目身份。
  await act(async () => row('src').click());
  expect(onExpand).toHaveBeenCalledWith('p-remote:/home/u/proj/src', true);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(1);
});

it('shows the degraded hint only for projects on the failing destination', async () => {
  let emit: (states: HelperDegradation[]) => void = () => {};
  window.dela = {
    remotes: {
      list: async () => [{ id: 'r-1', host: 'user@10.0.0.5' }],
      onHelperState: (listener: (states: HelperDegradation[]) => void) => {
        emit = listener;
        return () => {};
      },
    },
    workspace: { listRemoteDirectory: vi.fn(async () => []) },
  } as unknown as DelaApi;

  await renderTree(['p-remote']);
  expect(document.body.textContent).not.toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('noexec');

  // 别的服务器降级：这棵树的项目连的不是那台，不提示。
  await act(async () => emit([{ destination: 'other@10.9.9.9', reason: 'noexec' }]));
  expect(document.body.textContent).not.toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('noexec');

  // 多条通道可以同时降级：快照里两台都在，这棵树只显示自己那台。
  await act(async () =>
    emit([
      { destination: 'other@10.9.9.9', reason: 'noexec' },
      { destination: 'user@10.0.0.5', reason: 'helper 目录所在挂载点启用了 noexec' },
    ]),
  );
  expect(document.body.textContent).toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('other@10.9.9.9');
  expect(document.body.textContent).toContain('noexec');

  // 这台的通道恢复（快照里只剩别台）：提示撤掉。
  await act(async () => emit([{ destination: 'other@10.9.9.9', reason: 'noexec' }]));
  expect(document.body.textContent).not.toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('noexec');

  // 全恢复：快照清空。
  await act(async () => emit([]));
  expect(document.body.textContent).not.toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('noexec');
});

it('shows no status line while a remote level is loading', async () => {
  const gate: { open?: () => void } = {};
  let secondReadStarted = false;
  const listRemoteDirectory = vi.fn(async (_projectId: string, path: string) => {
    if (path === '/home/u/proj')
      return [
        { name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null },
      ];
    // 第二层停在读取中：插一行「正在读取 …」会让整棵树随每次点击上下跳。
    secondReadStarted = true;
    await new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    return [];
  });
  window.dela = {
    remotes: { list: async () => [] },
    workspace: { listRemoteDirectory },
  } as unknown as DelaApi;

  await renderTree(['p-remote', 'p-remote:/home/u/proj/src']);
  expect(row('src')).toBeTruthy();
  await act(async () => {});
  expect(secondReadStarted).toBe(true);
  expect(document.querySelector('[role="status"]')).toBeNull();

  await act(async () => gate.open?.());
  expect(listRemoteDirectory).toHaveBeenCalledWith('p-remote', '/home/u/proj/src');
});

it('marks a remote project row with its connection colour and leaves local rows alone', async () => {
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
  // 另一台服务器上的项目：颜色必须跟着各自的连接走。
  const otherRemote: WorkspaceEntry = {
    ...remoteProject,
    id: 'p-other',
    name: '另一台机器',
    remoteId: 'r-2',
  };
  const listRemoteDirectory = vi.fn(async () => [
    { name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null },
  ]);
  window.dela = {
    remotes: { list: async () => [] },
    workspace: { listRemoteDirectory },
  } as unknown as DelaApi;

  await act(async () =>
    root.render(
      <ProjectFileTree
        entries={[...entries, otherRemote, localProject]}
        expanded={['p-remote']}
        onAction={() => {}}
        onExpand={vi.fn()}
        onSelect={vi.fn()}
        query=""
        rootId={null}
        selected={null}
      />,
    ),
  );

  // 远端项目行用云朵顶掉文件夹图标，颜色由各自的连接 id 决定。
  const cloud = row('proj').querySelector<SVGElement>('svg.lucide-cloud')!;
  expect(cloud).toBeTruthy();
  expect(cloud.style.color).toBe(remoteAccent('r-1', 'text'));
  expect(row('proj').querySelector('svg.lucide-folder-kanban')).toBeNull();
  expect(row('另一台机器').querySelector<SVGElement>('svg.lucide-cloud')!.style.color).toBe(
    remoteAccent('r-2', 'text'),
  );
  // 子条目只靠图标颜色表示同源，行内不再挂云朵：整棵树本来就都是远端的，逐行标一遍是冗余。
  expect(row('src').querySelector<SVGElement>('svg.lucide-folder')!.style.color).toBe(
    remoteAccent('r-1', 'text'),
  );
  expect(row('src').querySelector('svg.lucide-cloud')).toBeNull();
  // 本地项目行照旧是文件夹图标、没有云朵与连接色。
  expect(row('本地项目').querySelector('svg.lucide-folder-kanban')).toBeTruthy();
  expect(row('本地项目').querySelector('svg.lucide-cloud')).toBeNull();
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

it('refreshes a remote directory after the tools changed it', async () => {
  // 远端没有文件监听：AI 新建的文件只靠这条通知才会出现在树里。
  let notify: ((path: string) => void) | undefined;
  const listRemoteDirectory = vi.fn(async (_projectId: string, path: string) =>
    path === '/home/u/proj'
      ? [{ name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null }]
      : [{ name: 'new.txt', path: `${path}/new.txt`, directory: false, size: 1, modifiedAt: null }],
  );
  window.dela = {
    remotes: { list: async () => [] },
    workspace: {
      listRemoteDirectory,
      onRemoteChange: (listener: (path: string) => void) => {
        notify = listener;
        return () => {};
      },
    },
  } as unknown as DelaApi;

  await renderTree(['p-remote', 'p-remote:/home/u/proj/src']);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(2);
  expect(listRemoteDirectory).toHaveBeenLastCalledWith('p-remote', '/home/u/proj/src');

  // 与已缓存目录无关的变化：一次都不重读。
  await act(async () => {
    notify!('/elsewhere/dir');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledTimes(2);

  // 子目录里多了文件（写入的是父目录）：只重读那一层。
  await act(async () => {
    notify!('/home/u/proj/src');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledTimes(3);
  expect(listRemoteDirectory).toHaveBeenLastCalledWith('p-remote', '/home/u/proj/src');

  // bash 的 cwd 是项目根：根这一层（以及已展开的子树）都要重读。
  await act(async () => {
    notify!('/home/u/proj');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledWith('p-remote', '/home/u/proj');
  expect(listRemoteDirectory).toHaveBeenCalledTimes(5);
});

it('reports the expanded remote directories to watch, and cancels them on unmount', async () => {
  // Dela 之外改的远端文件靠这条上报：远端只盯当前展开的目录。
  const watchRemoteDirectories = vi.fn(async () => ({ watching: 1 }));
  const listRemoteDirectory = vi.fn(async (_projectId: string, path: string) =>
    path === '/home/u/proj'
      ? [{ name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null }]
      : [],
  );
  window.dela = {
    remotes: { list: async () => [] },
    workspace: { listRemoteDirectory, watchRemoteDirectories },
  } as unknown as DelaApi;

  await act(async () => {
    root.render(
      <ProjectFileTree
        entries={entries}
        expanded={['p-remote', 'p-remote:/home/u/proj/src']}
        onAction={() => {}}
        onExpand={vi.fn()}
        onSelect={vi.fn()}
        query=""
        rootId={null}
        selected={null}
      />,
    );
  });
  // effect 要等 act 作用域结束才跑，所以等合并窗口必须另开一个 act。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(watchRemoteDirectories).toHaveBeenLastCalledWith('p-remote', [
    '/home/u/proj',
    '/home/u/proj/src',
  ]);

  // 同一份集合重复渲染不重报。
  const calls = watchRemoteDirectories.mock.calls.length;
  await act(async () => {
    root.render(
      <ProjectFileTree
        entries={entries}
        expanded={['p-remote', 'p-remote:/home/u/proj/src']}
        onAction={() => {}}
        onExpand={vi.fn()}
        onSelect={vi.fn()}
        query=""
        rootId={null}
        selected={null}
      />,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(watchRemoteDirectories.mock.calls.length).toBe(calls);

  // 收起一层：集合变小，重新上报。
  await act(async () => {
    root.render(
      <ProjectFileTree
        entries={entries}
        expanded={['p-remote']}
        onAction={() => {}}
        onExpand={vi.fn()}
        onSelect={vi.fn()}
        query=""
        rootId={null}
        selected={null}
      />,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(watchRemoteDirectories).toHaveBeenLastCalledWith('p-remote', ['/home/u/proj']);

  // 卸载：取消监视，远端不留 inotify watch。
  await act(async () => root.unmount());
  expect(watchRemoteDirectories).toHaveBeenLastCalledWith('p-remote', []);
  root = createRoot(container);
});

it('limits a remote project row to a single action', async () => {
  // main 对远端条目的 update 一律拒绝（重命名/移动/归档都经 update）：这些入口不能出现在菜单里。
  await renderTree([]);
  await act(async () => openRowMenu('proj'));
  expect(menuItems()).toHaveLength(1);
});

it('keeps the full action menu on a local project row', async () => {
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
  await act(async () =>
    root.render(
      <ProjectFileTree
        entries={[localProject]}
        expanded={[]}
        onAction={() => {}}
        onExpand={vi.fn()}
        onSelect={vi.fn()}
        query=""
        rootId={null}
        selected={null}
      />,
    ),
  );
  await act(async () => openRowMenu('本地项目'));
  // 3 个新建入口 + 重命名/移动/归档 + 移除。
  expect(menuItems().length).toBeGreaterThanOrEqual(7);
});

it('shows the connecting hint while a remote root is still being read', async () => {
  // 冷启动要几秒：这段时间面板原本一片空白，会被当成「这个项目没有文件」。
  let release: (items: RemoteDirectoryEntry[]) => void = () => {};
  const listRemoteDirectory = vi.fn(
    () => new Promise<RemoteDirectoryEntry[]>((resolve) => (release = resolve)),
  );
  window.dela = {
    remotes: { list: async () => [{ id: 'r-1', host: 'user@10.0.0.5' }] },
    workspace: { listRemoteDirectory },
  } as unknown as DelaApi;
  const slow: WorkspaceEntry = { ...remoteProject, id: 'p-slow', name: '慢项目' };

  await act(async () =>
    root.render(
      <ProjectFileTree
        entries={[slow]}
        expanded={['p-slow']}
        onAction={() => {}}
        onExpand={vi.fn()}
        onSelect={vi.fn()}
        query=""
        rootId="p-slow"
        selected={null}
      />,
    ),
  );
  // 热通道几十毫秒就回来：先什么都不画，避免每次打开都闪一下转圈。
  expect(document.querySelector('[role="status"]')).toBeNull();
  await act(async () => new Promise((resolve) => setTimeout(resolve, CONNECT_HINT_DELAY_MS + 50)));
  const hint = document.querySelector('[role="status"]');
  expect(hint).not.toBeNull();
  expect(hint?.textContent).toBeTruthy();

  // 清单到手后过渡让位给内容。
  await act(async () =>
    release([
      { name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null },
    ]),
  );
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(row('src')).toBeTruthy();
});
