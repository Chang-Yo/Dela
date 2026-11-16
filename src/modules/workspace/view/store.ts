// 条目树镜像。视图持久化在 workbench 布局，笔记草稿生命周期在 note 模块。
import { create } from 'zustand';
import { errorMessage } from '../../../core/protocol/contract';
import { workspaceArchiveId, type WorkspaceEntry, type WorkspaceState } from '../contract';
import { onWorkspaceEvent, workspaceClient } from './client';

type Store = {
  workspace: WorkspaceState;
  overview: WorkspaceState | null;
  directories: Record<string, WorkspaceEntry[]>;
  ensureDirectory: (id: string, force?: boolean) => Promise<void>;
  releaseDirectory: (id: string) => void;
  holdDirectories: (owner: string, ids: string[]) => Promise<void>;
  directoryOwners: Record<string, string[]>;
  rememberEntries: (entries: WorkspaceEntry[]) => void;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  refresh: (paths?: string[]) => Promise<void>;
  setError: (error: unknown) => void;
  loading: Promise<void> | null;
  refreshing: Promise<void> | null;
  refreshQueue: { all: boolean; paths: string[] } | null;
  directoryRequests: Record<string, Promise<void>>;
  watchingChanges: boolean;
};

const without = <T>(record: Record<string, T>, id: string) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
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
    const pending = get().directoryRequests[id];
    if (!force && pending) return pending;
    if (!force && get().directories[id]) return Promise.resolve();
    const request = workspaceClient
      .listLocalDirectory(id)
      .then((items) => {
        if (get().directoryRequests[id] !== request) return;
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
        if (get().directoryRequests[id] === request)
          set({ directoryRequests: without(get().directoryRequests, id) });
      });
    set({ directoryRequests: { ...get().directoryRequests, [id]: request } });
    return request;
  },
  releaseDirectory: (id) => {
    set({ directoryRequests: without(get().directoryRequests, id) });
    const { [id]: removed, ...directories } = get().directories;
    if (!removed) return;
    set({
      directories,
      workspace: mergeDirectories(get().overview ?? get().workspace, directories, get().workspace),
    });
  },
  holdDirectories: async (owner, ids) => {
    const others = without(get().directoryOwners, owner);
    for (const id of get().directoryOwners[owner] ?? [])
      if (!ids.includes(id) && !Object.values(others).some((held) => held.includes(id)))
        get().releaseDirectory(id);
    set({ directoryOwners: ids.length ? { ...others, [owner]: ids } : others });
    await Promise.all(ids.map((id) => get().ensureDirectory(id)));
  },
  directoryOwners: {},
  loaded: false,
  error: null,
  loading: null,
  refreshing: null,
  refreshQueue: null,
  directoryRequests: {},
  watchingChanges: false,
  setError: (error) => set({ error: error === null ? null : errorMessage(error) }),
  load: () => {
    if (get().loaded || !window.dela) return Promise.resolve();
    if (!get().watchingChanges) {
      set({ watchingChanges: true });
      onWorkspaceEvent('changed', (paths) => {
        void get()
          .refresh(paths)
          .catch((cause) => console.error('[workspace] 刷新条目镜像失败', cause));
      });
    }
    const pending = get().loading;
    if (pending) return pending;
    const loading = (async () => {
      try {
        const workspace = await workspaceClient.state();
        set({ workspace, overview: workspace, loaded: true });
      } catch (cause) {
        set({ error: errorMessage(cause) });
      }
    })().finally(() => set({ loading: null }));
    set({ loading });
    return loading;
  },
  refresh: (paths) => {
    if (!window.dela) return Promise.resolve();
    const queued = get().refreshQueue;
    set({
      refreshQueue: {
        all: Boolean(queued?.all) || !paths,
        paths: [...(queued?.paths ?? []), ...(paths ?? [])],
      },
    });
    const running = get().refreshing;
    if (running) return running;
    const refreshing = (async () => {
      for (let queue = get().refreshQueue; queue; queue = get().refreshQueue) {
        set({ refreshQueue: null });
        const changes = [...new Set(queue.paths)];
        const all =
          queue.all ||
          changes.some((path) => /(?:^|[\\/])\.gitignore$|\.git[\\/]info[\\/]exclude$/.test(path));
        const overview = await workspaceClient.state();
        set({
          overview,
          workspace: mergeDirectories(overview, get().directories, get().workspace),
        });
        for (const id of new Set([
          ...Object.keys(get().directories),
          ...Object.keys(get().directoryRequests),
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
    })().finally(() => set({ refreshing: null }));
    set({ refreshing });
    return refreshing;
  },
}));
