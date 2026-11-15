// 条目树镜像。视图持久化在 workbench 布局，笔记草稿生命周期在 ./drafts.ts。
import { create } from 'zustand';
import { workspaceArchiveId, type WorkspaceEntry, type WorkspaceState } from '../../shared/api';
import { errorMessage } from '../../core/protocol/contract';
import { onWorkspaceEvent, workspaceClient } from '../../modules/workspace/view';

type Store = {
  workspace: WorkspaceState;
  overview: WorkspaceState | null;
  directories: Record<string, WorkspaceEntry[]>;
  ensureDirectory: (id: string, force?: boolean) => Promise<void>;
  releaseDirectory: (id: string) => void;
  rememberEntries: (entries: WorkspaceEntry[]) => void;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  refresh: (paths?: string[]) => Promise<void>;
  setError: (error: unknown) => void;
};

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
// 磁盘为准的文件树：外部文件变化经 main 的 fs.watch 推送 workspace:changed，
// 这里刷新条目镜像；编辑中的草稿独立持有，不受刷新影响。
let subscribedChanges = false;

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
    if (!window.dela) return Promise.resolve();
    if (!force && directoryRequests.has(id)) return directoryRequests.get(id)!;
    if (!force && get().directories[id]) return Promise.resolve();
    const request = workspaceClient
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
  loaded: false,
  error: null,
  setError: (error) => set({ error: error === null ? null : errorMessage(error) }),
  load: () => {
    if (get().loaded || !window.dela) return Promise.resolve();
    if (!subscribedChanges) {
      subscribedChanges = true;
      onWorkspaceEvent('changed', (paths) => {
        // 推送驱动的后台刷新失败不打扰用户，下一轮变更推送会重试。
        void get()
          .refresh(paths)
          .catch((cause) => console.error('[workspace] 刷新条目镜像失败', cause));
      });
    }
    // Concurrent callers (StrictMode double-invocation included) share one request;
    // cleared on settle so a failed load can be retried.
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const workspace = await workspaceClient.state();
          set({ workspace, overview: workspace, loaded: true });
        } catch (cause) {
          set({ error: errorMessage(cause) });
        }
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
          const overview = await workspaceClient.state();
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
}));
