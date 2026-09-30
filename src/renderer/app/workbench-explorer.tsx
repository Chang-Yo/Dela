// 工作台目录侧栏（装配层）：项目文件树（navigation/ProjectFileTree）+ Canvas 资料树
// （navigation/SourcesTree）+ 归档区，替代旧 ProjectView/SourcesView 的目录侧栏。
// 树的展开/筛选/选中态在 navigation/store；条目动作经 onAction 交给 EntryDialogs（壳）。
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ChevronRight,
  ChevronsDownUp,
  Ellipsis,
  FilePlus2,
  FolderInput,
  FolderPlus,
  GraduationCap,
  KeyRound,
  Folder,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { workspaceArchiveId } from '../../shared/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Resizer } from '../components/ui/resizer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { ProjectFileTree, type EntryAction } from '../navigation/ProjectFileTree';
import { SourcesTree, latestTermOf } from '../navigation/SourcesTree';
import { useNavigationStore as useTreeState } from '../navigation/store';
import { useNavigationStore as useAppNavigation } from './navigation';
import {
  importDroppedFiles,
  importFromDialog,
  isDescendant,
  moveEntry,
} from '../workspace/entry-actions';
import { useWorkspaceStore } from '../workspace/store';
import { cn } from '../lib/utils';

const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 240;
/** 目录宽度上界：再宽会明显挤占右侧内容栏；沿用既有上界，与 3A 批次首次引入值一致。 */
const SIDEBAR_MAX_WIDTH = 360;
const widthStorageKey = 'dela.workspace.sidebarWidth';
const collapsedStorageKey = 'dela.workspace.collapsed';
/** 与旧 ProjectView 一致的窄屏断点：<768px 目录变覆盖抽屉。 */
const NARROW_QUERY = '(max-width: 767px)';

/** 新建弹窗的目标容器：选中/活动文档所在文件夹，缺省回落到根（旧 currentContainer）。 */
export function currentContainerOf(activeKey: string | null, rootId: string | null): string | null {
  const entry = useWorkspaceStore.getState().workspace.entries.find((e) => e.id === activeKey);
  return entry
    ? entry.kind === 'folder' || entry.kind === 'project'
      ? entry.id
      : entry.parentId
    : rootId;
}

function TitleBarPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const host = document.getElementById('titlebar-actions');
  return host ? createPortal(children, host) : null;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

export function WorkbenchExplorer({
  projectId,
  activeDocKey,
  onAction,
  onOpenDocument,
  onOpenToSide,
}: {
  projectId: string | null;
  activeDocKey: string | null;
  onAction: (action: EntryAction | 'link' | 'connect', id: string | null) => void;
  onOpenDocument: (key: string) => void;
  onOpenToSide: (key: string) => void;
}) {
  const entries = useWorkspaceStore((s) => s.workspace.entries);
  const canvas = useWorkspaceStore((s) => s.canvas);
  const rootId = entries.some((entry) => entry.id === projectId) ? projectId : null;
  const root = entries.find((e) => e.id === rootId);
  const selected = useTreeState((s) => s.selected);
  const expanded = useTreeState((s) => s.expanded);
  const query = useTreeState((s) => s.query);
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(widthStorageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : SIDEBAR_DEFAULT_WIDTH;
  });
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(collapsedStorageKey) === 'true',
  );
  const [resizing, setResizing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const narrow = useNarrow();
  const [bySource, setBySource] = useState(false);
  // 通用（无项目）工作台承接旧资料页：课程资料默认展开；项目工作台内默认收起。
  const [coursesOpen, setCoursesOpen] = useState(() => projectId === null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(widthStorageKey, String(width));
      } catch {
        /* localStorage 不可用时保持内存值。 */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [width]);
  useEffect(() => {
    try {
      localStorage.setItem(collapsedStorageKey, String(collapsed));
    } catch {
      /* localStorage 不可用时保持内存值。 */
    }
  }, [collapsed]);
  useEffect(() => {
    if (!narrow) setMobileOpen(false);
  }, [narrow]);

  const expand = (id: string, open: boolean) => useTreeState.getState().expand(id, open);
  const container = () => currentContainerOf(selected ?? activeDocKey, rootId);

  const selectEntry = (id: string) => {
    const item = entries.find((entry) => entry.id === id);
    if (!item) return;
    if (item.kind === 'project') {
      void useAppNavigation.getState().openProject(id);
      setMobileOpen(false);
    } else if (item.kind === 'folder') {
      useTreeState.getState().select(id);
      expand(id, !expanded.includes(id));
    } else onOpenDocument(id);
  };

  const openToSide = (key: string) => {
    const item = entries.find((entry) => entry.id === key);
    if (item?.kind === 'project') void useAppNavigation.getState().openProject(key);
    else if (item?.kind === 'folder') selectEntry(key);
    else onOpenToSide(key);
  };

  const move = (dragId: string, targetId: string | null) =>
    moveEntry(dragId, targetId, rootId, (target) => {
      if (target) expand(target, true);
    });
  const importDropped = (files: File[], targetId: string | null) =>
    importDroppedFiles(files, targetId, rootId, (target) => {
      if (target) expand(target, true);
    });

  const refreshCourses = () => {
    if (syncing || !canvas.connected || !window.dela) return;
    setSyncing(true);
    const store = useWorkspaceStore.getState();
    void (async () => {
      try {
        // 先刷新课程列表，否则新学期的课程拿不到；再逐门同步最新学期（顺序执行，避免并发轰炸 Canvas）。
        store.setCanvas(await window.dela!.canvas.syncCourses());
        const courses = useWorkspaceStore.getState().canvas.courses;
        const latest = latestTermOf(courses);
        for (const course of courses)
          if (course.term === latest && !course.archived)
            store.setCanvas(await window.dela!.canvas.syncCourse(course.id));
      } catch (error) {
        store.setError(error);
      } finally {
        setSyncing(false);
      }
    })();
  };

  const visible = !collapsed && (!narrow || mobileOpen);
  const sectionClass = 'flex h-8 items-center gap-1 px-3 text-xs font-medium text-muted-foreground';
  const chevron = (open: boolean) => (
    <ChevronRight
      className={cn(
        'size-3 transition-transform duration-150 motion-reduce:transition-none',
        open && 'rotate-90',
      )}
    />
  );
  const sourcesOpen = coursesOpen || Boolean(query.trim());

  return (
    <>
      <TitleBarPortal>
        {/* 目录隐藏时的展开入口（宽屏折叠/窄屏抽屉共用；旧版放在标签栏左端）。 */}
        {!visible && (
          <button
            aria-label="展开目录"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            onClick={() => (narrow ? setMobileOpen(true) : setCollapsed(false))}
            title="展开目录"
            type="button"
          >
            <PanelLeft className="size-4" strokeWidth={1.8} />
          </button>
        )}
      </TitleBarPortal>
      <aside
        aria-label="工作台目录"
        inert={!visible}
        className={cn(
          // 与标签带同为 bg-muted 的 chrome 区，与白色页面之间靠色差分隔，不再画边框线。
          'flex min-h-0 shrink-0 flex-col overflow-hidden bg-muted transition-[width] duration-150 ease-out motion-reduce:transition-none max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:!w-[280px] max-md:max-w-[85vw] max-md:bg-background max-md:shadow-xl',
          resizing && 'transition-none',
          !visible && 'w-0 max-md:hidden',
        )}
        style={narrow || collapsed ? undefined : { width }}
      >
        <div
          className={cn(
            // 壳动内容不动：折叠动画中内容保持展开宽度、被外壳裁切并淡出。
            'flex min-h-0 flex-1 flex-col transition-opacity duration-150 motion-reduce:transition-none max-md:!w-full',
            collapsed && 'pointer-events-none opacity-0',
          )}
          style={narrow ? undefined : { width }}
        >
          <div className="flex h-10 shrink-0 items-center gap-1 px-2">
            <button
              aria-controls="workspace-explorer"
              aria-expanded={visible}
              aria-label={visible ? '收起目录' : '展开目录'}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              onClick={() => {
                if (narrow) setMobileOpen(false);
                else setCollapsed((value) => !value);
              }}
              title={visible ? '收起目录' : '展开目录'}
              type="button"
            >
              <PanelLeft className="size-3.5" strokeWidth={1.8} />
            </button>
            <button
              className="min-w-0 flex-1 truncate text-left text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => useTreeState.getState().select(rootId)}
              title={projectId ? (root?.name ?? '项目与文件夹') : '资料'}
              type="button"
            >
              {projectId ? (root?.name ?? '项目与文件夹') : '资料'}
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="新建"
                    className="hover:bg-foreground/10"
                    size="icon-xs"
                    title="新建"
                    variant="ghost"
                  >
                    <Plus />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onAction('note', container())}>
                    <FilePlus2 />
                    新建笔记
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction('folder', container())}>
                    <FolderPlus />
                    新建文件夹
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction('import', container())}>
                    <FolderInput />
                    导入本地文件
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                aria-label="全部收起"
                className="hover:bg-foreground/10"
                onClick={() => useTreeState.getState().collapseAll()}
                size="icon-xs"
                title="全部收起"
                variant="ghost"
              >
                <ChevronsDownUp />
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col" id="workspace-explorer">
            <div className="relative mx-2 mb-1">
              <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
              <Input
                aria-label="筛选已同步内容"
                className="h-8 rounded-lg border-0 bg-background pl-7 text-xs shadow-xs dark:bg-background"
                onChange={(e) => useTreeState.getState().setQuery(e.target.value)}
                placeholder="筛选已同步内容…"
                value={query}
              />
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              onDoubleClick={(event) => {
                if (event.target === event.currentTarget) onAction('note', container());
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  return;
                }
                if (event.target !== event.currentTarget) return;
                if (!event.dataTransfer.types.includes('application/x-dela-entry')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                  if (event.defaultPrevented) return;
                  event.preventDefault();
                  importDropped(Array.from(event.dataTransfer.files), null);
                  return;
                }
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                const drag = event.dataTransfer.getData('application/x-dela-entry');
                if (drag) move(drag, null);
              }}
            >
              <div className={cn(sectionClass, 'mt-1')}>
                <button
                  aria-expanded={sourcesOpen}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground"
                  onClick={() => setCoursesOpen((value) => !value)}
                  type="button"
                >
                  {chevron(sourcesOpen)}
                  <GraduationCap className="size-4" />
                  课程资料
                </button>
                <Button
                  aria-label="刷新课程资料"
                  className="hover:bg-foreground/10"
                  disabled={!canvas.connected}
                  onClick={refreshCourses}
                  size="icon-xs"
                  title="刷新课程资料"
                  variant="ghost"
                >
                  <RefreshCw className={cn(syncing && 'animate-spin')} />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="Canvas 操作"
                      className="hover:bg-foreground/10"
                      size="icon-xs"
                      title="Canvas 操作"
                      variant="ghost"
                    >
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => onAction('connect', null)}>
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
              {sourcesOpen &&
                (canvas.connected ? (
                  <SourcesTree
                    bySource={bySource}
                    expanded={expanded}
                    onArchive={() => setArchiveOpen(true)}
                    onExpand={expand}
                    onLink={(id) => onAction('link', id)}
                    onOpen={onOpenDocument}
                    onOpenToSide={onOpenToSide}
                    query={query}
                    selected={activeDocKey}
                  />
                ) : (
                  <div className="px-4 py-3 text-xs text-muted-foreground">
                    <p>连接 Canvas，查看课程资料。</p>
                    <Button
                      className="mt-3"
                      onClick={() => onAction('connect', null)}
                      size="sm"
                      variant="outline"
                    >
                      连接 Canvas
                    </Button>
                  </div>
                ))}
              <ProjectFileTree
                canDrop={(dragId, targetId) => !isDescendant(entries, targetId, dragId)}
                entries={entries}
                expanded={expanded}
                onAction={(action, id) => {
                  if (action === 'import') importFromDialog(id);
                  else onAction(action, id);
                }}
                onExpand={expand}
                onImportFiles={rootId ? importDropped : undefined}
                onMove={move}
                onOpenToSide={openToSide}
                onSelect={selectEntry}
                query={query}
                rootId={rootId}
                selected={activeDocKey ?? selected}
              />
              <button
                aria-expanded={archiveOpen || Boolean(query.trim())}
                className={cn(sectionClass, 'mt-3 w-full hover:text-foreground')}
                onClick={() => setArchiveOpen((value) => !value)}
                type="button"
              >
                {chevron(archiveOpen || Boolean(query.trim()))}
                <Archive className="size-4" />
                归档
              </button>
              {(archiveOpen || query.trim()) && (
                <>
                  <SourcesTree
                    archived
                    bySource={bySource}
                    expanded={expanded}
                    onExpand={expand}
                    onLink={(id) => onAction('link', id)}
                    onOpen={onOpenDocument}
                    onOpenToSide={onOpenToSide}
                    query={query}
                    selected={activeDocKey}
                  />
                  <ProjectFileTree
                    archived
                    canDrop={(dragId, targetId) => !isDescendant(entries, targetId, dragId)}
                    entries={entries}
                    expanded={expanded}
                    onAction={(action, id) => {
                      if (action === 'import') importFromDialog(id);
                      else onAction(action, id);
                    }}
                    onExpand={expand}
                    onMove={move}
                    onOpenToSide={openToSide}
                    onSelect={selectEntry}
                    query={query}
                    rootId={workspaceArchiveId}
                    selected={activeDocKey ?? selected}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </aside>
      <Resizer
        className={cn('bg-transparent', !visible && 'hidden')}
        label="调整目录宽度"
        max={SIDEBAR_MAX_WIDTH}
        min={SIDEBAR_MIN_WIDTH}
        onChange={setWidth}
        onResizingChange={setResizing}
        value={width}
      />
    </>
  );
}
