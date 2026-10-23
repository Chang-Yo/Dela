// 条目树 + Canvas 概览镜像。视图持久化在 workbench 布局，笔记草稿生命周期在 ./drafts.ts。
import { create } from 'zustand';
import type { CachedCourseFile, CanvasState, WorkspaceState } from '../../shared/api';

type Store = {
  workspace: WorkspaceState;
  canvas: CanvasState;
  /** 已下载到本地 courses 目录的课件（@ 引用候选）；进入通用池会话时拉取，30 秒内去重。 */
  courseFiles: CachedCourseFile[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setCanvas: (state: CanvasState) => void;
  ensureCourseFiles: () => void;
  setError: (error: unknown) => void;
};

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(error);

let loadPromise: Promise<void> | null = null;
let refreshPromise: Promise<void> | null = null;
let refreshPending = false;
// 课件候选的拉取游标：0 = 上次拉取失败，下次触发立即重试。
let courseFilesFetchedAt = 0;
// 磁盘为准的文件树：外部文件变化经 main 的 fs.watch 推送 workspace:changed，
// 这里刷新条目镜像；编辑中的草稿独立持有，不受刷新影响。
let subscribedChanges = false;

export const useWorkspaceStore = create<Store>((set, get) => ({
  workspace: { entries: [], views: {}, directory: '' },
  canvas: { connected: false, syncedAt: null, courses: [], items: [] },
  courseFiles: [],
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
  refresh: () => {
    if (!window.dela) return Promise.resolve();
    refreshPending = true;
    if (!refreshPromise) {
      refreshPromise = (async () => {
        while (refreshPending) {
          refreshPending = false;
          set({ workspace: await window.dela!.workspace.getState() });
        }
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  },
  setCanvas: (canvas) => set({ canvas }),
  ensureCourseFiles: () => {
    const dela = window.dela;
    if (!dela) return;
    // 进入通用池会话时拉取，30 秒内去重：下载新课件后切换一次会话即可 @ 到；
    // 一次 IPC + DB 扫描，代价可忽略。
    const now = Date.now();
    if (now - courseFilesFetchedAt < 30_000) return;
    courseFilesFetchedAt = now;
    dela.canvas
      .cachedFiles()
      .then((courseFiles) => set({ courseFiles }))
      .catch(() => {
        courseFilesFetchedAt = 0;
      });
  },
}));
