// @vitest-environment jsdom
// 设置 › 远程：列出已保存连接与实时通道状态（不可用时给出原因）；编辑走共用的连接表单，
// 表单列出随连接删除的项目并可跳转打开；删除需原地二次确认，确认条写明连带移除的后果。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  DelaApi,
  RemoteChannelState,
  RemoteConnection,
  WorkspaceEntry,
} from '../../../../shared/api';
import { useRemoteState } from '../../../workspace/remote/remote-state';
import { RemoteSection } from './RemoteSection';
import { useNavigationStore } from '../../../navigation/view';
import { useWorkspaceStore } from '../../../workspace/store';

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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useRemoteState.setState({ connections: null, candidates: [], channels: {} });
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
  vi.restoreAllMocks();
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
  let emit: (states: RemoteChannelState[]) => void = () => {};
  window.dela = {
    remotes: {
      list: async () => [connection],
      configHosts: async () => [],
      onHelperState: (listener: (states: RemoteChannelState[]) => void) => {
        emit = listener;
        return () => {};
      },
    },
  } as unknown as DelaApi;

  await act(async () => root.render(<RemoteSection />));
  expect(container.textContent).toContain('gpu-box:2222');
  expect(container.textContent).toContain('未连接');
  // 头像方块用该连接自己的取色，而不是固定的灰底。
  expect(
    container.querySelector('[data-setting-id="remote-r-1"] [aria-hidden]')?.getAttribute('style'),
  ).toMatch(/--cal-/);

  await act(async () =>
    emit([{ destination: 'gpu-box', state: 'unavailable', reason: '认证失败', since: 0 }]),
  );
  expect(container.textContent).toContain('不可用');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('认证失败');
});

it('lists projects using the connection and opens one from the form', async () => {
  useWorkspaceStore.setState({
    workspace: { entries: [project], directory: '' },
    loaded: true,
    error: null,
  });
  window.dela = {
    remotes: {
      list: async () => [connection],
      configHosts: async () => [],
      onHelperState: () => () => {},
    },
  } as unknown as DelaApi;
  const openProject = vi.spyOn(useNavigationStore.getState(), 'openProject').mockReturnValue(true);

  await act(async () => root.render(<RemoteSection />));
  await act(async () => button('编辑').click());
  expect(container.textContent).toContain('使用此连接的项目');
  expect(container.textContent).toContain('Course');
  expect(container.textContent).toContain('/home/u/course');

  await act(async () => button('打开项目').click());
  expect(openProject).toHaveBeenCalledWith('p-1');
});

it('spells out what connection deletion takes with it before confirming', async () => {
  useWorkspaceStore.setState({
    workspace: { entries: [project], directory: '' },
    loaded: true,
    error: null,
  });
  // 用户可能正站在被删连接的项目里：删除后要被清场退回通用池，不留幽灵工作台。
  useNavigationStore.setState({ view: 'workbench', projectId: 'p-1' });
  const remove = vi.fn(async () => {});
  window.dela = {
    remotes: {
      list: async () => [connection],
      configHosts: async () => [],
      onHelperState: () => () => {},
      remove,
    },
    // 级联移除项目后表单会拉一次工作区镜像。
    workspace: { getState: async () => ({ entries: [], directory: '' }) },
  } as unknown as DelaApi;

  await act(async () => root.render(<RemoteSection />));
  await act(async () => button('编辑').click());
  await act(async () => button('删除连接').click());
  expect(remove).not.toHaveBeenCalled();
  expect(container.textContent).toContain('同时移除 1 个项目');
  await act(async () => button('确认删除').click());
  expect(remove).toHaveBeenCalledWith('r-1');
  expect(useNavigationStore.getState().projectId).toBeNull();
});
