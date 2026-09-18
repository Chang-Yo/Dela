import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
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
  MessageSquare,
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
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { PanelToggleButton } from '../../components/ui/panel-toggle';
import { Resizer } from '../../components/ui/resizer';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { explorerDragType } from '../../components/ui/explorer';
import { cn } from '../../lib/utils';
import { SourceList, latestTermOf } from '../sources/SourceList';
import { ProjectDocument } from './ProjectDocument';
import { forgetMarkdownEditorState } from './MarkdownEditor';
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
type EditorGroup = { tabs: string[]; active: string | null; preview: string | null };
type EditorLayout = {
  split: boolean;
  orientation: SplitOrientation;
  ratio: number;
  focus: EditorGroupId;
  groups: Record<EditorGroupId, EditorGroup>;
};

const editorLayoutKey = (scope: string) => `dela.editor.layout.${scope}`;
const MAX_EDITOR_TABS = 100;
// A single editor group needs room for its document toolbar and readable body.
// This is a layout constraint only; the stored sidebar/assistant preferences remain intact.
const EDITOR_MIN_WIDTH = 320;
const EDITOR_MIN_HEIGHT = 240;
const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 48;
const AGENT_DEFAULT_WIDTH = 340;
const AGENT_MIN_WIDTH = 280;
/** ProjectDocument 以此格式生成 CodeMirror 会话键（viewId = `${scope}:${group}`）。 */
const documentSessionKey = (key: string, atScope: string, group: EditorGroupId) =>
  `document:${key}:${atScope}:${group}`;

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
      preview:
        typeof group?.preview === 'string' && groupTabs.includes(group.preview)
          ? group.preview
          : null,
    };
  };
  const groups = {
    primary: clean(stored?.groups?.primary, validTabs),
    secondary: clean(stored?.groups?.secondary, []),
  } satisfies Record<EditorGroupId, EditorGroup>;
  const seen = new Set<string>();
  for (const group of [groups.primary, groups.secondary]) {
    group.tabs = group.tabs.filter((key) => {
      if (seen.has(key) || seen.size >= MAX_EDITOR_TABS) return false;
      seen.add(key);
      return true;
    });
    if (group.active && !group.tabs.includes(group.active))
      group.active = group.tabs.at(-1) ?? null;
    if (group.preview && !group.tabs.includes(group.preview)) group.preview = null;
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
  onOpenShuiyuanTopic?: (topicId: number) => void;
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bySource, setBySource] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(true);
  const [personalOpen, setPersonalOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [shellWidth, setShellWidth] = useState(0);
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
  const [draggingFiles, setDraggingFiles] = useState(false);
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
  useEffect(() => {
    localStorage.setItem('dela.workspace.sidebarWidth', String(width));
  }, [width]);
  useEffect(() => {
    localStorage.setItem('dela.workspace.collapsed', String(collapsed));
  }, [collapsed]);
  useEffect(() => {
    localStorage.setItem('dela.workspace.agentOpen', String(agentOpen));
  }, [agentOpen]);
  useEffect(() => {
    localStorage.setItem('dela.workspace.agentWidth', String(agentWidth));
  }, [agentWidth]);
  useEffect(() => {
    setSelected(rootId);
  }, [rootId]);
  useEffect(() => {
    if (createRequested) {
      show({ action: 'project', id: null });
      onCreateHandled?.();
    }
  }, [createRequested]);
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
  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setShellWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (workspaceLoaded) {
      const next = defaultEditorLayout(scope, saved.tabs, saved.active);
      editorLayoutRef.current = next;
      setEditorLayout(next);
    }
  }, [scope, workspaceLoaded]);
  useEffect(() => {
    scopeRef.current = scope;
    closeRequest.current += 1;
  }, [scope]);
  /* 预览标签一旦被编辑就转正（VSCode 语义）。从 ref 读当前布局：
     scope 切换的同一提交里 state 仍是旧 scope 的布局，直接用会把旧布局写进新 scope。 */
  useEffect(() => {
    const layout = editorLayoutRef.current;
    const pinned = (group: EditorGroupId) => {
      const preview = layout.groups[group].preview;
      return preview && drafts[preview]?.text !== drafts[preview]?.saved ? null : preview;
    };
    const primary = pinned('primary');
    const secondary = pinned('secondary');
    if (primary === layout.groups.primary.preview && secondary === layout.groups.secondary.preview)
      return;
    persistEditorLayout({
      ...layout,
      groups: {
        primary: { ...layout.groups.primary, preview: primary },
        secondary: { ...layout.groups.secondary, preview: secondary },
      },
    });
  }, [drafts]);
  const effectiveSidebarWidth = collapsed
    ? SIDEBAR_COLLAPSED_WIDTH
    : Math.min(
        width,
        Math.max(SIDEBAR_MIN_WIDTH, shellWidth - EDITOR_MIN_WIDTH - (agentOpen ? agentWidth : 0)),
      );
  const effectiveAgentWidth = agentOpen
    ? Math.min(
        agentWidth,
        Math.max(AGENT_MIN_WIDTH, shellWidth - EDITOR_MIN_WIDTH - effectiveSidebarWidth),
      )
    : 0;
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
    setDraggingFiles(false);
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
  const open = (key: string, group: EditorGroupId = focusedGroup, pin = false) => {
    const current = editorLayout.groups[group];
    const alreadyOpen = current.tabs.includes(key);
    const previewToReplace =
      !pin && current.preview && current.preview !== key ? current.preview : null;
    const canReplacePreview =
      previewToReplace &&
      !(
        drafts[previewToReplace] && drafts[previewToReplace].text !== drafts[previewToReplace].saved
      );
    const openEverywhere = layoutTabs(editorLayout);
    if (!alreadyOpen && !openEverywhere.includes(key) && openEverywhere.length >= MAX_EDITOR_TABS) {
      useWorkspace.getState().setError(`最多打开 ${MAX_EDITOR_TABS} 个文档`);
      return;
    }
    const tabs = current.tabs.filter((tab) => !canReplacePreview || tab !== previewToReplace);
    const next: EditorLayout = {
      ...editorLayout,
      split: editorLayout.split || group === 'secondary',
      focus: group,
      groups: {
        ...editorLayout.groups,
        [group]: {
          tabs: alreadyOpen ? current.tabs : [...tabs, key],
          active: key,
          preview: pin
            ? current.preview === key
              ? null
              : current.preview
            : alreadyOpen
              ? current.preview
              : key,
        },
      },
    };
    persistEditorLayout(next);
    syncView(next);
    setSelected(key);
    setMobileOpen(false);
    if (
      canReplacePreview &&
      previewToReplace &&
      !next.groups.primary.tabs.includes(previewToReplace) &&
      !next.groups.secondary.tabs.includes(previewToReplace)
    ) {
      void useWorkspace.getState().release(previewToReplace);
      forgetDocumentSessions(previewToReplace, scope);
    }
  };
  /* ProjectDocument 在两编辑器组各持有独立 CodeMirror 会话；文档彻底关闭后
     连撤销历史一起清理，否则 sessions 表随开关标签无限增长。 */
  const forgetDocumentSessions = (key: string, atScope: string) => {
    for (const group of ['primary', 'secondary'] as const)
      forgetMarkdownEditorState(documentSessionKey(key, atScope, group));
  };
  const closeTab = async (key: string, group: EditorGroupId = focusedGroup) => {
    const request = ++closeRequest.current;
    const closeScope = scope;
    const otherGroup = group === 'primary' ? 'secondary' : 'primary';
    const stillOpenElsewhere = editorLayoutRef.current.groups[otherGroup].tabs.includes(key);
    // 彻底关闭前先冲盘并释放草稿；保存失败则保留标签，脏草稿不能变得不可达。
    if (!stillOpenElsewhere && !(await useWorkspace.getState().release(key))) return;
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
          preview: currentGroup.preview === key ? null : currentGroup.preview,
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
  const toggleSplit = () => {
    if (editorLayout.split) {
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
            preview: focused.preview ?? other.preview,
          },
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
      focus: 'secondary' as EditorGroupId,
      groups: {
        ...editorLayout.groups,
        secondary: {
          tabs: secondary.tabs.length ? secondary.tabs : active ? [active] : [],
          active: secondary.active ?? active ?? null,
          preview: secondary.preview ?? null,
        },
      },
    };
    persistEditorLayout(next);
    syncView(next);
  };
  const moveTab = (key: string, from: EditorGroupId, to: EditorGroupId, targetIndex?: number) => {
    const source = editorLayout.groups[from];
    if (!source.tabs.includes(key)) return;
    const movingPreview = source.preview === key;
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
        [from]: {
          tabs: sourceTabs,
          active: source.active === key ? (sourceTabs.at(-1) ?? null) : source.active,
          preview: movingPreview && from !== to ? null : source.preview,
        },
        // from===to 时该键覆盖上面的值；预览状态在组内重排和跨组移动时都保留。
        [to]: {
          tabs: destinationTabs,
          active: key,
          preview: from === to ? source.preview : movingPreview ? key : destination.preview,
        },
      },
    };
    persistEditorLayout(next);
    syncView(next);
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
    open(id, 'secondary', true);
  };
  const pinEntry = (id: string) => {
    const item = workspace.entries.find((entry) => entry.id === id);
    if (item?.kind === 'folder' || item?.kind === 'project') {
      selectEntry(id);
      return;
    }
    open(id, focusedGroup, true);
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
            preview: current.preview && keep(current.preview) ? current.preview : null,
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
        else if (created.kind === 'note') open(created.id, focusedGroup, true);
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
      await setCanvas(await window.dela!.canvas.syncCourses());
      const courses = useWorkspace.getState().canvas.courses;
      const latest = latestTermOf(courses);
      for (const course of courses)
        if (course.term === latest)
          await setCanvas(await window.dela!.canvas.syncCourse(course.id));
    }).finally(() => setSyncing(false));
  };
  const renderDocument = (key: string, group: EditorGroupId, readOnly = false) => {
    const scrollKey = viewScrollKey(group, key);
    return (
      <ProjectDocument
        key={`${group}:${key}`}
        documentKey={key}
        viewId={`${scope}:${group}`}
        readOnly={readOnly}
        scroll={
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
      />
    );
  };
  const pinTab = (key: string, group: EditorGroupId) => {
    const state = editorLayout.groups[group];
    if (state.preview !== key) return;
    persistEditorLayout({
      ...editorLayout,
      groups: { ...editorLayout.groups, [group]: { ...state, preview: null } },
    });
  };
  const renderTabs = (group: EditorGroupId) => {
    const state = editorLayout.groups[group];
    return (
      <div
        role="tablist"
        aria-label={`${group === 'primary' ? '主' : '分栏'}编辑器标签页`}
        className="flex h-10 min-w-0 shrink-0 overflow-x-auto border-b bg-muted/20 [scrollbar-width:none]"
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
          const raw = event.dataTransfer.getData('application/x-dela-editor-tab');
          if (!raw) return;
          try {
            const payload = JSON.parse(raw) as { key?: string; group?: EditorGroupId };
            if (!payload.key || (payload.group !== 'primary' && payload.group !== 'secondary'))
              return;
            const target = (event.target as HTMLElement).closest('[data-editor-tab]');
            const index = target
              ? Array.from(event.currentTarget.querySelectorAll('[data-editor-tab]')).indexOf(
                  target,
                )
              : state.tabs.length;
            moveTab(payload.key, payload.group, group, index);
          } catch {
            // Ignore data from unrelated drag sources.
          }
        }}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) newNote('');
        }}
      >
        {state.tabs.map((key) => {
          const dirty = Boolean(drafts[key] && drafts[key].text !== drafts[key].saved);
          const active = state.active === key;
          return (
            <ContextMenu key={key}>
              <ContextMenuTrigger asChild>
                <div
                  data-editor-tab
                  draggable
                  className={cn(
                    'group/tab flex h-10 max-w-56 shrink-0 items-center border-r border-b-2 px-1',
                    active ? 'border-b-foreground bg-background' : 'border-b-transparent',
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
                  onDoubleClick={() => pinTab(key, group)}
                >
                  <button
                    role="tab"
                    aria-selected={active}
                    className="min-w-0 flex-1 truncate px-2 text-left text-xs"
                    title={title(key)}
                    onClick={() => open(key, group)}
                  >
                    <span className={cn(state.preview === key && 'italic')}>{title(key)}</span>
                  </button>
                  <button
                    className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
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
                    <X className={cn('size-3', dirty ? 'hidden group-hover/tab:block' : 'block')} />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
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
          <span className="flex items-center px-3 text-xs text-muted-foreground">未打开文件</span>
        )}
      </div>
    );
  };
  const renderGroup = (group: EditorGroupId) => {
    const state = editorLayout.groups[group];
    return (
      <section
        key={group}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={{
          flexBasis: editorLayout.split ? `${editorLayout.ratio * 100}%` : undefined,
          minWidth:
            editorLayout.split && editorLayout.orientation === 'vertical'
              ? EDITOR_MIN_WIDTH
              : undefined,
          minHeight:
            editorLayout.split && editorLayout.orientation === 'horizontal'
              ? EDITOR_MIN_HEIGHT
              : undefined,
        }}
        aria-label={`${group === 'primary' ? '主' : '分栏'}编辑器`}
        onPointerDown={() => focusGroup(group)}
      >
        {renderTabs(group)}
        {state.active ? (
          renderDocument(state.active, group)
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            <FilePlus2 className="size-7 opacity-45" />
            <p>从左侧目录打开文件</p>
            <p className="text-xs opacity-75">拖动标签页可调整顺序或移动到另一栏</p>
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
    } else if (event.key.toLowerCase() === 'w' && activeKey) {
      event.preventDefault();
      void closeTab(activeKey, focusedGroup);
    }
  };
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
      {mode === 'project' && draggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-[1px]">
          <div className="rounded-lg border bg-background px-4 py-3 text-sm font-medium shadow-lg">
            释放以导入到项目
          </div>
        </div>
      )}
      {mobileOpen && (
        <button
          aria-label="关闭目录"
          className="absolute inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          'flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-muted/40 transition-[width] duration-150 ease-out motion-reduce:transition-none max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:!w-[280px] max-md:max-w-[85vw] max-md:bg-background max-md:shadow-xl',
          resizing && 'transition-none',
          !mobileOpen && 'max-md:hidden',
        )}
        style={{ width: effectiveSidebarWidth }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col max-md:!w-full"
          style={{ width: effectiveSidebarWidth }}
        >
          <div className="flex h-11 shrink-0 items-center gap-1 px-2">
            <PanelToggleButton
              collapsed={collapsed}
              controlsId="workspace-explorer"
              label="目录"
              onToggle={() => (mobileOpen ? setMobileOpen(false) : setCollapsed((value) => !value))}
            />
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
                <>
                  {' '}
                  <HeaderAction label="新建笔记" onClick={() => action('note', currentContainer())}>
                    <FilePlus2 />
                  </HeaderAction>
                  <HeaderAction
                    label="新建文件夹"
                    onClick={() => action('folder', currentContainer())}
                  >
                    <FolderPlus />
                  </HeaderAction>
                  <HeaderAction
                    label="导入本地文件"
                    onClick={() => action('import', currentContainer())}
                  >
                    <FolderInput />
                  </HeaderAction>
                </>
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
            <div className="relative mx-3 mb-2">
              <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
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
              onDragEnter={(event: DragEvent<HTMLDivElement>) => {
                if (mode === 'project' && event.dataTransfer.types.includes('Files'))
                  setDraggingFiles(true);
              }}
              onDragLeave={(event: DragEvent<HTMLDivElement>) => {
                if (
                  mode === 'project' &&
                  event.dataTransfer.types.includes('Files') &&
                  !event.currentTarget.contains(event.relatedTarget as Node | null)
                ) {
                  setDraggingFiles(false);
                }
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
                  setDraggingFiles(false);
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
                          size="icon-sm"
                          variant="ghost"
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
                      onLink={(id) => show({ action: 'link', id })}
                      selected={activeKey}
                      query={query}
                      bySource={bySource}
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
                          size="icon-sm"
                          variant="ghost"
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
                  onDoubleClick={pinEntry}
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
                        onDoubleClick={pinEntry}
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
        <div className="flex h-11 shrink-0 items-center border-b px-2">
          <Button
            className="md:hidden"
            size="icon-sm"
            variant="ghost"
            aria-label="打开目录"
            onClick={() => setMobileOpen(true)}
          >
            <Folder />
          </Button>
          <span className="min-w-0 flex-1 truncate px-2 text-xs font-medium text-muted-foreground">
            {activeKey ? title(activeKey) : '编辑器'}
          </span>
          <Button
            size="icon-sm"
            variant={editorLayout.split ? 'secondary' : 'ghost'}
            title={editorLayout.split ? '合并编辑组' : '拆分编辑组（Ctrl/Cmd+\\）'}
            aria-label={editorLayout.split ? '合并编辑组' : '拆分编辑组'}
            onClick={toggleSplit}
          >
            <Columns2 />
          </Button>
          {editorLayout.split && (
            <Button
              size="icon-sm"
              variant="ghost"
              title={editorLayout.orientation === 'vertical' ? '改为上下分栏' : '改为左右分栏'}
              aria-label="切换分栏方向"
              onClick={() =>
                persistEditorLayout({
                  ...editorLayout,
                  orientation: editorLayout.orientation === 'vertical' ? 'horizontal' : 'vertical',
                })
              }
            >
              <Rows2 />
            </Button>
          )}
          <Button
            className={cn(!activeKey && 'ml-auto')}
            size="icon-sm"
            variant="ghost"
            title="助手"
            aria-label="打开助手"
            onClick={() => setAgentOpen((value) => !value)}
          >
            <MessageSquare />
          </Button>
        </div>
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
              className={editorLayout.orientation === 'vertical' ? 'w-px' : 'h-px'}
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
        <>
          <Resizer
            className="max-lg:hidden"
            label="调整助手宽度"
            min={AGENT_MIN_WIDTH}
            max={Math.min(520, Math.max(AGENT_MIN_WIDTH, shellWidth * 0.45))}
            defaultValue={AGENT_DEFAULT_WIDTH}
            direction={-1}
            value={agentWidth}
            onChange={setAgentWidth}
          />
          <div
            className="flex min-h-0 shrink-0 border-l max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:!w-full max-lg:bg-background"
            style={{ width: effectiveAgentWidth }}
          >
            <AgentPanel
              scope={scope}
              tabs={allTabs}
              chatRequest={chatRequest}
              onCollapse={() => setAgentOpen(false)}
              onSaveNote={(text) => show({ action: 'note', id: currentContainer(), text })}
              onOpen={(key) => open(key, focusedGroup, true)}
            />
          </div>
        </>
      )}
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
        <Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
