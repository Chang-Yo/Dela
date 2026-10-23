// workspace/store 状态机单测：并发 load 共享一次请求、局部失败不拖垮另一半、
// 失败后可重试、refresh/setError 镜像语义（对照旧 features/projects/workspace.ts）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store';
import type { WorkspaceEntry } from '../../../shared/api';

const workspaceState = { entries: [], views: {}, directory: 'C:/dela' };
const canvasState = { connected: true, syncedAt: null, courses: [], items: [] };

function installDela(handlers: {
  workspace?: () => Promise<unknown>;
  canvas?: () => Promise<unknown>;
}) {
  const getState = vi.fn(handlers.workspace ?? (async () => workspaceState));
  const getCanvasState = vi.fn(handlers.canvas ?? (async () => canvasState));
  const onChanged = vi.fn(() => () => undefined);
  const onCanvasState = vi.fn(() => () => undefined);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: {
        workspace: { getState, onChanged },
        canvas: { getState: getCanvasState, onState: onCanvasState },
      },
    },
  });
  return { getState, getCanvasState, onChanged, onCanvasState };
}

function resetStore() {
  useWorkspaceStore.setState({
    overview: null,
    directories: {},
    workspace: { entries: [], views: {}, directory: '' },
    canvas: { connected: false, syncedAt: null, courses: [], items: [] },
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
    window.dela!.workspace.listLocalDirectory = list;
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
    window.dela!.workspace.listLocalDirectory = () =>
      new Promise((done) => {
        resolve = done;
      });
    const request = useWorkspaceStore.getState().ensureDirectory('C:/closed');
    useWorkspaceStore.getState().releaseDirectory('C:/closed');
    resolve([]);
    await request;
    expect(useWorkspaceStore.getState().directories['C:/closed']).toBeUndefined();
  });
  it('shares one request between concurrent load callers and mirrors both halves', async () => {
    const { getState, getCanvasState, onChanged, onCanvasState } = installDela({});
    await Promise.all([useWorkspaceStore.getState().load(), useWorkspaceStore.getState().load()]);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(getCanvasState).toHaveBeenCalledTimes(1);
    // 外部文件变化订阅只注册一次（模块级去重），变化回调复用 refresh 通道。
    expect(onChanged).toHaveBeenCalledTimes(1);
    // Canvas 后台同步推送的订阅同样只注册一次。
    expect(onCanvasState).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState()).toMatchObject({
      loaded: true,
      workspace: workspaceState,
      canvas: canvasState,
      error: null,
    });
  });

  it('keeps the workspace mirror when the canvas half rejects (Promise.allSettled)', async () => {
    installDela({ canvas: async () => Promise.reject(new Error('canvas down')) });
    await useWorkspaceStore.getState().load();
    expect(useWorkspaceStore.getState().loaded).toBe(true);
    expect(useWorkspaceStore.getState().workspace).toEqual(workspaceState);
    expect(useWorkspaceStore.getState().error).toBe('canvas down');
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
    const { getState } = installDela({});
    await useWorkspaceStore.getState().load();
    await useWorkspaceStore.getState().load();
    expect(getState).toHaveBeenCalledTimes(1);
  });

  it('refresh replaces the workspace mirror without touching canvas', async () => {
    const next = { entries: [], views: {}, directory: 'C:/elsewhere' };
    installDela({ workspace: async () => next });
    await useWorkspaceStore.getState().refresh();
    expect(useWorkspaceStore.getState().workspace).toEqual(next);
    expect(useWorkspaceStore.getState().canvas.connected).toBe(false);
  });

  it('setError unwraps IPC error prefixes and resets to null', () => {
    useWorkspaceStore
      .getState()
      .setError(new Error("Error invoking remote method 'workspace:get-state': Error: boom"));
    expect(useWorkspaceStore.getState().error).toBe('boom');
    useWorkspaceStore.getState().setError(null);
    expect(useWorkspaceStore.getState().error).toBeNull();
  });

  it('coalesces refreshes but reads again for changes received during an active request', async () => {
    let resolveFirst!: (value: typeof workspaceState) => void;
    const next = { ...workspaceState, directory: 'C:/updated' };
    const { getState } = installDela({
      workspace: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const first = useWorkspaceStore.getState().refresh();
    const second = useWorkspaceStore.getState().refresh();
    const third = useWorkspaceStore.getState().refresh();
    expect(getState).toHaveBeenCalledTimes(1);
    getState.mockResolvedValue(next);
    resolveFirst(workspaceState);
    await Promise.all([first, second, third]);
    expect(getState).toHaveBeenCalledTimes(2);
    expect(useWorkspaceStore.getState().workspace).toEqual(next);
  });
});
