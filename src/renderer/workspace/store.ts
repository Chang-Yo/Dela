// 条目树 + Canvas 概览镜像。视图持久化（setView）已移交 workbench 布局，
// 笔记草稿生命周期在 ./drafts.ts，本 store 不再持有。
import { create } from 'zustand';
import type { CanvasState, WorkspaceState } from '../../shared/api';

type Store = {
  workspace: WorkspaceState;
  canvas: CanvasState;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setCanvas: (state: CanvasState) => void;
  setError: (error: unknown) => void;
};

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(error);

let loadPromise: Promise<void> | null = null;
// 磁盘为准的文件树：外部文件变化经 main 的 fs.watch 推送 workspace:changed，
// 这里刷新条目镜像；编辑中的草稿独立持有，不受刷新影响。
let subscribedChanges = false;

export const useWorkspaceStore = create<Store>((set, get) => ({
  workspace: { entries: [], views: {}, directory: '' },
  canvas: { connected: false, syncedAt: null, courses: [], items: [] },
  loaded: false,
  error: null,
  setError: (error) => set({ error: error === null ? null : errorText(error) }),
  load: () => {
    const dela = window.dela;
    if (get().loaded || !dela) return Promise.resolve();
    if (!subscribedChanges) {
      subscribedChanges = true;
      dela.workspace.onChanged(() => {
        // 推送驱动的后台刷新失败不打扰用户，下一轮变更推送会重试。
        void get()
          .refresh()
          .catch((cause) => console.error('[workspace] 刷新条目镜像失败', cause));
      });
    }
    // Concurrent callers (StrictMode double-invocation included) share one request;
    // cleared on settle so a failed load can be retried.
    if (!loadPromise) {
      loadPromise = (async () => {
        const [workspace, canvas] = await Promise.allSettled([
          dela.workspace.getState(),
          dela.canvas.getState(),
        ]);
        if (workspace.status === 'fulfilled') set({ workspace: workspace.value, loaded: true });
        else set({ error: errorText(workspace.reason) });
        if (canvas.status === 'fulfilled') set({ canvas: canvas.value });
        else set({ error: errorText(canvas.reason) });
      })().finally(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  },
  refresh: async () => {
    if (window.dela) set({ workspace: await window.dela.workspace.getState() });
  },
  setCanvas: (canvas) => set({ canvas }),
}));
