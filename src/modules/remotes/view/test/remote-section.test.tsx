// @vitest-environment jsdom
// 设置 › 远程：列出已保存连接与实时通道状态（不可用时给出原因）；编辑走共用的连接表单，
// 表单列出随连接删除的项目并可跳转打开；删除需原地二次确认，确认条写明连带移除的后果。
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../../workspace/contract';
import type { RemoteChannelState, RemoteConnection } from '../../contract';

// 契约客户端在模块加载时取 bridge、订阅通道推送，须先于导入视图装好。
const bridge = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const bridge = {
    invoke: vi.fn(),
    subscribe: (channel: string, listener: (payload: unknown) => void) => {
      listeners.set(channel, listener);
      return () => {};
    },
    listeners,
  };
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
  return bridge;
});
import { useRemoteState } from '../remote-state';
import { RemoteSection } from '../RemoteSection';
import { useWorkspaceStore } from '../../../workspace/view';

let container: HTMLDivElement;
let root: Root;

const connection: RemoteConnection = {
  id: 'r-1',
  label: '实验室主机',
  host: 'gpu-box',
  port: 2222,
  keyPath: null,
  createdAt: '2026-10-09T00:00:00.000Z',
};

const project: WorkspaceEntry = {
  id: 'p-1',
  parentId: null,
  name: 'Course',
  kind: 'project',
  sourceId: null,
  path: '/home/u/course',
  remoteId: 'r-1',
  updatedAt: '2026-10-19T00:00:00.000Z',
};

const onOpenProject = vi.fn();
const onProjectsRemoved = vi.fn();

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

const render = async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RemoteSection
          NewProjectDialog={() => null}
          onOpenProject={onOpenProject}
          onProjectsRemoved={onProjectsRemoved}
        />
      </QueryClientProvider>,
    ),
  );
  await flush();
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
  bridge.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'remotes:list') return [connection];
    if (channel === 'workspace:state') return { entries: [], directory: '' };
    if (channel === 'remotes:configHosts' || channel === 'remotes:helperStates') return [];
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient.clear();
  useRemoteState.setState({ pushedChannels: null });
  useWorkspaceStore.setState({
    workspace: { entries: [], directory: '' },
    loaded: true,
    error: null,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

it('lists connections with their live channel state', async () => {
  await render();
  expect(container.textContent).toContain('gpu-box:2222');
  expect(container.textContent).toContain('未连接');
  // 头像方块用该连接自己的取色，而不是固定的灰底。
  expect(
    container.querySelector('[data-setting-id="remote-r-1"] [aria-hidden]')?.getAttribute('style'),
  ).toMatch(/--cal-/);

  const states: RemoteChannelState[] = [
    { destination: 'gpu-box', state: 'unavailable', reason: '认证失败', since: 0 },
  ];
  await act(async () => bridge.listeners.get('remotes:helperState')!(states));
  expect(container.textContent).toContain('不可用');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('认证失败');
});

it('lists projects using the connection and opens one from the form', async () => {
  useWorkspaceStore.setState({
    workspace: { entries: [project], directory: '' },
    loaded: true,
    error: null,
  });

  await render();
  await act(async () => button('编辑').click());
  expect(container.textContent).toContain('使用此连接的项目');
  expect(container.textContent).toContain('Course');
  expect(container.textContent).toContain('/home/u/course');

  await act(async () => button('打开项目').click());
  expect(onOpenProject).toHaveBeenCalledWith('p-1');
});

it('spells out what connection deletion takes with it before confirming', async () => {
  useWorkspaceStore.setState({
    workspace: { entries: [project], directory: '' },
    loaded: true,
    error: null,
  });

  await render();
  await act(async () => button('编辑').click());
  await act(async () => button('删除连接').click());
  expect(bridge.invoke).not.toHaveBeenCalledWith('remotes:remove', expect.anything());
  expect(container.textContent).toContain('同时移除 1 个项目');
  await act(async () => button('确认删除').click());
  expect(bridge.invoke).toHaveBeenCalledWith('remotes:remove', 'r-1');
  // 级联移除项目后拉一次工作区镜像，再交外壳按存活条目清场。
  expect(onProjectsRemoved).toHaveBeenCalledWith(new Set());
});
