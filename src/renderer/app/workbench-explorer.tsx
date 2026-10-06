// 工作台目录侧栏（装配层）：项目文件树（navigation/ProjectFileTree）+ Canvas 资料树
// （navigation/SourcesTree）+ 归档区，替代旧 ProjectView/SourcesView 的目录侧栏。
// 树的展开/筛选/选中态在 navigation/store；条目动作除归档/升级为项目/导入（直连
// entry-actions）外，经 onAction 交给 EntryDialogs（壳）。
// 折叠/窄屏抽屉开合在 workbench/explorer-state（展开入口在焦点组标签栏左侧）。
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ChevronRight,
  ChevronsDownUp,
  Ellipsis,
  FilePlus2,
  FileInput,
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
  archiveEntry,
  importDroppedFiles,
  importFromDialog,
  isDescendant,
  moveEntry,
  promoteEntry,
} from '../workspace/entry-actions';
import { useWorkspaceStore } from '../workspace/store';
import { useExplorerState, useViewportWidth } from '../workbench/explorer-state';
import { cn } from '../lib/utils';

const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 240;
/** 目录宽度上界：再宽会明显挤占右侧内容栏；沿用既有上界，与 3A 批次首次引入值一致。 */
const SIDEBAR_MAX_WIDTH = 360;
const widthStorageKey = 'dela.workspace.sidebarWidth';

/** 新建弹窗的目标容器：选中/活动文档所在文件夹，缺省回落到根（旧 currentContainer）。 */
export function currentContainerOf(activeKey: string | null, rootId: string | null): string | null {
  const entry = useWorkspaceStore.getState().workspace.entries.find((e) => e.id === activeKey);
  return entry
    ? entry.kind === 'folder' || entry.kind === 'project'
      ? entry.id
      : entry.parentId
    : rootId;
}

/** 与旧 ProjectView 一致的窄屏断点：<768px 目录变覆盖抽屉。 */
const NARROW_QUERY = '(max-width: 767px)';

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
  const collapsed = useExplorerState((s) => s.collapsed);
  const mobileOpen = useExplorerState((s) => s.mobileOpen);
  const [resizing, setResizing] = useState(false);
  const narrow = useNarrow();
  const viewportWidth = useViewportWidth();
  const drawerRef = useRef<HTMLElement>(null);
  const [bySource, setBySource] = useState(false);
  // 课程资料只在通用（无项目）工作台显示（承接旧资料页），且默认展开；项目工作台不渲染课程资料。
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
  // 窄屏抽屉打开时把焦点移入容器、Escape 收起；收起态由 aside 的 inert 兜底。
  useEffect(() => {
    if (!narrow || !mobileOpen) return;
    drawerRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useExplorerState.getState().setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [narrow, mobileOpen]);

  const expand = (id: string, open: boolean) => useTreeState.getState().expand(id, open);
  const container = () => currentContainerOf(selected ?? activeDocKey, rootId);

  const selectEntry = (id: string) => {
    const item = entries.find((entry) => entry.id === id);
    if (!item) return;
    if (item.kind === 'project') {
      void useAppNavigation.getState().openProject(id);
      useExplorerState.getState().setMobileOpen(false);
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
  // 归档/升级为项目/导入不弹窗，直连 entry-actions（旧 ProjectView.action 的拦截语义）；
  // 展开归档区、打开项目等后续 UI 也只有在这层接线才拿得到。
  const treeAction = (action: EntryAction, id: string | null) => {
    if (action === 'import') importFromDialog(id);
    else if (action === 'archive' && id) archiveEntry(id, () => setArchiveOpen(true));
    else if (action === 'promote' && id)
      promoteEntry(id, (pid) => void useAppNavigation.getState().openProject(pid));
    else onAction(action, id);
  };

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

  // 窄屏抽屉只看 mobileOpen：忽略宽屏折叠残留，否则折叠目录后缩窗会永远打不开目录。
  const visible = narrow ? mobileOpen : !collapsed;
  // 视口钳制：目录渲染宽度不超过视口约 28%（下限 200），窄窗口下给内容区保留可用宽度；
  // 用户拖拽偏好仍按原值持久化，仅在渲染时钳制。
  const effectiveWidth = Math.min(width, Math.max(200, Math.round(viewportWidth * 0.28)));
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
      {/* 窄屏抽屉遮罩：点外关闭，与主导航抽屉同一交互模型。 */}
      {narrow && mobileOpen && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-20 bg-black/30 animate-in fade-in duration-150"
          onMouseDown={() => useExplorerState.getState().setMobileOpen(false)}
        />
      )}
      <aside
        ref={drawerRef}
        aria-label="工作台目录"
        inert={!visible}
        tabIndex={-1}
        className={cn(
          // 三级背景层次（用户裁决，勿压平）：侧栏画布 --sidebar(0.985) → 目录树 --muted(0.97)
          // 略深一档 → 内容区白(1.0)；树与白底之间靠色差分隔，不画边框线。
          'flex min-h-0 shrink-0 flex-col overflow-hidden bg-muted transition-[width] duration-150 ease-out motion-reduce:transition-none max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:!w-[280px] max-md:max-w-[85vw] max-md:bg-background max-md:shadow-xl max-md:animate-in max-md:fade-in max-md:slide-in-from-left-6 max-md:duration-150',
          resizing && 'transition-none',
          !visible && 'w-0 max-md:hidden',
        )}
        style={narrow || collapsed ? undefined : { width: effectiveWidth }}
      >
        <div
          className={cn(
            // 壳动内容不动：折叠动画中内容保持展开宽度、被外壳裁切并淡出。
            'flex min-h-0 flex-1 flex-col transition-opacity duration-150 motion-reduce:transition-none max-md:!w-full',
            collapsed && !narrow && 'pointer-events-none opacity-0',
          )}
          style={narrow ? undefined : { width: effectiveWidth }}
        >
          <div className="flex h-10 shrink-0 items-center gap-1 px-2">
            <button
              aria-controls="workspace-explorer"
              aria-expanded={visible}
              aria-label={visible ? '收起目录' : '展开目录'}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              onClick={() => {
                if (narrow) useExplorerState.getState().setMobileOpen(false);
                else useExplorerState.getState().setCollapsed(!collapsed);
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
                  <DropdownMenuItem onSelect={() => importFromDialog(container())}>
                    <FileInput />
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
              {/* 课程资料只在通用（无项目）工作台显示；项目工作台只呈现项目自己的文件。 */}
              {projectId === null && (
                <>
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
                </>
              )}
              <ProjectFileTree
                canDrop={(dragId, targetId) => !isDescendant(entries, targetId, dragId)}
                entries={entries}
                expanded={expanded}
                onAction={treeAction}
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
                  {projectId === null && (
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
                  )}
                  <ProjectFileTree
                    archived
                    canDrop={(dragId, targetId) => !isDescendant(entries, targetId, dragId)}
                    entries={entries}
                    expanded={expanded}
                    onAction={treeAction}
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
        // 拖拽绑定用户偏好值与原上限：渲染宽度另有视口钳制，若把钳制值当 max，
        // 窄窗下 min==max==value 会把拖拽完全锁死，还会把钳制值写回偏好。
        max={SIDEBAR_MAX_WIDTH}
        min={SIDEBAR_MIN_WIDTH}
        onChange={setWidth}
        onResizingChange={setResizing}
        value={width}
      />
    </>
  );
}
