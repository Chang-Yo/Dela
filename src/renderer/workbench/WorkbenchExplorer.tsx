// 工作台目录侧栏（装配层）：项目文件树 + Canvas 资料树 + 归档区。树的展开/筛选/选中态在
// navigation/store，条目动作经 onAction 交给 EntryDialogs（壳）；折叠/抽屉开合在 explorer-state。
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ChevronRight,
  ChevronsDownUp,
  Ellipsis,
  FilePlus2,
  FileInput,
  FolderPlus,
  Globe,
  GraduationCap,
  KeyRound,
  Folder,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { workspaceArchiveId } from '../../shared/api';
import { parseRemoteNodeId } from '../../shared/remotes';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Resizer } from '../components/ui/resizer';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useAfterMenuClose,
} from '../components/ui/dropdown-menu';
import { ProjectFileTree, type EntryAction } from '../navigation/ProjectFileTree';
import type { ExplorerPending } from '../components/ui/explorer';
import type { WorkspaceEntry } from '../../shared/api';
import { useRemoteActivity } from '../navigation/remote-activity';
import { RemoteConnectionTip } from '../navigation/remote-connection-tip';
import { useRemoteConnections } from '../navigation/remote-connections';
import { SourcesTree } from '../navigation/SourcesTree';
import { CanvasDownloadsPanel } from '../navigation/CanvasDownloadsPanel';
import { useNavigationStore as useTreeState } from '../navigation/store';
import { useNavigationStore as useAppNavigation } from '../navigation/view';
import {
  archiveEntry,
  importDroppedFiles,
  importFromDialog,
  isDescendant,
  moveEntry,
  promoteEntry,
  runEntryWork,
} from '../workspace/entry-actions';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { showToast } from '../app/toasts';
import { RemotePortsDialog } from '../workspace/remote-ports-dialog';
import { useExplorerState, useViewportWidth } from './explorer-state';
import { cn } from '../lib/utils';
import { overlayFade } from '../components/ui/motion';

const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 160;
/** 目录宽度上界：再宽会明显挤占右侧内容栏。 */
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

export function WorkbenchExplorer({
  projectId,
  activeDocKey,
  onAction,
  onOpenDocument,
  onOpenToSide,
  onCreated,
}: {
  projectId: string | null;
  activeDocKey: string | null;
  onAction: (action: EntryAction | 'link' | 'connect', id: string | null) => void;
  onOpenDocument: (key: string) => void;
  onOpenToSide: (key: string) => void;
  /** 行内新建成功后（打开新文件、选中新文件夹等由接线方决定，与弹窗新建同一出口）。 */
  onCreated: (entry: WorkspaceEntry) => void;
}) {
  const entries = useWorkspaceStore((s) => s.workspace.entries);
  const canvas = useWorkspaceStore((s) => s.canvas);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const downloadCanvas = async (courseId: number, itemId?: string) => {
    try {
      const task = await window.dela?.canvas.startDownload({ courseId, itemId });
      if (task) setDownloadsOpen(true);
    } catch (cause) {
      showToast({ variant: 'error', title: '无法开始下载', description: errorText(cause) });
    }
  };
  const rootId = entries.some((entry) => entry.id === projectId) ? projectId : null;
  const root = entries.find((e) => e.id === rootId);
  // 打开的若是远程项目，这棵树本轮只读：拖入的落点是远端 POSIX 路径，
  // 本地写入入口（importDroppedFiles / moveEntry）会把它当本地目录，必须关掉。
  const remoteRoot = Boolean(root?.remoteId);
  // 标题上的连接提示与目录树说同一件事：目的地来自连接列表，状态由目录树写进 store。
  const connections = useRemoteConnections(root?.remoteId ?? '');
  const activity = useRemoteActivity((s) => s.byProject);
  const selected = useTreeState((s) => s.selected);
  const expanded = useTreeState((s) => s.expanded);
  const query = useTreeState((s) => s.query);
  const pendingCreate = useTreeState((s) => s.pendingCreate);
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(widthStorageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : SIDEBAR_DEFAULT_WIDTH;
  });
  const collapsed = useExplorerState((s) => s.collapsed);
  const mobileOpen = useExplorerState((s) => s.mobileOpen);
  const [resizing, setResizing] = useState(false);
  const narrow = useExplorerState((s) => s.narrow);
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
    if (!item) {
      // 远端条目不在 entries 里：文件直接开只读预览（读取按「项目 id + 远端路径」走远端通道）。
      if (parseRemoteNodeId(id)) onOpenDocument(id);
      return;
    }
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

  /** 双击文件：打开并保留（预览标签转常驻）。 */
  const keepDocument = (key: string) =>
    void useAppNavigation.getState().openDocument(key, { keep: true });

  const move = (dragId: string, targetId: string | null) =>
    moveEntry(dragId, targetId, rootId, (target) => {
      if (target) expand(target, true);
    });
  const importDropped = (files: File[], targetId: string | null) =>
    importDroppedFiles(files, targetId, rootId, (target) => {
      if (target) expand(target, true);
    });
  // 拖放落到远端树 = 上传到远端（走 helper 写字节），落到本地就是原来的导入。
  // 落点是远端条目就用它自己的项目与目录；落点是空白或远端项目行（远端树里 null 的那两种）
  // 就落到打开的远端项目根：项目条目的 path 存的就是远端目录。
  const importDroppedAnywhere = (files: File[], targetId: string | null) => {
    const remote = targetId ? parseRemoteNodeId(targetId) : null;
    const projectId = remote?.projectId ?? (remoteRoot ? rootId : null);
    const directory = remote?.path ?? (remoteRoot ? root?.path : null);
    if (!projectId || !directory) return importDropped(files, targetId);
    if (targetId) expand(targetId, true);
    void runEntryWork(async () => {
      await window.dela!.workspace.uploadRemoteFiles(projectId, directory, files);
    });
  };
  // 远端动作的失败与本地条目动作同一个出口（entry-actions 的错误浮窗）。
  const [portsForProject, setPortsForProject] = useState<string | null>(null);
  const remoteAction = (action: 'download' | 'open' | 'upload', id: string) => {
    const remote = parseRemoteNodeId(id);
    if (!remote) return;
    void runEntryWork(async () => {
      const workspace = window.dela!.workspace;
      if (action === 'download') await workspace.downloadRemoteFile(remote.projectId, remote.path);
      else if (action === 'open') await workspace.openRemoteFile(remote.projectId, remote.path);
      else await workspace.uploadRemoteFiles(remote.projectId, remote.path, null);
    });
  };
  /** 新建文件/文件夹在树里行内输入（VS Code 式），不开弹窗；落点为 null 时落在当前树根。 */
  const startCreate = (kind: 'file' | 'folder', parentId: string | null) =>
    useTreeState.getState().startCreate({ kind, parentId: parentId ?? rootId });
  // 名称输入框空名失焦即取消，必须等菜单的焦点回收结束再建行。
  const afterMenuClose = useAfterMenuClose();
  const pending: ExplorerPending | null = pendingCreate && {
    ...pendingCreate,
    onCancel: () => useTreeState.getState().cancelCreate(),
    onSubmit: async (name) => {
      try {
        const created = await window.dela!.workspace.create({
          name,
          parentId: pendingCreate.parentId,
          kind: pendingCreate.kind,
        });
        useTreeState.getState().cancelCreate();
        await useWorkspaceStore.getState().refresh();
        onCreated(created);
        return null;
      } catch (cause) {
        return errorText(cause);
      }
    },
  };

  // 归档/升级为项目/导入/新建文件与文件夹不弹窗，直连 entry-actions 或行内输入；
  // 展开归档区、打开项目等后续 UI 也只有在这层接线才拿得到。
  const treeAction = (action: EntryAction, id: string | null) => {
    if (action === 'note') startCreate('file', id);
    else if (action === 'folder') startCreate('folder', id);
    else if (action === 'import') importFromDialog(id);
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
        store.setCanvas(await window.dela!.canvas.refresh());
      } catch (cause) {
        showToast({ variant: 'error', title: '同步课程资料失败', description: errorText(cause) });
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
  const sectionClass = 'flex h-8 items-center gap-1 px-3 text-xs font-medium text-ink-3';
  // 区块小标题：比组头浅一档的分层提示（同步 / 文件两区），纯展示不可交互；归档区靠底部
  // 分隔线 + 自身组头分层，不另加小标题以免与"归档"组头文字重复。
  const eyebrowClass = 'px-3 pt-3 pb-1 text-2xs font-medium tracking-wider text-ink-3/70';
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
          className={cn(overlayFade, 'absolute inset-0 z-20 bg-black/30')}
          onMouseDown={() => useExplorerState.getState().setMobileOpen(false)}
        />
      )}
      <aside
        ref={drawerRef}
        aria-label="工作台目录"
        inert={!visible}
        tabIndex={-1}
        className={cn(
          // 三级背景层次（用户裁决，勿压平）：侧栏画布 --page → 目录树 --muted(=--inset)
          // 略深一档 → 内容区白(1.0)；树与白底之间靠色差分隔，不画边框线。
          'flex min-h-0 shrink-0 flex-col overflow-hidden bg-inset transition-[width] duration-150 ease-out motion-reduce:transition-none max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:!w-[17.5rem] max-md:max-w-[85vw] max-md:bg-surface max-md:shadow-overlay max-md:animate-[drawer-left_200ms_var(--ease-out-strong)_both]',
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
              className="grid size-7 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover-2 hover:text-ink"
              onClick={() => {
                if (narrow) useExplorerState.getState().setMobileOpen(false);
                else useExplorerState.getState().setCollapsed(!collapsed);
              }}
              title={visible ? '收起目录' : '展开目录'}
              type="button"
            >
              <PanelLeft className="size-3.5" strokeWidth={1.8} />
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium text-ink-2 transition-colors duration-150 hover:text-ink"
                  onClick={() => useTreeState.getState().select(rootId)}
                  title={
                    remoteRoot ? undefined : projectId ? (root?.name ?? '项目与文件夹') : '资料'
                  }
                  type="button"
                >
                  {projectId ? (root?.name ?? '项目与文件夹') : '资料'}
                </button>
              </TooltipTrigger>
              {/* 远端项目的标题挂着连接提示：空白期里「连的是哪台、在不在连」在这里能查到。 */}
              {remoteRoot && root && (
                <TooltipContent className="px-2.5 py-2" side="bottom">
                  <RemoteConnectionTip
                    activity={activity[root.id]}
                    connection={connections[root.remoteId!]}
                    project={root}
                  />
                </TooltipContent>
              )}
            </Tooltip>
            <div className="flex shrink-0 items-center gap-0.5">
              {/* 远端项目的项目级动作放在 header：端口预览是跟着服务器走的，上传到项目根是
                  最高频的上传场景；往子目录里传仍用目录行右键或拖放（那里才有目录语义）。 */}
              {remoteRoot && rootId && (
                <>
                  <Button
                    aria-label="预览远端端口"
                    className="hover:bg-hover-2"
                    onClick={() => setPortsForProject(rootId)}
                    size="icon-xs"
                    title="预览远端端口"
                    variant="ghost"
                  >
                    <Globe />
                  </Button>
                  <Button
                    aria-label="上传本地文件"
                    className="hover:bg-hover-2"
                    onClick={() => {
                      const directory = root?.path;
                      if (!directory) return;
                      void runEntryWork(async () => {
                        await window.dela!.workspace.uploadRemoteFiles(rootId, directory, null);
                      });
                    }}
                    size="icon-xs"
                    title="上传本地文件到项目根目录"
                    variant="ghost"
                  >
                    <Upload />
                  </Button>
                </>
              )}
              {/* 远端项目没有本地目录，新建/导入的落点只可能是本地路径：入口整个收掉。 */}
              {!remoteRoot && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="新建"
                      className="hover:bg-hover-2"
                      size="icon-xs"
                      title="新建"
                      variant="ghost"
                    >
                      <Plus />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onCloseAutoFocus={afterMenuClose.onCloseAutoFocus}
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        const parentId = container();
                        afterMenuClose.defer(() => startCreate('file', parentId));
                      }}
                    >
                      <FilePlus2 />
                      新建文件
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        const parentId = container();
                        afterMenuClose.defer(() => startCreate('folder', parentId));
                      }}
                    >
                      <FolderPlus />
                      新建文件夹
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => importFromDialog(container())}>
                      <FileInput />
                      导入本地文件
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                aria-label="全部收起"
                className="hover:bg-hover-2"
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
              <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-ink-3" />
              <Input
                aria-label="筛选已同步内容"
                className="h-8 bg-surface pl-7 text-xs"
                onChange={(e) => useTreeState.getState().setQuery(e.target.value)}
                placeholder="筛选已同步内容…"
                value={query}
              />
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
              onDoubleClick={(event) => {
                if (remoteRoot) return;
                if (event.target === event.currentTarget) startCreate('file', container());
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
                  importDroppedAnywhere(Array.from(event.dataTransfer.files), null);
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
                  <div className={eyebrowClass}>同步</div>
                  <div className={sectionClass}>
                    <button
                      aria-expanded={sourcesOpen}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left transition-colors duration-150 hover:text-ink"
                      onClick={() => setCoursesOpen((value) => !value)}
                      type="button"
                    >
                      {chevron(sourcesOpen)}
                      <GraduationCap className="size-4" />
                      课程资料
                    </button>
                    <CanvasDownloadsPanel open={downloadsOpen} onOpenChange={setDownloadsOpen} />
                    <Button
                      aria-label="刷新课程资料"
                      className="hover:bg-hover-2"
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
                          className="hover:bg-hover-2"
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
                        onDownload={downloadCanvas}
                        onExpand={expand}
                        onLink={(id) => onAction('link', id)}
                        onOpen={onOpenDocument}
                        onOpenToSide={onOpenToSide}
                        query={query}
                        selected={activeDocKey}
                      />
                    ) : (
                      <div className="px-4 py-3 text-xs text-ink-3">
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
              <div className={eyebrowClass}>文件</div>
              <ProjectFileTree
                canDrop={(dragId, targetId) => !isDescendant(entries, targetId, dragId)}
                entries={entries}
                expanded={expanded}
                pending={pending}
                onAction={treeAction}
                onExpand={expand}
                onImportFiles={rootId ? importDroppedAnywhere : undefined}
                onMove={remoteRoot ? undefined : move}
                onOpenToSide={openToSide}
                onActivate={keepDocument}
                onRemoteAction={remoteAction}
                onSelect={selectEntry}
                query={query}
                rootId={rootId}
                selected={activeDocKey ?? selected}
              />
            </div>
            {/* 归档固定在侧栏最底部：不随上方滚动区滚动（flex 收尾自然贴底）；与滚动区之间
                用一条极淡 hairline 分界（三区背景层次保持不变，此处作为固定底区的分界）；
                展开后的两棵 archived 树整体限高滚动，避免撑爆侧栏。 */}
            <div className="shrink-0 border-t border-line">
              <button
                aria-expanded={archiveOpen || Boolean(query.trim())}
                className={cn(
                  sectionClass,
                  'w-full transition-colors duration-150 hover:text-ink-2',
                )}
                onClick={() => setArchiveOpen((value) => !value)}
                type="button"
              >
                {chevron(archiveOpen || Boolean(query.trim()))}
                <Archive className="size-4" />
                归档
              </button>
              {(archiveOpen || query.trim()) && (
                <div className="max-h-56 overflow-y-auto pb-1">
                  {projectId === null && (
                    <SourcesTree
                      archived
                      onDownload={downloadCanvas}
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
                </div>
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
      {portsForProject !== null && (
        <RemotePortsDialog
          onClose={() => setPortsForProject(null)}
          open
          projectId={portsForProject}
        />
      )}
    </>
  );
}
