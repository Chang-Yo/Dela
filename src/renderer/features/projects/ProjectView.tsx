import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from 'radix-ui';
import {
  Archive,
  Plus,
  ChevronsDownUp,
  ChevronRight,
  Columns2,
  FilePlus2,
  Folder,
  FolderInput,
  FolderPlus,
  GraduationCap,
  PanelLeft,
  PanelRight,
  Square,
  RefreshCw,
  Search,
  Ellipsis,
  KeyRound,
  Rows2,
  X,
} from 'lucide-react';
import { workspaceArchiveId, type WorkspaceEntry } from '../../../shared/api';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Button } from '../../components/ui/button';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { Input } from '../../components/ui/input';
import { Resizer } from '../../components/ui/resizer';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { explorerDragType } from '../../components/ui/explorer';
import { cn } from '../../lib/utils';
import { SourceList, latestTermOf } from '../sources/SourceList';
import { ProjectDocument } from './ProjectDocument';
import { forgetMarkdownEditorState } from './MarkdownEditor';
import { forgetNoteEditorState } from './NoteEditor';
import { ProjectSidebar, type EntryAction } from './ProjectSidebar';
import { emptyView, errorText, useWorkspace } from './workspace';
import { AgentPanel } from './AgentPanel';

type Modal = { action: EntryAction | 'link' | 'connect'; id: string | null; text?: string };
const titles: Record<Modal['action'], string> = {
  folder: '新建文件夹',
  project: '新建项目',
  note: '新建笔记',
  rename: '重命名',
  move: '移动到',
  remove: '移除内容',
  promote: '作为项目开展',
  import: '导入本地文件',
  archive: '归档',
  link: '加入文件夹或项目',
  connect: '连接 Canvas',
};

type EditorGroupId = 'primary' | 'secondary';
type SplitOrientation = 'vertical' | 'horizontal';
type EditorGroup = { tabs: string[]; active: string | null };
type EditorLayout = {
  split: boolean;
  orientation: SplitOrientation;
  ratio: number;
  focus: EditorGroupId;
  groups: Record<EditorGroupId, EditorGroup>;
};

const editorLayoutKey = (scope: string) => `dela.editor.layout.${scope}`;
const MAX_EDITOR_TABS = 100;
// 拖拽中高频变化的偏好值延迟落盘，避免每次 pointermove 都同步写 localStorage。
const PERSIST_DEBOUNCE_MS = 300;
// A single editor group needs room for its document toolbar and readable body.
// This is a layout constraint only; the stored sidebar/assistant preferences remain intact.
const EDITOR_MIN_WIDTH = 320;
const EDITOR_MIN_HEIGHT = 240;
const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 240;
const AGENT_DEFAULT_WIDTH = 340;
const AGENT_MIN_WIDTH = 280;
/** ProjectDocument 以此格式生成 CodeMirror 会话键（viewId = `${scope}:${group}`）。 */
const documentSessionKey = (key: string, atScope: string, group: EditorGroupId) =>
  `document:${key}:${atScope}:${group}`;
/** NoteEditor 所见即所得会话键（前缀 note:，其余同上）。 */
const noteSessionKey = (key: string, atScope: string, group: EditorGroupId) =>
  `note:${key}:${atScope}:${group}`;

function defaultEditorLayout(
  scope: string,
  tabs: string[],
  savedActive: string | null,
): EditorLayout {
  const stored = (() => {
    try {
      const value = localStorage.getItem(editorLayoutKey(scope));
      return value ? (JSON.parse(value) as Partial<EditorLayout>) : null;
    } catch {
      return null;
    }
  })();
  const validTabs = Array.from(new Set(tabs)).slice(0, MAX_EDITOR_TABS);
  const clean = (group: Partial<EditorGroup> | undefined, fallback: string[]) => {
    const rawTabs = Array.isArray(group?.tabs) ? group.tabs : fallback;
    const groupTabs = Array.from(
      new Set(rawTabs.filter((key): key is string => typeof key === 'string' && Boolean(key))),
    );
    return {
      tabs: groupTabs,
      active:
        group?.active && groupTabs.includes(group.active)
          ? group.active
          : (groupTabs.at(-1) ?? null),
    };
  };
  const groups = {
    primary: clean(stored?.groups?.primary, validTabs),
    secondary: clean(stored?.groups?.secondary, []),
  } satisfies Record<EditorGroupId, EditorGroup>;
  const seen = new Set<string>();
  for (const group of [groups.primary, groups.secondary]) {
    group.tabs = group.tabs.filter((key) => {
      // 同一文档可以在两个编辑组各有一个标签；上限仍按文档去重计数。
      if (!seen.has(key) && seen.size >= MAX_EDITOR_TABS) return false;
      seen.add(key);
      return true;
    });
    if (group.active && !group.tabs.includes(group.active))
      group.active = group.tabs.at(-1) ?? null;
  }
  const orientation = stored?.orientation === 'horizontal' ? 'horizontal' : 'vertical';
  const ratio =
    typeof stored?.ratio === 'number' && Number.isFinite(stored.ratio)
      ? Math.min(0.8, Math.max(0.2, stored.ratio))
      : 0.5;
  const focus =
    stored?.focus === 'secondary' && groups.secondary.tabs.length ? 'secondary' : 'primary';
  // Older view state stored one flat active key. Keep it when the group data did not yet exist.
  if (!stored?.groups?.primary && savedActive && groups.primary.tabs.includes(savedActive)) {
    groups.primary.active = savedActive;
  }
  return {
    split: Boolean(stored?.split && groups.secondary.tabs.length),
    orientation,
    ratio,
    focus,
    groups,
  };
}

const layoutTabs = (layout: EditorLayout) =>
  Array.from(new Set([...layout.groups.primary.tabs, ...layout.groups.secondary.tabs]));

export function ProjectView({
  mode = 'project',
  projectId = null,
  onOpenProject,
  onOpenShuiyuanTopic,
  createRequested = false,
  onCreateHandled,
  chatRequest,
}: {
  mode?: 'project' | 'sources';
  projectId?: string | null;
  onOpenProject: (id: string) => void;
  onOpenShuiyuanTopic?: (topicId: number, postNumber?: number) => void;
  createRequested?: boolean;
  onCreateHandled?: () => void;
  chatRequest?: { sessionId: string };
}) {
  const workspace = useWorkspace((s) => s.workspace);
  const workspaceLoaded = useWorkspace((s) => s.loaded);
  const canvas = useWorkspace((s) => s.canvas);
  const globalError = useWorkspace((s) => s.error);
  const drafts = useWorkspace((s) => s.drafts);
  const rootId =
    mode === 'project' && workspace.entries.some((entry) => entry.id === projectId)
      ? projectId
      : null;
  const scope = mode === 'sources' ? 'sources' : (rootId ?? 'projects');
  const saved = workspace.views[scope] ?? emptyView;
  const root = workspace.entries.find((e) => e.id === rootId);
  const [selected, setSelected] = useState<string | null>(rootId);
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem('dela.workspace.sidebarWidth'));
    return Number.isFinite(stored) && stored > 0 ? stored : SIDEBAR_DEFAULT_WIDTH;
  });
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('dela.workspace.collapsed') === 'true',
  );
  const [resizing, setResizing] = useState(false);
  // 拖拽标签悬停的编辑组：给整组高亮，提示松手会移入该组。
  const [dragOverGroup, setDragOverGroup] = useState<EditorGroupId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bySource, setBySource] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(true);
  const [personalOpen, setPersonalOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [shellWidth, setShellWidth] = useState(0);
  // 助手栏与编辑器并排还是覆盖，以工作区壳实测宽度而非窗口宽度判定：
  // 主导航侧栏（200–360px）会占用窗口宽度，窗口 ≥1024 但壳不足时仍并排会把编辑器压穿 320px 最小宽。
  // 1024 与助手拖拽上限（壳宽 45%）共同保证并排时编辑器始终 ≥EDITOR_MIN_WIDTH。
  const agentInline = shellWidth >= 1024;
  // <md 目录是覆盖抽屉（由 mobileOpen 驱动），≥md 是可折叠列（由 collapsed 驱动）；
  // 标题栏的目录开关两种视口共用，需要按当前断点分流。
  const [explorerDrawer, setExplorerDrawer] = useState(
    () => window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setExplorerDrawer(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const shellRef = useRef<HTMLDivElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const [editorSize, setEditorSize] = useState({ width: 0, height: 0 });
  const [editorLayout, setEditorLayout] = useState<EditorLayout>(() =>
    defaultEditorLayout(scope, saved.tabs, saved.active),
  );
  const editorLayoutRef = useRef(editorLayout);
  const scopeRef = useRef(scope);
  const closeRequest = useRef(0);
  // 助手面板开关与宽度持久化：离开页面再回来不重置（草稿另由 dela.chat.drafts 保存）。
  const [agentOpen, setAgentOpen] = useState(
    () => localStorage.getItem('dela.workspace.agentOpen') === 'true',
  );
  const [agentWidth, setAgentWidth] = useState(() => {
    const stored = Number(localStorage.getItem('dela.workspace.agentWidth'));
    return Number.isFinite(stored) && stored > 0 ? stored : AGENT_DEFAULT_WIDTH;
  });
  const [modal, setModal] = useState<Modal | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const scrollPending = useRef<Record<string, number>>({});
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedGroup = editorLayout.focus;
  const activeKey = editorLayout.groups[focusedGroup].active;
  const allTabs = layoutTabs(editorLayout);
  const persistEditorLayout = (next: EditorLayout) => {
    editorLayoutRef.current = next;
    setEditorLayout(next);
    try {
      localStorage.setItem(editorLayoutKey(scope), JSON.stringify(next));
    } catch {
      // localStorage is optional; the in-memory layout remains usable.
    }
  };
  useEffect(() => {
    void useWorkspace.getState().load();
  }, []);
  useEffect(() => {
    const node = editorAreaRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setEditorSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // 激活的标签滚动到可见区（VSCode 行为）：标签栏溢出时新开/激活的标签落在视口外毫无反馈。
  const primaryActive = editorLayout.groups.primary.active;
  const secondaryActive = editorLayout.groups.secondary.active;
  useEffect(() => {
    for (const group of ['primary', 'secondary'] as const) {
      const key = editorLayoutRef.current.groups[group].active;
      if (!key) continue;
      const bar = shellRef.current?.querySelector(`[data-editor-tabs="${group}"]`);
      bar
        ?.querySelector(`[data-editor-tab="${key}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [primaryActive, secondaryActive]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('dela.workspace.sidebarWidth', String(width));
      } catch {
        // localStorage is optional; the in-memory value remains usable.
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [width]);
  useEffect(() => {
    try {
      localStorage.setItem('dela.workspace.collapsed', String(collapsed));
    } catch {
      // localStorage is optional; the in-memory value remains usable.
    }
  }, [collapsed]);
  useEffect(() => {
    try {
      localStorage.setItem('dela.workspace.agentOpen', String(agentOpen));
    } catch {
      // localStorage is optional; the in-memory value remains usable.
    }
  }, [agentOpen]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('dela.workspace.agentWidth', String(agentWidth));
      } catch {
        // localStorage is optional; the in-memory value remains usable.
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [agentWidth]);
  // 项目切换时重置选中项：渲染期调整（而非 effect），避免旧高亮多绘制一帧。
  const [prevRootId, setPrevRootId] = useState(rootId);
  if (prevRootId !== rootId) {
    setPrevRootId(rootId);
    setSelected(rootId);
  }
  useEffect(() => {
    if (createRequested) {
      show({ action: 'project', id: null });
      onCreateHandled?.();
    }
  }, [createRequested]);
  // chatRequest 是一次性脉冲：父组件每次请求须传新对象引用，复用同一对象不会再次触发。
  useEffect(() => {
    if (chatRequest) setAgentOpen(true);
  }, [chatRequest]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const reset = () => {
      if (media.matches) setMobileOpen(false);
    };
    media.addEventListener('change', reset);
    return () => media.removeEventListener('change', reset);
  }, []);
  useLayoutEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    // 挂载即同步测量一次，避免首帧按 0 宽布局（助手并排/覆盖判定随之闪变）；后续交给 ResizeObserver。
    setShellWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setShellWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  /* 不变量：workspace.views[scope].tabs 仅在 scope 首次进入（含冷启动 load 完成）时作为种子，
     之后 editorLayout 是唯一写方（syncView 单向推送），refresh 不回灌。 */
  // scope 切换在渲染期完成：effect 要到绘制后才跑，会让旧 scope 的标签闪现一帧。
  const [prevScope, setPrevScope] = useState(scope);
  if (prevScope !== scope) {
    setPrevScope(scope);
    if (workspaceLoaded) {
      const next = defaultEditorLayout(scope, saved.tabs, saved.active);
      editorLayoutRef.current = next;
      setEditorLayout(next);
    }
  }
  // 冷启动 load 完成后的种子；运行中的 scope 变化已由上方渲染期调整处理。
  useEffect(() => {
    if (workspaceLoaded) {
      const next = defaultEditorLayout(scope, saved.tabs, saved.active);
      editorLayoutRef.current = next;
      setEditorLayout(next);
    }
  }, [workspaceLoaded]);
  useEffect(() => {
    scopeRef.current = scope;
    closeRequest.current += 1;
  }, [scope]);
  // 折叠即完全隐藏（宽度归零），不保留图标栏；开关转移到编辑器标签栏左端。
  const effectiveSidebarWidth = collapsed
    ? 0
    : Math.min(
        width,
        Math.max(
          SIDEBAR_MIN_WIDTH,
          shellWidth - EDITOR_MIN_WIDTH - (agentOpen && agentInline ? agentWidth : 0),
        ),
      );
  const availableAgentWidth = Math.min(
    agentWidth,
    Math.max(AGENT_MIN_WIDTH, shellWidth - EDITOR_MIN_WIDTH - effectiveSidebarWidth),
  );
  const effectiveAgentWidth = agentOpen ? availableAgentWidth : 0;
  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      if (Object.keys(scrollPending.current).length) {
        const state = useWorkspace.getState();
        const view = state.workspace.views[scope] ?? emptyView;
        state.setView(scope, { ...view, scroll: { ...view.scroll, ...scrollPending.current } });
      }
      scrollPending.current = {};
    },
    [scope],
  );
  const updateView = (patch: Partial<typeof saved>) =>
    useWorkspace.getState().setView(scope, {
      ...(useWorkspace.getState().workspace.views[scope] ?? emptyView),
      ...patch,
    });
  const expand = (id: string, open: boolean) => {
    const expanded = useWorkspace.getState().workspace.views[scope]?.expanded ?? [];
    updateView({
      expanded: open ? [...new Set([...expanded, id])] : expanded.filter((value) => value !== id),
    });
  };
  const isDescendant = (id: string, ancestor: string): boolean => {
    let parent = workspace.entries.find((e) => e.id === id)?.parentId;
    while (parent) {
      if (parent === ancestor) return true;
      parent = workspace.entries.find((e) => e.id === parent)?.parentId;
    }
    return false;
  };
  const move = (dragId: string, targetId: string | null) => {
    const parentId = targetId ?? rootId;
    if (parentId === dragId || (parentId && isDescendant(parentId, dragId))) return;
    void run(async () => {
      await window.dela!.workspace.update(dragId, { parentId });
      await useWorkspace.getState().refresh();
      if (targetId) expand(targetId, true);
    });
  };
  const importDroppedFiles = (files: File[], targetId: string | null) => {
    void run(async () => {
      await window.dela!.workspace.importDroppedFiles(targetId ?? rootId, files);
      await useWorkspace.getState().refresh();
      if (targetId) expand(targetId, true);
    });
  };
  const collapseAll = () => updateView({ expanded: [] });
  const reveal = (id: string) => {
    const chain = [id];
    let parent = workspace.entries.find((e) => e.id === id)?.parentId;
    while (parent) {
      chain.unshift(parent);
      parent = workspace.entries.find((e) => e.id === parent)?.parentId;
    }
    const expanded = useWorkspace.getState().workspace.views[scope]?.expanded ?? [];
    updateView({ expanded: [...new Set([...expanded, ...chain])] });
    setSelected(id);
    setMobileOpen(false);
  };
  const syncView = (next: EditorLayout) => {
    const active = next.groups[next.focus].active;
    updateView({ tabs: layoutTabs(next), active });
  };
  const open = (key: string, group: EditorGroupId = focusedGroup) => {
    /* 与 closeTab 一致：从 ref 读布局、从 store 读草稿。submit 在 await 之后调用本函数时，
       渲染闭包里的 editorLayout/drafts 已过期，直接用会把旧布局写回去。 */
    const layout = editorLayoutRef.current;
    const current = layout.groups[group];
    const alreadyOpen = current.tabs.includes(key);
    const openEverywhere = layoutTabs(layout);
    if (!alreadyOpen && !openEverywhere.includes(key) && openEverywhere.length >= MAX_EDITOR_TABS) {
      useWorkspace.getState().setError(`最多打开 ${MAX_EDITOR_TABS} 个文档`);
      return;
    }
    const next: EditorLayout = {
      ...layout,
      split: layout.split || group === 'secondary',
      focus: group,
      groups: {
        ...layout.groups,
        [group]: {
          tabs: alreadyOpen ? current.tabs : [...current.tabs, key],
          active: key,
        },
      },
    };
    persistEditorLayout(next);
    syncView(next);
    setSelected(key);
    setMobileOpen(false);
  };
  /* ProjectDocument 在两编辑器组各持有独立 CodeMirror / 所见即所得会话；文档彻底关闭后
     连撤销历史一起清理，否则 sessions 表随开关标签无限增长。 */
  const forgetDocumentSessions = (key: string, atScope: string) => {
    for (const group of ['primary', 'secondary'] as const) {
      forgetMarkdownEditorState(documentSessionKey(key, atScope, group));
      forgetNoteEditorState(noteSessionKey(key, atScope, group));
    }
  };
  const closeTab = async (key: string, group: EditorGroupId = focusedGroup) => {
    const request = ++closeRequest.current;
    const closeScope = scope;
    const otherGroup = group === 'primary' ? 'secondary' : 'primary';
    const stillOpenElsewhere = editorLayoutRef.current.groups[otherGroup].tabs.includes(key);
    // 彻底关闭前先冲盘并释放草稿；保存失败则保留标签，脏草稿不能变得不可达。
    if (!stillOpenElsewhere && !(await useWorkspace.getState().release(key))) {
      // 后台脏标签保存失败时其文档不在 DOM，面板内错误无处显示，靠全局横幅告知。
      useWorkspace.getState().setError(`关闭「${title(key)}」前保存失败，请先打开处理未保存的修改`);
      return;
    }
    if (request !== closeRequest.current || closeScope !== scopeRef.current) return;
    const currentLayout = editorLayoutRef.current;
    const currentGroup = currentLayout.groups[group];
    const index = currentGroup.tabs.indexOf(key);
    if (index < 0) return;
    const tabs = currentGroup.tabs.filter((id) => id !== key);
    const active =
      currentGroup.active === key ? (tabs[index] ?? tabs[index - 1] ?? null) : currentGroup.active;
    const removed: EditorLayout = {
      ...currentLayout,
      groups: {
        ...currentLayout.groups,
        [group]: {
          tabs,
          active,
        },
      },
      focus: currentLayout.focus === group ? group : currentLayout.focus,
    };
    // 副编辑器组最后一个标签关闭时收起分栏（VSCode 行为），焦点回到主组。
    const next =
      removed.split && removed.groups.secondary.tabs.length === 0
        ? { ...removed, split: false, focus: 'primary' as EditorGroupId }
        : removed;
    persistEditorLayout(next);
    syncView(next);
    const fullyClosed =
      !next.groups.primary.tabs.includes(key) && !next.groups.secondary.tabs.includes(key);
    if (fullyClosed) {
      // 仅剩这一组时已在上面前置 release；两组都开着时此刻才释放。
      if (stillOpenElsewhere) void useWorkspace.getState().release(key);
      forgetDocumentSessions(key, closeScope);
    }
  };
  /** 批量关闭（标签右键菜单）：others=除当前外全部，right=当前右侧，all=整组。 */
  const closeTabs = async (key: string, group: EditorGroupId, mode: 'others' | 'right' | 'all') => {
    const tabs = editorLayoutRef.current.groups[group].tabs;
    const index = tabs.indexOf(key);
    if (index < 0) return;
    const victims =
      mode === 'all'
        ? [...tabs]
        : mode === 'others'
          ? tabs.filter((tab) => tab !== key)
          : tabs.slice(index + 1);
    for (const victim of victims) await closeTab(victim, group);
  };
  const focusGroup = (group: EditorGroupId) => {
    if (group === editorLayout.focus) return;
    if (group === 'secondary' && !editorLayout.split) return;
    const next = { ...editorLayout, focus: group };
    persistEditorLayout(next);
    syncView(next);
  };
  const toggleSplit = (orientation?: SplitOrientation) => {
    if (editorLayout.split && !orientation) {
      // 合并时分栏的标签并入主组，避免留下任何界面都看不到的“幽灵”标签。
      const primary = editorLayout.groups.primary;
      const secondary = editorLayout.groups.secondary;
      const focused = editorLayout.groups[focusedGroup];
      const other = focusedGroup === 'primary' ? secondary : primary;
      const next: EditorLayout = {
        ...editorLayout,
        split: false,
        focus: 'primary',
        groups: {
          ...editorLayout.groups,
          primary: {
            tabs: Array.from(new Set([...primary.tabs, ...secondary.tabs])),
            active: focused.active ?? other.active,
          },
          secondary: { tabs: [], active: null },
        },
      };
      persistEditorLayout(next);
      syncView(next);
      return;
    }
    const active = editorLayout.groups[focusedGroup].active;
    const secondary = editorLayout.groups.secondary;
    const next = {
      ...editorLayout,
      split: true,
      orientation: orientation ?? editorLayout.orientation,
      focus: editorLayout.split ? focusedGroup : ('secondary' as EditorGroupId),
      groups: {
        ...editorLayout.groups,
        secondary: {
          tabs: secondary.tabs.length ? secondary.tabs : active ? [active] : [],
          active: secondary.active ?? active ?? null,
        },
      },
    };
    persistEditorLayout(next);
    syncView(next);
  };
  const moveTab = (key: string, from: EditorGroupId, to: EditorGroupId, targetIndex?: number) => {
    const source = editorLayout.groups[from];
    if (!source.tabs.includes(key)) return;
    const sourceTabs = source.tabs.filter((id) => id !== key);
    const destination = editorLayout.groups[to];
    const destinationTabs = destination.tabs.filter((id) => id !== key);
    const index = Math.max(
      0,
      Math.min(targetIndex ?? destinationTabs.length, destinationTabs.length),
    );
    destinationTabs.splice(index, 0, key);
    const next: EditorLayout = {
      ...editorLayout,
      split: editorLayout.split || to === 'secondary',
      focus: to,
      groups: {
        ...editorLayout.groups,
        // from===to 时该键覆盖上面的值。
        [from]: {
          tabs: sourceTabs,
          active: source.active === key ? (sourceTabs.at(-1) ?? null) : source.active,
        },
        [to]: {
          tabs: destinationTabs,
          active: key,
        },
      },
    };
    persistEditorLayout(next);
    syncView(next);
  };
  /** 解析编辑器标签拖拽负载并移动标签；数据缺失或来自无关拖拽源时静默忽略。 */
  const dropEditorTab = (event: DragEvent, group: EditorGroupId, targetIndex: number) => {
    const raw = event.dataTransfer.getData('application/x-dela-editor-tab');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as { key?: string; group?: EditorGroupId };
      if (!payload.key || (payload.group !== 'primary' && payload.group !== 'secondary')) return;
      moveTab(payload.key, payload.group, group, targetIndex);
    } catch {
      // Ignore data from unrelated drag sources.
    }
  };
  const title = (key: string) =>
    workspace.entries.find((e) => e.id === key)?.name ??
    canvas.items.find((i) => `source:${i.sourceId}` === key)?.name ??
    drafts[key]?.content.title ??
    '资料';
  const currentContainer = () => {
    const entry = workspace.entries.find((e) => e.id === (selected ?? activeKey));
    return entry
      ? entry.kind === 'folder' || entry.kind === 'project'
        ? entry.id
        : entry.parentId
      : rootId;
  };
  function show(value: Modal) {
    setName(
      value.action === 'rename'
        ? (workspace.entries.find((e) => e.id === value.id)?.name ?? '')
        : '',
    );
    setTarget(currentContainer() ?? '');
    setModalError(null);
    setModal(value);
  }
  const run = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      useWorkspace.getState().setError(error);
    }
  };
  const action = (type: EntryAction, id: string | null) => {
    if (type === 'archive' && id) {
      void run(async () => {
        await window.dela!.workspace.update(id, { parentId: workspaceArchiveId });
        await useWorkspace.getState().refresh();
        expand(workspaceArchiveId, true);
      });
    } else if (type === 'promote' && id) {
      void run(async () => {
        await window.dela!.workspace.update(id, { kind: 'project' });
        await useWorkspace.getState().refresh();
        onOpenProject(id);
      });
    } else if (type === 'import')
      void run(async () => {
        await window.dela!.workspace.importFiles(id);
        await useWorkspace.getState().refresh();
      });
    else show({ action: type, id });
  };
  const selectEntry = (id: string) => {
    const item = workspace.entries.find((e) => e.id === id);
    if (!item) return;
    if (item.kind === 'project') {
      onOpenProject(id);
      setMobileOpen(false);
    } else if (item.kind === 'folder') {
      setSelected(id);
      expand(id, !saved.expanded.includes(id));
    } else open(id);
  };
  const openToSide = (id: string) => {
    const item = workspace.entries.find((entry) => entry.id === id);
    if (!item || item.kind === 'folder') {
      selectEntry(id);
      return;
    }
    if (item.kind === 'project') {
      onOpenProject(id);
      return;
    }
    open(id, 'secondary');
  };
  const newNote = (text: string) => {
    const sourceId = activeKey?.startsWith('source:')
      ? activeKey.slice(7)
      : workspace.entries.find((e) => e.id === activeKey)?.sourceId;
    const source = sourceId ? canvas.items.find((i) => i.sourceId === sourceId) : null;
    const originalUrl = activeKey ? drafts[activeKey]?.content.url : undefined;
    const header = source
      ? `来源：${originalUrl ? `[${source.name}](${originalUrl})` : source.name}\n\n`
      : '';
    show({
      action: 'note',
      id: currentContainer(),
      text: text || header,
    });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!modal || !window.dela) return;
    setBusy(true);
    setModalError(null);
    try {
      const api = window.dela.workspace;
      let created: WorkspaceEntry | undefined;
      if (modal.action === 'connect') {
        await window.dela.canvas.configure(name);
        setName('');
        useWorkspace.getState().setCanvas(await window.dela.canvas.syncCourses());
      } else if (modal.action === 'rename') await api.update(modal.id!, { name });
      else if (modal.action === 'move') await api.update(modal.id!, { parentId: target || null });
      else if (modal.action === 'remove') {
        await api.remove(modal.id!);
        const remaining = (await api.getState()).entries;
        const live = new Set(remaining.map((e) => e.id));
        const keep = (key: string) => key.startsWith('source:') || live.has(key);
        const group = (current: EditorGroup): EditorGroup => {
          const tabs = current.tabs.filter(keep);
          return {
            tabs,
            active: current.active && keep(current.active) ? current.active : (tabs.at(-1) ?? null),
          };
        };
        const removedLayout = editorLayoutRef.current;
        const dropped = layoutTabs(removedLayout).filter((key) => !keep(key));
        const next = {
          ...removedLayout,
          groups: {
            primary: group(removedLayout.groups.primary),
            secondary: group(removedLayout.groups.secondary),
          },
        };
        persistEditorLayout(next);
        syncView(next);
        for (const key of dropped) {
          void useWorkspace.getState().release(key);
          forgetDocumentSessions(key, scope);
        }
        if (rootId && !live.has(rootId)) onOpenProject('');
      } else if (modal.action === 'link') {
        const sourceId = modal.id!.startsWith('source:')
          ? modal.id!.slice(7)
          : workspace.entries.find((e) => e.id === modal.id)?.sourceId;
        if (!sourceId) throw new Error('请选择来源资料');
        let parentId = target || null;
        if (target === '__new__')
          parentId = (await api.create({ name, parentId: null, kind: 'project' })).id;
        created = await api.create({ name: title(modal.id!), parentId, kind: 'source', sourceId });
      } else if (modal.action === 'folder' || modal.action === 'project' || modal.action === 'note')
        created = await api.create({
          name,
          parentId: modal.id,
          kind: modal.action,
          text: modal.text,
        });
      await useWorkspace.getState().refresh();
      setModal(null);
      if (created) {
        if (created.parentId) expand(created.parentId, true);
        if (created.kind === 'project') onOpenProject(created.id);
        else if (created.kind === 'note') open(created.id, focusedGroup);
        else if (created.kind === 'folder') {
          setSelected(created.id);
          updateView({ active: null });
          expand(created.id, true);
        }
      }
    } catch (error) {
      setModalError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const viewScrollKey = (group: EditorGroupId, key: string) => `${group}:${key}`;
  const recordScroll = (key: string, top: number) => {
    scrollPending.current[key] = top;
    if (!scrollTimer.current)
      scrollTimer.current = setTimeout(() => {
        const state = useWorkspace.getState();
        const view = state.workspace.views[scope] ?? emptyView;
        state.setView(scope, { ...view, scroll: { ...view.scroll, ...scrollPending.current } });
        scrollPending.current = {};
        scrollTimer.current = null;
      }, 300);
  };
  const pathName = (entry: WorkspaceEntry): string => {
    const names = [entry.name];
    let parent = workspace.entries.find((e) => e.id === entry.parentId);
    while (parent) {
      names.unshift(parent.name);
      parent = workspace.entries.find((e) => e.id === parent!.parentId);
    }
    return names.join(' / ');
  };
  const refreshCourses = () => {
    if (syncing || !canvas.connected) return;
    setSyncing(true);
    void run(async () => {
      const { setCanvas } = useWorkspace.getState();
      // 先刷新课程列表，否则新学期的课程拿不到；再逐门同步最新学期（顺序执行，避免并发轰炸 Canvas）。
      // 已归档课程不参与刷新：其令牌往往已失效，同步只会反复报错。
      await setCanvas(await window.dela!.canvas.syncCourses());
      const courses = useWorkspace.getState().canvas.courses;
      const latest = latestTermOf(courses);
      for (const course of courses)
        if (course.term === latest && !course.archived)
          await setCanvas(await window.dela!.canvas.syncCourse(course.id));
    }).finally(() => setSyncing(false));
  };
  const renderDocument = (key: string, group: EditorGroupId) => {
    const scrollKey = viewScrollKey(group, key);
    return (
      <ProjectDocument
        key={`${group}:${key}`}
        documentKey={key}
        viewId={`${scope}:${group}`}
        scroll={
          // 仅挂载时消费一次、非响应式：pending 值优先于已落盘滚动位置，其后经 recordScroll 异步落盘。
          scrollPending.current[scrollKey] ??
          saved.scroll[scrollKey] ??
          (group === 'primary' ? saved.scroll[key] : 0) ??
          0
        }
        onScroll={(top) => recordScroll(scrollKey, top)}
        onReveal={reveal}
        onLinkSource={(id) => show({ action: 'link', id })}
        onNewNote={newNote}
        onOpenSource={open}
        onOpenShuiyuanTopic={onOpenShuiyuanTopic}
        onOpenEntry={(id) => open(id, group)}
      />
    );
  };
  const renderTabs = (group: EditorGroupId) => {
    const state = editorLayout.groups[group];
    return (
      // 标签带与目录列同为 bg-muted 的 chrome 区；活动标签以白色圆角浮起并融入下方页面（Chrome 式）。
      <div className="flex h-10 min-w-0 shrink-0 bg-muted px-2 pt-1">
        {group === 'primary' && (
          <>
            <Button
              className="my-auto hover:bg-foreground/10 md:hidden"
              size="icon-sm"
              variant="ghost"
              aria-label="打开目录"
              onClick={() => setMobileOpen(true)}
            >
              <Folder />
            </Button>
            {/* 目录折叠（面板整体隐藏）后，展开开关转移到标签栏左端：宽度/透明度随收展动画过渡。
                标签栏自身 px-2 已使按钮与侧栏头开关同处 x=8px，收展切换原地淡入淡出、位置不动。
                移动端抽屉开关由上方 Folder 按钮负责。 */}
            <PanelToggleButton
              collapsed={collapsed}
              controlsId="workspace-explorer"
              label="目录"
              className={cn(
                'my-auto hidden overflow-hidden transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none md:grid md:hover:bg-foreground/10',
                collapsed ? 'md:opacity-100' : 'md:pointer-events-none md:w-0 md:opacity-0',
              )}
              onToggle={() => (mobileOpen ? setMobileOpen(false) : setCollapsed(false))}
            />
          </>
        )}
        <div
          role="tablist"
          aria-label={`${group === 'primary' ? '主' : '分栏'}编辑器标签页`}
          data-editor-tabs={group}
          className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none]"
          onWheel={(event) => {
            // 纵向滚轮在标签栏内转为横向滚动（VSCode 行为），触控板横向滚动原生支持。
            if (event.deltaY !== 0) event.currentTarget.scrollLeft += event.deltaY;
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-dela-editor-tab')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            // 已由行内落点处理时不再冒泡给编辑组（落正文 = 追加到组尾）。
            event.stopPropagation();
            const target = (event.target as HTMLElement).closest('[data-editor-tab]');
            const index = target
              ? Array.from(event.currentTarget.querySelectorAll('[data-editor-tab]')).indexOf(
                  target,
                )
              : state.tabs.length;
            dropEditorTab(event, group, index);
          }}
          onDoubleClick={(event) => {
            if (event.target === event.currentTarget) newNote('');
          }}
        >
          {state.tabs.map((key) => {
            const dirty = Boolean(drafts[key] && drafts[key].text !== drafts[key].saved);
            const active = state.active === key;
            // 分屏时非焦点组的标签降不透明度，让「下一个文件会开进哪组」可预判（VSCode 行为）。
            const unfocused = editorLayout.split && editorLayout.focus !== group;
            return (
              <ContextMenu key={key}>
                <ContextMenuTrigger asChild>
                  <div
                    data-editor-tab={key}
                    draggable
                    className={cn(
                      'group/tab flex h-8 max-w-56 shrink-0 items-center rounded-t-lg px-1.5',
                      active
                        ? 'bg-background shadow-xs'
                        : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                    )}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData(
                        'application/x-dela-editor-tab',
                        JSON.stringify({ key, group }),
                      );
                    }}
                    onAuxClick={(event) => {
                      if (event.button === 1) {
                        event.preventDefault();
                        void closeTab(key, group);
                      }
                    }}
                  >
                    <button
                      role="tab"
                      aria-selected={active}
                      className={cn(
                        'min-w-0 flex-1 truncate px-1 text-left text-xs',
                        unfocused && 'opacity-55',
                      )}
                      title={title(key)}
                      onClick={() => open(key, group)}
                    >
                      {title(key)}
                    </button>
                    <button
                      className="relative grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground after:absolute after:-inset-1 after:content-['']"
                      aria-label={`关闭 ${title(key)}`}
                      title={dirty ? '关闭（将先保存修改）' : '关闭'}
                      onClick={() => void closeTab(key, group)}
                    >
                      {dirty ? (
                        <span
                          className="size-2 rounded-full bg-foreground group-hover/tab:hidden"
                          aria-hidden
                        />
                      ) : null}
                      <X
                        className={cn('size-3', dirty ? 'hidden group-hover/tab:block' : 'block')}
                      />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => open(key, group === 'primary' ? 'secondary' : 'primary')}
                  >
                    在另一栏打开
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => void closeTab(key, group)}>关闭</ContextMenuItem>
                  <ContextMenuItem onSelect={() => void closeTabs(key, group, 'others')}>
                    关闭其他
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => void closeTabs(key, group, 'right')}>
                    关闭右侧
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => void closeTabs(key, group, 'all')}>
                    关闭全部
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {!state.tabs.length && (
            <span className="self-center px-3 text-xs text-muted-foreground">未打开文件</span>
          )}
        </div>
        {/* 新建入口与标签同排（Chrome 的 + ）：与双击标签栏空白处新建等价。
            放在 tablist 外，避免 role=tablist 混入非 tab 元素。 */}
        <Button
          size="icon-xs"
          variant="ghost"
          className="self-end text-muted-foreground hover:bg-foreground/10"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={() => newNote('')}
        >
          <Plus />
        </Button>
      </div>
    );
  };
  const renderGroup = (group: EditorGroupId) => {
    const state = editorLayout.groups[group];
    // 落点接收编辑器标签拖拽：正文区松手 = 移入该组末尾（VSCode 行为），不只依赖 40px 标签栏。
    const dropProps = {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes('application/x-dela-editor-tab')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDragOverGroup(group);
      },
      onDragLeave: (event: DragEvent) => {
        // 标签栏 → 正文属于组内移动，只有离开整组才清除高亮。
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragOverGroup(null);
      },
      onDrop: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes('application/x-dela-editor-tab')) return;
        event.preventDefault();
        setDragOverGroup(null);
        if (event.defaultPrevented) return;
        dropEditorTab(event, group, state.tabs.length);
      },
    };
    return (
      <section
        key={group}
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          dragOverGroup === group && 'ring-1 ring-inset ring-border bg-accent/30',
        )}
        style={{
          flexBasis: editorLayout.split ? `${editorLayout.ratio * 100}%` : undefined,
          // 编辑区容不下两组 EDITOR_MIN_* 时用 splitMinimum 同步放宽，避免副组被裁切。
          minWidth:
            editorLayout.split && editorLayout.orientation === 'vertical'
              ? splitMinimum
              : undefined,
          minHeight:
            editorLayout.split && editorLayout.orientation === 'horizontal'
              ? splitMinimum
              : undefined,
        }}
        aria-label={`${group === 'primary' ? '主' : '分栏'}编辑器`}
        onPointerDown={() => focusGroup(group)}
        {...dropProps}
      >
        {renderTabs(group)}
        {state.active ? (
          renderDocument(state.active, group)
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            <FilePlus2 className="size-7 opacity-45" />
            <p>从左侧目录打开文件</p>
            <p className="text-xs opacity-75">拖动标签页可调整顺序或移动到另一栏</p>
            {/* 目录折叠/收起时空态给出直达入口，避免「从左侧目录打开」成为死胡同。
                窄屏抽屉与宽屏折叠列的开启路径不同，按断点分流。 */}
            {collapsed && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => {
                  if (explorerDrawer) setMobileOpen(true);
                  else setCollapsed(false);
                }}
              >
                打开目录
              </Button>
            )}
          </div>
        )}
      </section>
    );
  };
  const splitDimension =
    editorLayout.orientation === 'vertical' ? editorSize.width : editorSize.height;
  const splitMinimum = Math.min(
    editorLayout.orientation === 'vertical' ? EDITOR_MIN_WIDTH : EDITOR_MIN_HEIGHT,
    Math.max(1, splitDimension / 2),
  );
  const splitMaximum = Math.max(splitMinimum, splitDimension - splitMinimum);
  const splitValue = Math.min(
    splitMaximum,
    Math.max(splitMinimum, splitDimension * editorLayout.ratio),
  );
  const setSplitValue = (value: number) => {
    if (splitDimension <= 0) return;
    const minimumRatio = splitMinimum / splitDimension;
    const maximumRatio = 1 - minimumRatio;
    persistEditorLayout({
      ...editorLayout,
      ratio: Math.min(maximumRatio, Math.max(minimumRatio, value / splitDimension)),
    });
  };
  const handleWorkspaceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('[role="dialog"], input, textarea')) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    if (event.key === '\\') {
      event.preventDefault();
      toggleSplit();
    } else if (event.altKey && (event.key === '1' || event.key === '2')) {
      // Ctrl/Cmd+数字已被全局视图导航占用，编辑器组沿用 Alt 修饰。
      event.preventDefault();
      focusGroup(event.key === '1' ? 'primary' : 'secondary');
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      const group = editorLayout.groups[focusedGroup];
      if (group.tabs.length < 2) return;
      event.preventDefault();
      const current = Math.max(0, group.tabs.indexOf(group.active ?? group.tabs[0]!));
      const offset = event.key === 'PageDown' ? 1 : -1;
      open(group.tabs[(current + offset + group.tabs.length) % group.tabs.length]!, focusedGroup);
    } else if (event.key.toLowerCase() === 'b') {
      // Ctrl/Cmd+B 切换目录栏（VS Code 同款）。编辑器内该键是加粗，让位。
      if (target?.closest('.cm-editor, [contenteditable="true"]')) return;
      event.preventDefault();
      if (mobileOpen) setMobileOpen(false);
      else setCollapsed((value) => !value);
    } else if (event.key.toLowerCase() === 'w' && activeKey) {
      event.preventDefault();
      void closeTab(activeKey, focusedGroup);
    }
  };
  // 目录开关（侧栏头）的展开态按当前视口语义取值（<md 抽屉、≥md 折叠列）。
  const explorerExpanded = explorerDrawer ? mobileOpen : !collapsed;
  if (!window.dela)
    return (
      <DesktopOnlyNotice
        title="资料与项目"
        description="请在桌面应用中连接 Canvas、整理资料和编辑笔记。"
      />
    );
  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      onKeyDown={handleWorkspaceKeyDown}
      className="relative flex min-h-0 flex-1 overflow-hidden bg-background"
    >
      {mobileOpen && (
        <button
          aria-label="关闭目录"
          className="absolute inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        inert={collapsed && !mobileOpen}
        className={cn(
          // 与标签带同为 bg-muted 的 chrome 区，与白色页面之间靠色差分隔，不再画边框线。
          'flex min-h-0 shrink-0 flex-col overflow-hidden bg-muted transition-[width] duration-150 ease-out motion-reduce:transition-none max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:!w-[280px] max-md:max-w-[85vw] max-md:bg-background max-md:shadow-xl',
          resizing && 'transition-none',
          !mobileOpen && 'max-md:hidden',
        )}
        style={{ width: effectiveSidebarWidth }}
      >
        <div
          className={cn(
            // 壳动内容不动：折叠动画中内容保持展开宽度、被外壳裁切并淡出，
            // 不跟随宽度挤压 reflow（挤压会产生文字残影等破碎中间帧）。
            'flex min-h-0 flex-1 flex-col transition-opacity duration-150 motion-reduce:transition-none max-md:!w-full',
            collapsed && !mobileOpen && 'opacity-0',
          )}
          style={{ width: collapsed ? width : effectiveSidebarWidth }}
        >
          <div className="flex h-10 shrink-0 items-center gap-1 px-2">
            {/* 目录开关常驻侧栏头第一格（tree view 上方）；折叠后随面板整体隐藏，
                展开入口由标签栏左端的折叠态开关接管（见 renderTabs）。 */}
            <button
              aria-controls="workspace-explorer"
              aria-expanded={explorerExpanded}
              aria-label={explorerExpanded ? '收起目录' : '展开目录'}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              onClick={() => {
                if (explorerDrawer) setMobileOpen(false);
                else setCollapsed((value) => !value);
              }}
              title={explorerExpanded ? '收起目录' : '展开目录'}
              type="button"
            >
              <PanelLeft className="size-3.5" strokeWidth={1.8} />
            </button>
            <button
              className={cn(
                'min-w-0 flex-1 truncate text-left text-xs font-medium text-muted-foreground hover:text-foreground',
                collapsed && !mobileOpen && 'invisible',
              )}
              onClick={() => {
                setSelected(rootId);
                updateView({ active: null });
              }}
            >
              {mode === 'sources' ? '资料' : (root?.name ?? '项目与文件夹')}
            </button>
            <div
              className={cn(
                'flex shrink-0 items-center gap-0.5',
                collapsed && !mobileOpen && 'invisible',
              )}
            >
              {mode === 'project' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="hover:bg-foreground/10"
                      aria-label="新建"
                      title="新建"
                    >
                      <Plus />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => action('note', currentContainer())}>
                      <FilePlus2 />
                      新建笔记
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => action('folder', currentContainer())}>
                      <FolderPlus />
                      新建文件夹
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => action('import', currentContainer())}>
                      <FolderInput />
                      导入本地文件
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <HeaderAction label="全部收起" onClick={collapseAll}>
                <ChevronsDownUp />
              </HeaderAction>
            </div>
          </div>
          <div
            id="workspace-explorer"
            className={cn('flex min-h-0 flex-1 flex-col', collapsed && !mobileOpen && 'invisible')}
          >
            <div className="relative mx-2 mb-1">
              <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
              <Input
                className="h-8 rounded-lg border-0 bg-background pl-7 text-xs shadow-xs dark:bg-background"
                aria-label="筛选已同步内容"
                placeholder="筛选已同步内容…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              onDoubleClick={(event) => {
                if (event.target === event.currentTarget) action('note', currentContainer());
              }}
              onDragOver={(event) => {
                if (mode === 'project' && event.dataTransfer.types.includes('Files')) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  return;
                }
                if (event.target !== event.currentTarget) return;
                if (!event.dataTransfer.types.includes(explorerDragType)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                if (mode === 'project' && event.dataTransfer.types.includes('Files')) {
                  if (event.defaultPrevented) return;
                  event.preventDefault();
                  importDroppedFiles(Array.from(event.dataTransfer.files), null);
                  return;
                }
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                const drag = event.dataTransfer.getData(explorerDragType);
                if (drag) move(drag, null);
              }}
            >
              {mode === 'sources' && (
                <>
                  <div className="flex h-8 items-center gap-1 px-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                      aria-expanded={coursesOpen || Boolean(query.trim())}
                      onClick={() => setCoursesOpen((value) => !value)}
                    >
                      <ChevronRight
                        className={cn('size-3', (coursesOpen || query.trim()) && 'rotate-90')}
                      />
                      <GraduationCap className="size-4" />
                      课程资料
                    </button>
                    <HeaderAction label="刷新课程资料" onClick={refreshCourses}>
                      <RefreshCw className={cn(syncing && 'animate-spin')} />
                    </HeaderAction>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="hover:bg-foreground/10"
                          aria-label="Canvas 操作"
                          title="Canvas 操作"
                        >
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => show({ action: 'connect', id: null })}>
                          <KeyRound />
                          {canvas.connected ? '更换 Canvas 令牌' : '连接 Canvas'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setBySource((value) => !value);
                            if (!bySource) expand('canvas', true);
                          }}
                        >
                          <Folder />
                          {bySource ? '按课程分组' : '按来源分组'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {!canvas.connected && (
                    <div className="px-4 py-3 text-xs text-muted-foreground">
                      <p>连接 Canvas，查看课程资料。</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        onClick={() => show({ action: 'connect', id: null })}
                      >
                        连接 Canvas
                      </Button>
                    </div>
                  )}

                  {(coursesOpen || query.trim()) && (
                    <SourceList
                      expanded={saved.expanded}
                      onExpand={expand}
                      onOpen={open}
                      onOpenToSide={(key) => open(key, 'secondary')}
                      onLink={(id) => show({ action: 'link', id })}
                      selected={activeKey}
                      query={query}
                      bySource={bySource}
                      onArchive={() => setArchiveOpen(true)}
                    />
                  )}
                  <div className="mt-3 flex h-8 items-center gap-1 px-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                      aria-expanded={personalOpen || Boolean(query.trim())}
                      onClick={() => setPersonalOpen((value) => !value)}
                    >
                      <ChevronRight
                        className={cn('size-3', (personalOpen || query.trim()) && 'rotate-90')}
                      />
                      <Folder className="size-4" />
                      我的资料
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="hover:bg-foreground/10"
                          aria-label="添加我的资料"
                          title="添加我的资料"
                        >
                          <Plus />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => action('note', null)}>
                          <FilePlus2 />
                          新建笔记
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => action('folder', null)}>
                          <FolderPlus />
                          新建文件夹
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => action('import', null)}>
                          <FolderInput />
                          导入本地文件
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              )}
              {(mode !== 'sources' || personalOpen || query.trim()) && (
                <ProjectSidebar
                  entries={workspace.entries}
                  rootId={rootId}
                  selected={activeKey ?? selected}
                  expanded={saved.expanded}
                  onExpand={expand}
                  onSelect={selectEntry}
                  onAction={action}
                  onMove={move}
                  canDrop={(dragId, targetId) => !isDescendant(targetId, dragId)}
                  onImportFiles={mode === 'project' ? importDroppedFiles : undefined}
                  onOpenToSide={openToSide}
                  query={query}
                  excludeIds={mode === 'sources' ? [workspaceArchiveId] : []}
                />
              )}
              {mode === 'sources' && (
                <>
                  <button
                    type="button"
                    className="mt-3 flex h-8 w-full px-3 items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                    aria-expanded={archiveOpen || Boolean(query.trim())}
                    onClick={() => setArchiveOpen((value) => !value)}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3 transition-transform duration-150 motion-reduce:transition-none',
                        (archiveOpen || query.trim()) && 'rotate-90',
                      )}
                    />
                    <Archive className="size-4" />
                    归档
                  </button>
                  {(archiveOpen || query.trim()) && (
                    <>
                      <SourceList
                        archived
                        expanded={saved.expanded}
                        onExpand={expand}
                        onOpen={open}
                        onOpenToSide={(key) => open(key, 'secondary')}
                        onLink={(id) => show({ action: 'link', id })}
                        selected={activeKey}
                        query={query}
                        bySource={bySource}
                      />
                      <ProjectSidebar
                        entries={workspace.entries}
                        rootId={workspaceArchiveId}
                        selected={activeKey ?? selected}
                        expanded={saved.expanded}
                        onExpand={expand}
                        onSelect={selectEntry}
                        onAction={action}
                        onMove={move}
                        canDrop={(dragId, targetId) => !isDescendant(targetId, dragId)}
                        onOpenToSide={openToSide}
                        query={query}
                        archived
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </aside>
      {!collapsed && (
        <Resizer
          className="max-md:hidden"
          label="调整目录宽度"
          min={SIDEBAR_MIN_WIDTH}
          max={420}
          defaultValue={SIDEBAR_DEFAULT_WIDTH}
          value={width}
          onChange={setWidth}
          onResizingChange={setResizing}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {globalError && (
          <div
            role="alert"
            className="flex items-start gap-2 border-b px-4 py-2 text-xs text-destructive"
          >
            <span className="min-w-0 flex-1 break-words">{globalError}</span>
            <button
              aria-label="关闭错误提示"
              onClick={() => useWorkspace.getState().setError(null)}
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        <div
          ref={editorAreaRef}
          className={cn(
            'flex min-h-0 min-w-0 flex-1 overflow-hidden',
            editorLayout.orientation === 'vertical' ? 'flex-row' : 'flex-col',
          )}
        >
          {renderGroup('primary')}
          {editorLayout.split && (
            <Resizer
              label="调整编辑器分栏比例"
              orientation={editorLayout.orientation}
              value={splitValue}
              min={splitMinimum}
              max={splitMaximum}
              defaultValue={splitDimension / 2}
              onChange={setSplitValue}
              className={cn(
                // 两个白色页面相邻，保留一条淡线作分界（灰白相邻处则不画线）。
                'bg-border/60',
                editorLayout.orientation === 'vertical' ? 'w-px' : 'h-px',
              )}
            />
          )}
          {editorLayout.split && (
            <div
              className="flex min-h-0 min-w-0 flex-1"
              style={{ flexBasis: `${(1 - editorLayout.ratio) * 100}%` }}
            >
              {renderGroup('secondary')}
            </div>
          )}
        </div>
      </div>
      {agentOpen && (
        <Resizer
          className={agentInline ? undefined : 'hidden'}
          label="调整助手宽度"
          min={AGENT_MIN_WIDTH}
          max={Math.min(520, Math.max(AGENT_MIN_WIDTH, shellWidth * 0.45))}
          defaultValue={AGENT_DEFAULT_WIDTH}
          direction={-1}
          value={agentWidth}
          onChange={setAgentWidth}
          onResizingChange={setResizing}
        />
      )}
      <div
        inert={!agentOpen}
        aria-hidden={!agentOpen}
        className={cn(
          'flex min-h-0 shrink-0 overflow-hidden transition-[width] duration-150 ease-out motion-reduce:transition-none',
          resizing && 'transition-none',
          // 壳宽不足以并排时助手覆盖在编辑区上（全宽遮罩），覆盖/并排与宽度扣减共用 agentInline 判定。
          !agentInline && 'absolute inset-y-0 right-0 z-40 bg-background',
          !agentInline && (agentOpen ? '!w-full' : '!w-0'),
        )}
        style={{ width: effectiveAgentWidth }}
      >
        <div
          className={cn('flex min-h-0 shrink-0', !agentInline && '!w-full')}
          style={{ width: availableAgentWidth }}
        >
          <AgentPanel
            scope={scope}
            tabs={allTabs}
            chatRequest={chatRequest}
            onSaveNote={(text) => show({ action: 'note', id: currentContainer(), text })}
            onOpen={(key) => open(key, focusedGroup)}
          />
        </div>
      </div>
      {/* 编辑器布局与助手开关收纳在标题栏右侧（参照 VS Code）；目录开关在侧栏头第一格
          （折叠态转移到标签栏左端，见 renderTabs），贴近它所控制的面板。 */}
      <TitleBarPortal>
        <div
          className="flex h-full items-center gap-1 pr-1.5"
          role="toolbar"
          aria-label="工作区布局"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`编辑器布局：${!editorLayout.split ? '单栏' : editorLayout.orientation === 'vertical' ? '左右分栏' : '上下分栏'}`}
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
                  editorLayout.split && 'bg-sidebar-accent text-foreground',
                )}
                title="编辑器布局（Ctrl+\ 切换分栏）"
                type="button"
              >
                {!editorLayout.split ? (
                  <Square className="size-4" strokeWidth={1.8} />
                ) : editorLayout.orientation === 'vertical' ? (
                  <Columns2 className="size-4" strokeWidth={1.8} />
                ) : (
                  <Rows2 className="size-4" strokeWidth={1.8} />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={editorLayout.split ? editorLayout.orientation : 'single'}
                onValueChange={(value) => {
                  if (value === 'single') {
                    if (editorLayout.split) toggleSplit();
                  } else if (value === 'vertical' || value === 'horizontal') toggleSplit(value);
                }}
              >
                <DropdownMenuRadioItem value="single">
                  <Square />
                  单栏（合并编辑组）
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="vertical">
                  <Columns2 />
                  左右分栏
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="horizontal">
                  <Rows2 />
                  上下分栏
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            aria-controls="workspace-agent"
            aria-expanded={agentOpen}
            aria-label={agentOpen ? '收起助手' : '展开助手'}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            onClick={() => setAgentOpen((value) => !value)}
            title={agentOpen ? '收起助手' : '展开助手'}
            type="button"
          >
            <PanelRight className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      </TitleBarPortal>
      <Dialog.Root
        open={modal !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
            <Dialog.Title className="text-base font-semibold">
              {modal ? titles[modal.action] : ''}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-xs text-muted-foreground">
              {modal?.action === 'connect'
                ? '使用个人 Access Token，凭据加密保存在本机。'
                : modal?.action === 'remove'
                  ? '移除该内容及其子项的应用内记录。本地文件和 Canvas 原件会保留。'
                  : modal?.action === 'link'
                    ? '引用同一份资料，原位置保持不变。'
                    : modal?.action === 'note'
                      ? `笔记保存到 ${workspace.directory}`
                      : '按自己的主题组织内容。'}
            </Dialog.Description>
            <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4">
              {(modal?.action === 'link' || modal?.action === 'move') && (
                <label className="grid gap-2 text-sm">
                  位置
                  <select
                    aria-label="目标文件夹"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">我的内容</option>
                    {workspace.entries
                      .filter(
                        (e) => (e.kind === 'folder' || e.kind === 'project') && e.id !== modal?.id,
                      )
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {pathName(e)}
                        </option>
                      ))}
                    {modal.action === 'link' && <option value="__new__">新建项目…</option>}
                  </select>
                </label>
              )}
              {modal &&
                !['move', 'remove'].includes(modal.action) &&
                (modal.action !== 'link' || target === '__new__') && (
                  <label className="grid gap-2 text-sm">
                    {modal.action === 'connect' ? 'Access Token' : '名称'}
                    <Input
                      autoFocus
                      autoComplete="off"
                      type={modal.action === 'connect' ? 'password' : 'text'}
                      aria-label={modal.action === 'connect' ? 'Canvas Access Token' : '名称'}
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}
              {modalError && (
                <p role="alert" className="text-xs [overflow-wrap:anywhere] text-destructive">
                  {modalError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setModal(null)}>
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy
                    ? '处理中…'
                    : modal?.action === 'remove'
                      ? '移除'
                      : modal?.action === 'connect'
                        ? '连接'
                        : '确定'}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** 把视图内的动作挂到 AppShell 标题栏右侧；等 AppShell 挂载完成再取宿主节点，视图卸载时随之撤下。 */
function TitleBarPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const host = document.getElementById('titlebar-actions');
  return host ? createPortal(children, host) : null;
}

function HeaderAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* 目录列为 bg-muted，ghost 默认 hover:bg-accent 与其同值无反馈，显式覆盖。 */}
        <Button
          size="icon-xs"
          variant="ghost"
          className="hover:bg-foreground/10"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
