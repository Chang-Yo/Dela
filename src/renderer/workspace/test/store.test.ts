// workspace/store 状态机单测：并发 load 共享一次请求、局部失败不拖垮另一半、
// 失败后可重试、refresh/setCanvas/setError 镜像语义（对照旧 features/projects/workspace.ts）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store';
import type { CanvasState } from '../../../shared/canvas';

const workspaceState = { entries: [], views: {}, directory: 'C:/dela' };
const canvasState = { connected: true, syncedAt: null, courses: [], items: [] };
let canvasListener: (state: CanvasState) => void;

function installDela(handlers: {
  workspace?: () => Promise<unknown>;
  canvas?: () => Promise<unknown>;
}) {
  const getState = vi.fn(handlers.workspace ?? (async () => workspaceState));
  const getCanvasState = vi.fn(handlers.canvas ?? (async () => canvasState));
  const onChanged = vi.fn(() => () => undefined);
  const onCanvasChanged = vi.fn((listener: typeof canvasListener) => {
    canvasListener = listener;
    return () => undefined;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: {
        workspace: { getState, onChanged },
        canvas: { getState: getCanvasState, onChanged: onCanvasChanged },
      },
    },
  });
  return { getState, getCanvasState, onChanged, onCanvasChanged };
}

function resetStore() {
  useWorkspaceStore.setState({
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
  it('shares one request between concurrent load callers and mirrors both halves', async () => {
    const { getState, getCanvasState, onChanged, onCanvasChanged } = installDela({});
    await Promise.all([useWorkspaceStore.getState().load(), useWorkspaceStore.getState().load()]);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(getCanvasState).toHaveBeenCalledTimes(1);
    // 外部文件变化订阅只注册一次（模块级去重），变化回调复用 refresh 通道。
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onCanvasChanged).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState()).toMatchObject({
      loaded: true,
      workspace: workspaceState,
      canvas: canvasState,
      error: null,
    });
  });

  it('applies background updates without reopening the page and ignores a stale initial snapshot', async () => {
    let finish!: (state: typeof canvasState) => void;
    installDela({
      canvas: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const loading = useWorkspaceStore.getState().load();
    const updated = { ...canvasState, syncedAt: '2026-10-17T12:00:00Z' };
    canvasListener(updated);
    expect(useWorkspaceStore.getState().canvas).toEqual(updated);
    finish(canvasState);
    await loading;
    expect(useWorkspaceStore.getState().canvas).toEqual(updated);
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
    expect(useWorkspaceStore.getState().workspace).toBe(next);
    expect(useWorkspaceStore.getState().canvas.connected).toBe(false);
  });

  it('setCanvas mirrors the given state and setError unwraps IPC error prefixes', () => {
    useWorkspaceStore.getState().setCanvas(canvasState);
    expect(useWorkspaceStore.getState().canvas).toBe(canvasState);
    useWorkspaceStore
      .getState()
      .setError(new Error("Error invoking remote method 'workspace:get-state': Error: boom"));
    expect(useWorkspaceStore.getState().error).toBe('boom');
    useWorkspaceStore.getState().setError(null);
    expect(useWorkspaceStore.getState().error).toBeNull();
  });
});
