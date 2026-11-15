// @vitest-environment jsdom
// 远端文件树的行为：懒加载、项目身份、连接提示与降级、目录监视上报。
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspaceEntry } from '../../shared/api';
import type { RemoteChannelState, RemoteDirectoryEntry } from '../../modules/remotes/contract';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好。
const workspace = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const remotes: Record<string, (input: never) => unknown> = {};
  const listeners = new Map<string, (payload: unknown) => void>();
  const bridge = {
    invoke: async (channel: string, input: never) => {
      const [namespace, name] = channel.split(':');
      return (namespace === 'remotes' ? remotes : handlers)[name!]?.(input);
    },
    subscribe: (channel: string, listener: (payload: unknown) => void) => {
      listeners.set(channel, listener);
      return () => {};
    },
  };
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
  return { handlers, remotes, listeners, bridge };
});
import { CONNECT_HINT_DELAY_MS, ProjectFileTree } from './ProjectFileTree';
import { remoteAccent, useRemoteState } from '../../modules/remotes/view';
import { useRemoteActivity } from './remote-activity';
import { useWorkspaceStore } from '../../modules/workspace/view';

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

const renderUi = (ui: ReactNode) =>
  root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

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

type RemoteListInput = { projectId: string; path: string };

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
  for (const name of Object.keys(workspace.handlers)) delete workspace.handlers[name];
  workspace.remotes.list = async () => [];
  workspace.remotes.helperStates = async () => [];
  // 通道推送由 remotes 模块在加载时订阅一次，监听器不能清；只清上一条推送下来的状态。
  useRemoteState.setState({ pushedChannels: null });
  // 取数状态是模块级 store：逐条用例清空，免得「正在连接」从上一条带过来。
  useRemoteActivity.setState({ byProject: {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

/** 查询结果经 setTimeout(0) 通知，且子目录要等父目录回来才发请求：多让几轮。 */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

async function renderTree(
  expanded: string[],
  onSelect = vi.fn(),
  onExpand = vi.fn(),
  rootId: string | null = null,
) {
  await act(async () =>
    renderUi(
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
  await settle();
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

it('dims ignored names and hides repository metadata without hiding configuration files', async () => {
  const file = (name: string): WorkspaceEntry => ({
    id: `C:/repo/${name}`,
    parentId: null,
    name,
    kind: 'file',
    sourceId: null,
    updatedAt: '',
    gitIgnored: true,
  });
  await act(async () =>
    renderUi(
      <ProjectFileTree
        entries={['ignored.log', '.git', '.DS_Store', '.env', '.gitignore'].map(file)}
        expanded={[]}
        rootId={null}
        query=""
        selected={null}
        onAction={() => {}}
        onExpand={() => {}}
        onSelect={() => {}}
      />,
    ),
  );
  expect(
    row('ignored.log').querySelector('span[title="ignored.log"]')?.classList.contains('text-ink-3'),
  ).toBe(true);
  expect(row('.git')).toBeNull();
  expect(row('.DS_Store')).toBeNull();
  expect(row('.env')).not.toBeNull();
  expect(row('.gitignore')).not.toBeNull();
});

it('reads only expanded local directories and releases children when their ancestor closes', async () => {
  const project = { ...remoteProject, id: 'local', remoteId: undefined, path: 'C:/local' };
  const folder = {
    ...project,
    id: 'C:/local/src',
    parentId: project.id,
    kind: 'folder' as const,
    name: 'src',
    path: 'C:/local/src',
  };
  const ensure = vi.spyOn(useWorkspaceStore.getState(), 'ensureDirectory').mockResolvedValue();
  const release = vi.spyOn(useWorkspaceStore.getState(), 'releaseDirectory');
  const render = async (expanded: string[]) => {
    await act(async () =>
      renderUi(
        <ProjectFileTree
          entries={[project, folder]}
          expanded={expanded}
          rootId={null}
          query=""
          selected={null}
          onAction={() => {}}
          onExpand={() => {}}
          onSelect={() => {}}
        />,
      ),
    );
  };
  try {
    await render([]);
    expect(ensure).not.toHaveBeenCalled();
    await render([project.id, folder.id]);
    expect(ensure.mock.calls.map((call) => call[0])).toEqual([folder.id, project.id]);
    ensure.mockClear();
    await render([folder.id]);
    expect(ensure).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(project.id);
    expect(release).toHaveBeenCalledWith(folder.id);
  } finally {
    ensure.mockRestore();
    release.mockRestore();
  }
});

it('loads one remote level when the project is expanded and browses without opening files', async () => {
  const listRemoteDirectory = vi.fn(async ({ path }: RemoteListInput) =>
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
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [{ id: 'r-1', host: 'user@10.0.0.5' }];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;

  const { onSelect, onExpand } = await renderTree(['p-remote']);
  expect(listRemoteDirectory).toHaveBeenCalledWith({ projectId: 'p-remote', path: '/home/u/proj' });
  expect(row('src')).toBeTruthy();
  expect(row('README.md').querySelector('[title]')?.getAttribute('title')).toBe(
    'user@10.0.0.5:/home/u/proj/README.md',
  );

  await act(async () => row('README.md').click());
  expect(onSelect).toHaveBeenCalledWith('p-remote:/home/u/proj/README.md');
  expect(document.querySelector('[role="status"]')).toBeNull();

  await act(async () => row('src').click());
  expect(onExpand).toHaveBeenCalledWith('p-remote:/home/u/proj/src', true);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(1);
});

it('shows the unavailable hint only for projects on the failing destination', async () => {
  const emit = (states: RemoteChannelState[]) =>
    workspace.listeners.get('remotes:helperState')!(states);
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [{ id: 'r-1', host: 'user@10.0.0.5' }];
  workspace.handlers.listRemoteDirectory = vi.fn(async () => []);

  await renderTree(['p-remote']);
  expect(document.body.textContent).not.toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('noexec');

  await act(async () =>
    emit([{ destination: 'other@10.9.9.9', state: 'unavailable', reason: 'noexec', since: 0 }]),
  );
  expect(document.body.textContent).not.toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('noexec');

  await act(async () =>
    emit([
      { destination: 'other@10.9.9.9', state: 'unavailable', reason: 'noexec', since: 0 },
      {
        destination: 'user@10.0.0.5',
        state: 'unavailable',
        reason: 'helper 目录所在挂载点启用了 noexec',
        since: 0,
      },
    ]),
  );
  expect(document.body.textContent).toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('other@10.9.9.9');
  expect(document.body.textContent).toContain('noexec');

  await act(async () =>
    emit([{ destination: 'other@10.9.9.9', state: 'unavailable', reason: 'noexec', since: 0 }]),
  );
  expect(document.body.textContent).not.toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('noexec');

  await act(async () => emit([]));
  expect(document.body.textContent).not.toContain('user@10.0.0.5');
  expect(document.body.textContent).not.toContain('noexec');
});

it('says the connection is reconnecting without alarming, and says nothing when ready', async () => {
  const emit = (states: RemoteChannelState[]) =>
    workspace.listeners.get('remotes:helperState')!(states);
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [{ id: 'r-1', host: 'user@10.0.0.5' }];
  workspace.handlers.listRemoteDirectory = vi.fn(async () => []);

  await renderTree(['p-remote']);
  const channel = { destination: 'user@10.0.0.5', reason: '', since: 0 };
  await act(async () => emit([{ ...channel, state: 'ready' }]));
  expect(document.body.textContent).not.toContain('user@10.0.0.5');

  await act(async () => emit([{ ...channel, state: 'reconnecting' }]));
  expect(document.body.textContent).toContain('正在重连');
  expect(document.body.textContent).toContain('远端正在运行的命令不受影响');

  await act(async () => emit([{ ...channel, state: 'ready' }]));
  expect(document.body.textContent).not.toContain('正在重连');
});

it('shows no status line while a remote level is loading', async () => {
  const gate: { open?: () => void } = {};
  let secondReadStarted = false;
  const listRemoteDirectory = vi.fn(async ({ path }: RemoteListInput) => {
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
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;

  await renderTree(['p-remote', 'p-remote:/home/u/proj/src']);
  expect(row('src')).toBeTruthy();
  await act(async () => {});
  expect(secondReadStarted).toBe(true);
  expect(document.querySelector('[role="status"]')).toBeNull();

  await act(async () => gate.open?.());
  expect(listRemoteDirectory).toHaveBeenCalledWith({
    projectId: 'p-remote',
    path: '/home/u/proj/src',
  });
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
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;

  await act(async () =>
    renderUi(
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
  await settle();

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
  expect(row('本地项目').querySelector('svg.lucide-folder-kanban')).toBeTruthy();
  expect(row('本地项目').querySelector('svg.lucide-cloud')).toBeNull();
});

it('lists a subdirectory lazily and collapses it again', async () => {
  const listRemoteDirectory = vi.fn(async ({ path }: RemoteListInput) =>
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
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;

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
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;

  await renderTree(['p-remote']);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(1);

  await act(async () =>
    renderUi(
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
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;

  // 打开的项目工作台：项目行不显示，也没有展开态，远端内容直接挂在顶层。
  await renderTree([], vi.fn(), vi.fn(), remoteProject.id);
  expect(listRemoteDirectory).toHaveBeenCalledWith({ projectId: 'p-remote', path: '/home/u/proj' });
  expect(row('src')).toBeTruthy();
});

it('keeps two connections on the same remote path apart', async () => {
  // 两台服务器都开着 /home/u/proj：条目身份必须带项目，否则清单、展开态与选中态会串。
  const first: WorkspaceEntry = { ...remoteProject, id: 'p-a', name: 'a', remoteId: 'r-1' };
  const second: WorkspaceEntry = { ...remoteProject, id: 'p-b', name: 'b', remoteId: 'r-2' };
  const listRemoteDirectory = vi.fn(async ({ projectId }: RemoteListInput) =>
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
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;
  const onExpand = vi.fn();

  await act(async () =>
    renderUi(
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
  await settle();

  expect(listRemoteDirectory).toHaveBeenCalledWith({ projectId: 'p-a', path: '/home/u/proj' });
  expect(listRemoteDirectory).toHaveBeenCalledWith({ projectId: 'p-b', path: '/home/u/proj' });
  expect(row('only-a.txt')).toBeTruthy();
  expect(row('only-b.txt')).toBeTruthy();

  await act(async () => row('src-a').click());
  expect(onExpand).toHaveBeenCalledWith('p-a:/home/u/proj/src-a', true);
});

it('refreshes a remote directory after the tools changed it', async () => {
  // 远端没有文件监听：AI 新建的文件只靠这条通知才会出现在树里。
  const listRemoteDirectory = vi.fn(async ({ path }: RemoteListInput) =>
    path === '/home/u/proj'
      ? [{ name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null }]
      : [{ name: 'new.txt', path: `${path}/new.txt`, directory: false, size: 1, modifiedAt: null }],
  );
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;

  await renderTree(['p-remote', 'p-remote:/home/u/proj/src']);
  expect(listRemoteDirectory).toHaveBeenCalledTimes(2);
  expect(listRemoteDirectory).toHaveBeenLastCalledWith({
    projectId: 'p-remote',
    path: '/home/u/proj/src',
  });

  // 与已缓存目录无关的变化：一次都不重读。
  await act(async () => {
    workspace.listeners.get('workspace:remoteChange')!('/elsewhere/dir');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledTimes(2);

  // 子目录里多了文件（写入的是父目录）：只重读那一层。
  await act(async () => {
    workspace.listeners.get('workspace:remoteChange')!('/home/u/proj/src');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledTimes(3);
  expect(listRemoteDirectory).toHaveBeenLastCalledWith({
    projectId: 'p-remote',
    path: '/home/u/proj/src',
  });

  // bash 的 cwd 是项目根：根这一层（以及已展开的子树）都要重读。
  await act(async () => {
    workspace.listeners.get('workspace:remoteChange')!('/home/u/proj');
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(listRemoteDirectory).toHaveBeenCalledWith({ projectId: 'p-remote', path: '/home/u/proj' });
  expect(listRemoteDirectory).toHaveBeenCalledTimes(5);
});

it('reports the expanded remote directories to watch, and cancels them on unmount', async () => {
  // Dela 之外改的远端文件靠这条上报：远端只盯当前展开的目录。
  const watchRemoteDirectories = vi.fn(async () => ({ watching: 1 }));
  const listRemoteDirectory = vi.fn(async ({ path }: RemoteListInput) =>
    path === '/home/u/proj'
      ? [{ name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null }]
      : [],
  );
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;
  workspace.handlers.watchRemoteDirectories = watchRemoteDirectories;

  await act(async () => {
    renderUi(
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
  expect(watchRemoteDirectories).toHaveBeenLastCalledWith({
    projectId: 'p-remote',
    paths: ['/home/u/proj', '/home/u/proj/src'],
  });

  const calls = watchRemoteDirectories.mock.calls.length;
  await act(async () => {
    renderUi(
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

  await act(async () => {
    renderUi(
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
  expect(watchRemoteDirectories).toHaveBeenLastCalledWith({
    projectId: 'p-remote',
    paths: ['/home/u/proj'],
  });

  await act(async () => root.unmount());
  expect(watchRemoteDirectories).toHaveBeenLastCalledWith({ projectId: 'p-remote', paths: [] });
  root = createRoot(container);
});

it('offers only rename and remove on a remote project row', async () => {
  // 远端项目只能改 Dela 里登记的名字；移动、归档、新建对它都没有意义。
  await renderTree([]);
  await act(async () => openRowMenu('proj'));
  expect([...menuItems()].map((item) => item.textContent?.trim())).toEqual(['重命名', '移除']);
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
    renderUi(
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
  window.dela = { bridge: workspace.bridge } as unknown as DelaApi;
  workspace.remotes.list = async () => [{ id: 'r-1', host: 'user@10.0.0.5' }];
  workspace.handlers.listRemoteDirectory = listRemoteDirectory;
  const slow: WorkspaceEntry = { ...remoteProject, id: 'p-slow', name: '慢项目' };

  await act(async () =>
    renderUi(
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

  await act(async () =>
    release([
      { name: 'src', path: '/home/u/proj/src', directory: true, size: null, modifiedAt: null },
    ]),
  );
  await settle();
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(row('src')).toBeTruthy();
});
