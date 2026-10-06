// 工作台布局 store（docs/refactor/structure.md §3.5：分割树/标签/焦点/最大化归 zustand，
// 持久化经 IPC layout:save 防抖 800ms，按项目键控；事实落 main 侧 workspace_settings）。
import { create } from 'zustand';
import type {
  GroupNode,
  LayoutNode,
  SplitOrientation,
  TabId,
  WorkbenchLayout,
} from '../../shared/layout';
import {
  clampRatio,
  collapseEmptyGroups,
  countNodes,
  createDefaultLayout,
  findGroup,
  maxLayoutNodes,
  maxTabsPerGroup,
  nextGroupId,
  nodeAtPath,
  parseWorkbenchLayout,
  removeGroup,
  removeStoredLegacyLayout,
  replaceAtPath,
  replaceGroupNode,
  seedLayoutFromLegacy,
  updateGroup,
  walkGroups,
  type LegacySeedInput,
} from './layout-schema';
import type { EdgeZone } from './tab-dnd';

const PERSIST_DEBOUNCE_MS = 800;

// 容量超限（单组 maxTabsPerGroup / 全树 maxLayoutNodes）此前静默 return（评审 6）。
// 无现成 toast 子系统，取 console.warn 作最小反馈；不为此改动三个动作的返回签名。
const CAPACITY_LIMIT_REACHED = '工作组容量已达上限，已忽略本次操作';

type Store = {
  projectId: string | null;
  root: LayoutNode;
  focus: string;
  maximized: string | null;
  /** init 完成前不渲染布局，避免默认空组闪一帧再被真实布局替换。 */
  ready: boolean;
  /** 载入项目布局；无保存时用旧数据种子或默认单组。rapid 切换由 token 竞态保护。 */
  init(projectId: string | null, legacy?: LegacySeedInput): Promise<void>;
  /** 聚焦已有标签（无显式目标时）；显式目标组允许跨组重复打开（并排第二视图）。 */
  openTab(tabId: TabId, targetGroupId?: string): void;
  closeTab(tabId: TabId, groupId?: string): void;
  /** 批量关闭：others = 除锚点外，right = 锚点右侧，all = 整组（含组本身）。 */
  closeTabs(groupId: string, mode: 'others' | 'right' | 'all', anchor?: TabId): void;
  /** 组内排序 / 跨组移动（跨组去重：目标组已有同 id 标签时移动到新位置，不复制）。 */
  moveTab(tabId: TabId, fromGroupId: string, toGroupId: string, targetIndex?: number): void;
  /** 边缘拖放：在目标组的指定边缘分出新组并移入标签。 */
  moveTabToEdge(tabId: TabId, fromGroupId: string, targetGroupId: string, zone: EdgeZone): void;
  /** 把组包进新的二元 split（三屏经嵌套组合）；新组复制当前活动标签（VS Code 行为）。 */
  splitGroup(groupId: string, orientation: SplitOrientation): void;
  setMaximized(groupId: string | null): void;
  setRatio(path: number[], ratio: number): void;
  focusGroup(groupId: string): void;
};

// 拖拽中高频变化的 ratio 延迟落盘；只有最后一次变更会真正发出 layout:save。
let persistTimer: ReturnType<typeof setTimeout> | null = null;
// 当前项目布局成功落库后要清的旧视图键（3C）：dela.editor.layout.{scope} 是旧 ProjectView
// 的布局事实（已迁移到 layout:{projectId}），agentOpen/agentWidth 是旧助手面板死键。
// 布局保存失败不清理（下次变更重试）；项目快速切换时只清最后落库项目的键，
// 未保存项目的旧键保留，供下次进入该项目时再次种子。
let pendingLegacyScope: string | null = null;

function clearLegacyViewKeys() {
  if (pendingLegacyScope === null || typeof localStorage === 'undefined') return;
  removeStoredLegacyLayout(pendingLegacyScope);
  localStorage.removeItem('dela.workspace.agentOpen');
  localStorage.removeItem('dela.workspace.agentWidth');
  pendingLegacyScope = null;
}

function saveLayoutNow() {
  const api = typeof window === 'undefined' ? undefined : window.dela?.layout;
  if (!api) return;
  const { projectId, root, focus, maximized } = useWorkbenchLayout.getState();
  void api
    .save(projectId, { root, focus, maximized })
    // 持久化失败不打断布局操作；下次变更会重试。首次成功后清除旧视图 localStorage 键。
    .then(clearLegacyViewKeys)
    .catch(() => {});
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveLayoutNow();
  }, PERSIST_DEBOUNCE_MS);
}

/** 去抖窗口内项目切换时冲刷在途保存：此刻快照仍属旧项目（init 尚未覆盖状态），立即落库。 */
function flushPersist() {
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  saveLayoutNow();
}

let initToken = 0;

export const useWorkbenchLayout = create<Store>((set, get) => ({
  projectId: null,
  root: createDefaultLayout().root,
  focus: 'primary',
  maximized: null,
  ready: false,

  init: async (projectId, legacy) => {
    // 同项目布局已在用（home↔工作台切换会重挂载宿主）：复用现态直接返回，不再置
    // ready=false 重走 IPC——那会让切换瞬间工作台空白一次，观感如同整页重载。
    if (get().ready && get().projectId === projectId) return;
    // 先冲刷上个项目在途的布局保存（快照仍属旧项目），否则 800ms 内切项目会丢该次变更。
    flushPersist();
    const token = ++initToken;
    set({ ready: false });
    let saved: WorkbenchLayout | null = null;
    if (typeof window !== 'undefined' && window.dela?.layout) {
      try {
        saved = await window.dela.layout.get(projectId);
      } catch {
        saved = null;
      }
    }
    if (token !== initToken) return;
    const next = collapseEmptyGroups(
      parseWorkbenchLayout(saved) ??
        (legacy ? seedLayoutFromLegacy(legacy) : createDefaultLayout()),
    );
    // 无论本次布局来自保存还是旧数据种子，落库成功后该项目的旧布局键都已成为死键。
    pendingLegacyScope = legacy?.scope ?? null;
    set({ projectId, root: next.root, focus: next.focus, maximized: next.maximized, ready: true });
    // 种子（含旧数据迁移）写回一次；loaded 场景写回相同数据无副作用。
    schedulePersist();
  },

  openTab: (tabId, targetGroupId) => {
    const { root, focus } = get();
    if (!targetGroupId) {
      const existing = walkGroups(root).find((group) => group.tabs.includes(tabId));
      if (existing) {
        if (existing.active !== tabId || focus !== existing.id) {
          set({
            root: updateGroup(root, existing.id, (group) => ({ ...group, active: tabId })),
            focus: existing.id,
          });
          schedulePersist();
        }
        return;
      }
    }
    const fallback = findGroup(root, focus) ?? walkGroups(root)[0];
    if (!fallback) return;
    const groupId = targetGroupId && findGroup(root, targetGroupId) ? targetGroupId : fallback.id;
    if (!findGroup(root, groupId)!.tabs.includes(tabId)) {
      if (findGroup(root, groupId)!.tabs.length >= maxTabsPerGroup) {
        console.warn(CAPACITY_LIMIT_REACHED, groupId);
        return;
      }
      set({
        root: updateGroup(root, groupId, (group) => ({
          ...group,
          tabs: [...group.tabs, tabId],
          active: tabId,
        })),
        focus: groupId,
      });
    } else {
      set({
        root: updateGroup(root, groupId, (group) => ({ ...group, active: tabId })),
        focus: groupId,
      });
    }
    schedulePersist();
  },

  closeTab: (tabId, groupId) => {
    const { root, focus, maximized } = get();
    const group = findGroup(root, groupId ?? focus);
    if (!group || !group.tabs.includes(tabId)) return;
    const index = group.tabs.indexOf(tabId);
    const tabs = group.tabs.filter((tab) => tab !== tabId);
    const active = group.active === tabId ? (tabs[index] ?? tabs[index - 1] ?? null) : group.active;
    let nextRoot = updateGroup(root, group.id, (node) => ({ ...node, tabs, active }));
    let nextFocus = focus;
    let nextMaximized = maximized;
    // 空组删除并收敛树（根组保留空态）；焦点落到相邻组。
    if (!tabs.length && root.type === 'split') {
      const order = walkGroups(root).map((node) => node.id);
      const position = order.indexOf(group.id);
      const neighbor = order[position + 1] ?? order[position - 1] ?? null;
      nextRoot = removeGroup(nextRoot, group.id);
      nextFocus = neighbor ?? walkGroups(nextRoot)[0]!.id;
      if (nextMaximized === group.id) nextMaximized = null;
    }
    set({ root: nextRoot, focus: nextFocus, maximized: nextMaximized });
    if (
      tabId.startsWith('terminal:') &&
      !walkGroups(nextRoot).some((node) => node.tabs.includes(tabId))
    )
      void window.dela?.terminal.closeProject(tabId.slice('terminal:'.length)).catch(console.error);
    schedulePersist();
  },

  closeTabs: (groupId, mode, anchor) => {
    const group = findGroup(get().root, groupId);
    if (!group) return;
    const anchorTab = anchor ?? group.active;
    const index = anchorTab ? group.tabs.indexOf(anchorTab) : -1;
    const victims =
      mode === 'all'
        ? [...group.tabs]
        : anchorTab && index >= 0
          ? mode === 'others'
            ? group.tabs.filter((tab) => tab !== anchorTab)
            : group.tabs.slice(index + 1)
          : [];
    for (const victim of victims) get().closeTab(victim, groupId);
  },

  moveTab: (tabId, fromGroupId, toGroupId, targetIndex) => {
    const { root } = get();
    const source = findGroup(root, fromGroupId);
    const destination = findGroup(root, toGroupId);
    if (!source || !destination || !source.tabs.includes(tabId)) return;
    const sameGroup = fromGroupId === toGroupId;
    const sourceTabs = source.tabs.filter((tab) => tab !== tabId);
    const destinationTabs = destination.tabs.filter((tab) => tab !== tabId);
    const index = Math.max(
      0,
      Math.min(targetIndex ?? destinationTabs.length, destinationTabs.length),
    );
    destinationTabs.splice(index, 0, tabId);
    let nextRoot = updateGroup(root, fromGroupId, (group) =>
      sameGroup
        ? { ...group, tabs: destinationTabs, active: group.active }
        : {
            ...group,
            tabs: sourceTabs,
            active: source.active === tabId ? (sourceTabs.at(-1) ?? null) : source.active,
          },
    );
    if (!sameGroup)
      nextRoot = updateGroup(nextRoot, toGroupId, (group) => ({
        ...group,
        tabs: destinationTabs,
        active: tabId,
      }));
    set(collapseEmptyGroups({ root: nextRoot, focus: toGroupId, maximized: get().maximized }));
    schedulePersist();
  },

  moveTabToEdge: (tabId, fromGroupId, targetGroupId, zone) => {
    const { root } = get();
    const target = findGroup(root, targetGroupId);
    if (!target || !findGroup(root, fromGroupId)?.tabs.includes(tabId)) return;
    if (fromGroupId === targetGroupId && target.tabs.length === 1) return;
    const orientation: SplitOrientation =
      zone === 'left' || zone === 'right' ? 'vertical' : 'horizontal';
    const newGroup: GroupNode = { type: 'group', id: nextGroupId(root), tabs: [], active: null };
    const children = zone === 'left' || zone === 'top' ? [newGroup, target] : [target, newGroup];
    const nextRoot = replaceGroupNode(root, targetGroupId, () => ({
      type: 'split',
      orientation,
      ratio: 0.5,
      children,
    }));
    if (countNodes(nextRoot) > maxLayoutNodes) {
      console.warn(CAPACITY_LIMIT_REACHED, targetGroupId);
      return;
    }
    set({ root: nextRoot, maximized: null });
    get().moveTab(tabId, fromGroupId, newGroup.id);
  },

  splitGroup: (groupId, orientation) => {
    const { root } = get();
    const group = findGroup(root, groupId);
    if (!group?.active) return;
    const newGroup: GroupNode = {
      type: 'group',
      id: nextGroupId(root),
      tabs: group.active ? [group.active] : [],
      active: group.active,
    };
    const nextRoot = replaceGroupNode(root, groupId, () => ({
      type: 'split',
      orientation,
      ratio: 0.5,
      children: [group, newGroup],
    }));
    if (countNodes(nextRoot) > maxLayoutNodes) {
      console.warn(CAPACITY_LIMIT_REACHED, groupId);
      return;
    }
    // 分屏后需要看到两侧：清掉最大化态。
    set({ root: nextRoot, focus: newGroup.id, maximized: null });
    schedulePersist();
  },

  setMaximized: (groupId) => {
    const { root } = get();
    if (groupId !== null && !findGroup(root, groupId)) return;
    set(groupId ? { maximized: groupId, focus: groupId } : { maximized: null });
    schedulePersist();
  },

  setRatio: (path, ratio) => {
    const { root } = get();
    const node = nodeAtPath(root, path);
    if (!node || node.type !== 'split') return;
    const next = clampRatio(ratio);
    if (next === node.ratio) return;
    set({ root: replaceAtPath(root, path, { ...node, ratio: next }) });
    schedulePersist();
  },

  focusGroup: (groupId) => {
    if (get().focus === groupId || !findGroup(get().root, groupId)) return;
    set({ focus: groupId });
    schedulePersist();
  },
}));
