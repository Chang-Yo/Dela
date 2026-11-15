// workspace/store 状态机单测：并发 load 共享一次请求、失败后可重试、refresh/setError 镜像语义。
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../contract';

// 契约客户端在模块加载时取 bridge，须先于导入 store 装好。
const { api, bridge } = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const bridge = {
    invoke: async (channel: string, input: never) =>
      handlers[channel.slice('workspace:'.length)]!(input),
    subscribe: vi.fn(() => () => undefined),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dela: { bridge } } });
  return { api: handlers, bridge };
});
import { useWorkspaceStore } from '../store';

const workspaceState = { entries: [], directory: 'C:/dela' };

function installDela(handlers: { workspace?: () => Promise<unknown> }) {
  const state = vi.fn(handlers.workspace ?? (async () => workspaceState));
  api.state = state;
  bridge.subscribe.mockClear();
  return { state, onChanged: bridge.subscribe };
}

function resetStore() {
  useWorkspaceStore.setState({
    overview: null,
    directories: {},
    directoryOwners: {},
    workspace: { entries: [], directory: '' },
    loaded: false,
    error: null,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetStore();
});

describe('workspace store mirror', () => {
  it('loads a directory once, refreshes only an affected listing, and keeps unrelated row identities', async () => {
    const item = (
      id: string,
      parentId: string | null,
      kind: WorkspaceEntry['kind'] = 'folder',
    ): WorkspaceEntry => ({
      id,
      parentId,
      kind,
      name: id,
      path: id,
      sourceId: null,
      updatedAt: '',
    });
    const left = item('C:/left', null, 'project');
    const right = item('C:/right', null, 'project');
    const file = item('C:/right/file', right.id, 'file');
    const overview = { ...workspaceState, entries: [left, right] };
    installDela({ workspace: async () => overview });
    const list = vi.fn(async (id: string | null) => (id === left.id ? [] : [file]));
    api.listLocalDirectory = list;
    useWorkspaceStore.setState({ workspace: overview, overview, directories: {} });
    await Promise.all([
      useWorkspaceStore.getState().ensureDirectory(left.id),
      useWorkspaceStore.getState().ensureDirectory(left.id),
    ]);
    expect(list).toHaveBeenCalledTimes(1);
    await useWorkspaceStore.getState().ensureDirectory(right.id);
    const prior = useWorkspaceStore
      .getState()
      .workspace.entries.find((entry) => entry.id === file.id);
    list.mockClear();
    await useWorkspaceStore.getState().refresh(['C:/left/new.txt']);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(left.id);
    expect(
      useWorkspaceStore.getState().workspace.entries.find((entry) => entry.id === file.id),
    ).toBe(prior);
  });

  it('does not restore directory data after it was released while a request was pending', async () => {
    installDela({});
    let resolve!: (entries: WorkspaceEntry[]) => void;
    api.listLocalDirectory = () =>
      new Promise((done) => {
        resolve = done;
      });
    const request = useWorkspaceStore.getState().ensureDirectory('C:/closed');
    useWorkspaceStore.getState().releaseDirectory('C:/closed');
    resolve([]);
    await request;
    expect(useWorkspaceStore.getState().directories['C:/closed']).toBeUndefined();
  });
  it('keeps a directory while another owner still holds it', async () => {
    installDela({});
    api.listLocalDirectory = async () => [];
    const shared = 'C:/shared';
    const { holdDirectories } = useWorkspaceStore.getState();
    await holdDirectories('first', [shared]);
    await holdDirectories('second', [shared]);
    await holdDirectories('first', []);
    expect(useWorkspaceStore.getState().directories[shared]).toBeDefined();
    await holdDirectories('second', []);
    expect(useWorkspaceStore.getState().directories[shared]).toBeUndefined();
  });
  it('shares one request between concurrent load callers', async () => {
    const { state, onChanged } = installDela({});
    await Promise.all([useWorkspaceStore.getState().load(), useWorkspaceStore.getState().load()]);
    expect(state).toHaveBeenCalledTimes(1);
    // 外部文件变化订阅只注册一次（模块级去重），变化回调复用 refresh 通道。
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('workspace:changed', expect.any(Function));
    expect(useWorkspaceStore.getState()).toMatchObject({
      loaded: true,
      workspace: workspaceState,
      error: null,
    });
  });

  it('leaves loaded false on a failed workspace load so it can be retried', async () => {
    let attempts = 0;
    installDela({
      workspace: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('db locked'))
          : Promise.resolve(workspaceState);
      },
    });
    await useWorkspaceStore.getState().load();
    expect(useWorkspaceStore.getState().loaded).toBe(false);
    expect(useWorkspaceStore.getState().error).toBe('db locked');
    await useWorkspaceStore.getState().load();
    expect(attempts).toBe(2);
    expect(useWorkspaceStore.getState().loaded).toBe(true);
  });

  it('skips the request entirely once loaded', async () => {
    const { state } = installDela({});
    await useWorkspaceStore.getState().load();
    await useWorkspaceStore.getState().load();
    expect(state).toHaveBeenCalledTimes(1);
  });

  it('refresh replaces the workspace mirror', async () => {
    const next = { entries: [], directory: 'C:/elsewhere' };
    installDela({ workspace: async () => next });
    await useWorkspaceStore.getState().refresh();
    expect(useWorkspaceStore.getState().workspace).toEqual(next);
  });

  it('coalesces refreshes but reads again for changes received during an active request', async () => {
    let resolveFirst!: (value: typeof workspaceState) => void;
    const next = { ...workspaceState, directory: 'C:/updated' };
    const { state } = installDela({
      workspace: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const first = useWorkspaceStore.getState().refresh();
    const second = useWorkspaceStore.getState().refresh();
    const third = useWorkspaceStore.getState().refresh();
    expect(state).toHaveBeenCalledTimes(1);
    state.mockResolvedValue(next);
    resolveFirst(workspaceState);
    await Promise.all([first, second, third]);
    expect(state).toHaveBeenCalledTimes(2);
    expect(useWorkspaceStore.getState().workspace).toEqual(next);
  });
});
