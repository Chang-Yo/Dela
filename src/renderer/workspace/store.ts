// 条目树 + Canvas 概览镜像。视图持久化在 workbench 布局，笔记草稿生命周期在 ./drafts.ts。
import { create } from 'zustand';
import {
  workspaceArchiveId,
  type CachedCourseFile,
  type CanvasState,
  type WorkspaceEntry,
  type WorkspaceState,
} from '../../shared/api';

type Store = {
  workspace: WorkspaceState;
  overview: WorkspaceState | null;
  directories: Record<string, WorkspaceEntry[]>;
  ensureDirectory: (id: string, force?: boolean) => Promise<void>;
  releaseDirectory: (id: string) => void;
  rememberEntries: (entries: WorkspaceEntry[]) => void;
  canvas: CanvasState;
  /** 已下载到本地 courses 目录的课件（@ 引用候选）；进入通用池会话时拉取，30 秒内去重。 */
  courseFiles: CachedCourseFile[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  refresh: (paths?: string[]) => Promise<void>;
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
let refreshAll = false;
const refreshPaths = new Set<string>();
const directoryRequests = new Map<string, Promise<void>>();
const normalized = (path: string) =>
  /^[a-z]:[\\/]/i.test(path) ? path.replaceAll('\\', '/').toLowerCase() : path;
const affected = (directory: string, path: string) => {
  directory = normalized(directory).replace(/\/$/, '');
  path = normalized(path).replace(/\/$/, '');
  return (
    directory === path ||
    directory.startsWith(`${path}/`) ||
    path.slice(0, path.lastIndexOf('/')) === directory
  );
};
function mergeDirectories(
  overview: WorkspaceState,
  directories: Record<string, WorkspaceEntry[]>,
  previous: WorkspaceState,
): WorkspaceState {
  const old = new Map(previous.entries.map((item) => [item.id, item]));
  const entries = new Map(
    overview.entries
      .filter((item) => item.id !== workspaceArchiveId)
      .map((item) => [item.id, item]),
  );
  const pending = [...entries.keys(), workspaceArchiveId];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const item of directories[id] ?? []) {
      entries.set(item.id, item);
      pending.push(item.id);
    }
  }
  const next = [...entries.values()].map((item) => {
    const prior = old.get(item.id);
    return prior &&
      Object.keys(item).every(
        (key) => item[key as keyof WorkspaceEntry] === prior[key as keyof WorkspaceEntry],
      )
      ? prior
      : item;
  });
  const unchanged =
    next.length === previous.entries.length &&
    next.every((item, index) => item === previous.entries[index]);
  return { ...overview, entries: unchanged ? previous.entries : next };
}
// 课件候选的拉取游标：0 = 上次拉取失败，下次触发立即重试。
let courseFilesFetchedAt = 0;
// 磁盘为准的文件树：外部文件变化经 main 的 fs.watch 推送 workspace:changed，
// 这里刷新条目镜像；编辑中的草稿独立持有，不受刷新影响。
let subscribedChanges = false;
// Canvas 后台目录同步经 canvas:state 推送，镜像在这里随收随更新。
let subscribedCanvas = false;

export const useWorkspaceStore = create<Store>((set, get) => ({
  workspace: { entries: [], directory: '' },
  overview: null,
  directories: {},
  rememberEntries: (entries) => {
    const overview = get().overview ?? get().workspace;
    const next = {
      ...overview,
      entries: [
        ...new Map([...overview.entries, ...entries].map((item) => [item.id, item])).values(),
      ],
    };
    set({ overview: next, workspace: mergeDirectories(next, get().directories, get().workspace) });
  },
  ensureDirectory: (id, force = false) => {
    if (!window.dela?.workspace.listLocalDirectory) return Promise.resolve();
    if (!force && directoryRequests.has(id)) return directoryRequests.get(id)!;
    if (!force && get().directories[id]) return Promise.resolve();
    const request = window.dela.workspace
      .listLocalDirectory(id)
      .then((items) => {
        if (directoryRequests.get(id) !== request) return;
        const directories = { ...get().directories, [id]: items };
        set({
          directories,
          workspace: mergeDirectories(
            get().overview ?? get().workspace,
            directories,
            get().workspace,
          ),
        });
      })
      .finally(() => {
        if (directoryRequests.get(id) === request) directoryRequests.delete(id);
      });
    directoryRequests.set(id, request);
    return request;
  },
  releaseDirectory: (id) => {
    directoryRequests.delete(id);
    const { [id]: removed, ...directories } = get().directories;
    if (!removed) return;
    set({
      directories,
      workspace: mergeDirectories(get().overview ?? get().workspace, directories, get().workspace),
    });
  },
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
      dela.workspace.onChanged((paths) => {
        // 推送驱动的后台刷新失败不打扰用户，下一轮变更推送会重试。
        void get()
          .refresh(paths)
          .catch((cause) => console.error('[workspace] 刷新条目镜像失败', cause));
      });
    }
    if (!subscribedCanvas) {
      subscribedCanvas = true;
      dela.canvas.onState((state) => set({ canvas: state }));
    }
    // Concurrent callers (StrictMode double-invocation included) share one request;
    // cleared on settle so a failed load can be retried.
    if (!loadPromise) {
      loadPromise = (async () => {
        const [workspace, canvas] = await Promise.allSettled([
          dela.workspace.getState(),
          dela.canvas.getState(),
        ]);
        if (workspace.status === 'fulfilled')
          set({ workspace: workspace.value, overview: workspace.value, loaded: true });
        else set({ error: errorText(workspace.reason) });
        if (canvas.status === 'fulfilled') set({ canvas: canvas.value });
        else set({ error: errorText(canvas.reason) });
      })().finally(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  },
  refresh: (paths) => {
    if (!window.dela) return Promise.resolve();
    refreshPending = true;
    if (!paths) refreshAll = true;
    else for (const path of paths) refreshPaths.add(path);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        while (refreshPending) {
          refreshPending = false;
          const all =
            refreshAll ||
            [...refreshPaths].some((path) =>
              /(?:^|[\\/])\.gitignore$|\.git[\\/]info[\\/]exclude$/.test(path),
            );
          const changes = [...refreshPaths];
          refreshAll = false;
          refreshPaths.clear();
          const overview = await window.dela!.workspace.getState();
          set({
            overview,
            workspace: mergeDirectories(overview, get().directories, get().workspace),
          });
          for (const id of new Set([
            ...Object.keys(get().directories),
            ...directoryRequests.keys(),
          ])) {
            const item = get().workspace.entries.find((entry) => entry.id === id);
            const path =
              item?.path ??
              (id === workspaceArchiveId
                ? (overview.archivePath ?? `${overview.directory}/workspace/归档`)
                : id);
            if (all || changes.some((change) => affected(path, change))) {
              try {
                await get().ensureDirectory(id, true);
              } catch {
                get().releaseDirectory(id);
              }
            }
          }
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
