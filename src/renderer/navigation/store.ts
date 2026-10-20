// 导航视图状态（不持久化）与项目入口偏好（dela.project-nav 持久化）；条目与会话事实由
// workspace 镜像与注入的 sessions 数据提供。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceEntry } from '../../shared/api';

type ProjectNavPreference = { pinned?: boolean; hidden?: boolean; section?: string };
export const useProjectNavPrefs = create<{
  projects: Record<string, ProjectNavPreference>;
  setProject: (id: string, patch: ProjectNavPreference) => void;
}>()(
  persist(
    (set) => ({
      projects: {},
      setProject: (id, patch) =>
        set((state) => ({
          projects: { ...state.projects, [id]: { ...state.projects[id], ...patch } },
        })),
    }),
    { name: 'dela.project-nav', partialize: (state) => ({ projects: state.projects }) },
  ),
);

export function ancestorChainOf(entries: WorkspaceEntry[], id: string): string[] {
  const chain = [id];
  let parent = entries.find((e) => e.id === id)?.parentId;
  while (parent) {
    chain.unshift(parent);
    parent = entries.find((e) => e.id === parent)?.parentId;
  }
  return chain;
}

/** 项目被重新登记（导入同一目录会复用原来那条）时撤掉「移除项目入口」留下的隐藏偏好：
 *  否则项目加回来了，侧栏里还是看不见它，而会话又都还挂在它名下。 */
export function unhideProjectInNav(id: string): void {
  const { projects, setProject } = useProjectNavPrefs.getState();
  if (projects[id]?.hidden) setProject(id, { hidden: false });
}

type Store = {
  query: string;
  setQuery: (query: string) => void;
  /** 文件/资料树节点展开态。 */
  expanded: string[];
  expand: (id: string, open: boolean) => void;
  /** 展开祖先链并选中末位；滚动由树组件负责。 */
  reveal: (chain: string[]) => void;
  collapseAll: () => void;
  selected: string | null;
  select: (id: string | null) => void;
  /** 项目会话导航：展开的项目区。'general'（通用对话组）默认展开——侧栏中部即会话历史。 */
  openProjects: string[];
  toggleProject: (id: string, open?: boolean) => void;
  /** 已点「显示更多」的项目；其余项目只显示前几条近期会话。 */
  fullSessionLists: string[];
  toggleFullSessionList: (id: string) => void;
};

export const useNavigationStore = create<Store>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
  expanded: [],
  expand: (id, open) =>
    set((s) => ({
      expanded: open
        ? [...new Set([...s.expanded, id])]
        : s.expanded.filter((value) => value !== id),
    })),
  reveal: (chain) =>
    set((s) => ({
      expanded: [...new Set([...s.expanded, ...chain])],
      selected: chain.at(-1) ?? null,
    })),
  collapseAll: () => set({ expanded: [] }),
  selected: null,
  select: (selected) => set({ selected }),
  openProjects: ['general'],
  toggleProject: (id, open) =>
    set((s) => ({
      openProjects:
        (open ?? !s.openProjects.includes(id))
          ? [...new Set([...s.openProjects, id])]
          : s.openProjects.filter((value) => value !== id),
    })),
  fullSessionLists: [],
  toggleFullSessionList: (id) =>
    set((s) => ({
      fullSessionLists: s.fullSessionLists.includes(id)
        ? s.fullSessionLists.filter((value) => value !== id)
        : [...s.fullSessionLists, id],
    })),
}));
