import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  CodeXml,
  Copy,
  FolderOpen,
  House,
  Menu,
  MessageCirclePlus,
  Minus,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  Square,
  SquareCheckBig,
  SquareTerminal,
  X,
} from 'lucide-react';
import { Resizer } from '../../ui/resizer';
import { useEditorSettings } from '../lib/editor-settings';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { usePreferences } from '../app/preferences';
import { showToast, ToastHost } from '../app/toasts';
import { DelaBrand } from './dela-brand';
import { cn } from '../../ui/cn';
import { useMediaQuery } from '../../ui/use-media-query';
import { fileManagerName, platform } from '../lib/platform';
import type { NavTarget } from '../../app/module';
import { useNavigationStore, type AppView, type ShellView } from '../navigation/view';
import type { MobileDrawer } from '../lib/mobile-drawer';
import { useShortcuts } from '../app/shortcuts';
import { useExplorerState } from '../workbench/explorer-state';
import { useViewportWidth } from '../lib/use-viewport-width';
import {
  ProjectSessionNav,
  type BusinessNavId,
  type NavSessionSummary,
  type SessionRunBadge,
} from '../navigation/ProjectSessionNav';
import { zoomLevels, type ZoomPreference } from '../../shared/api';
import { acceleratorKeys, matchShortcut, shortcutGroups } from '../../shared/keybindings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { drawerFromLeft, fadeIn, overlayFade } from '../../ui/motion';
import { navIcon, navRow } from '../navigation/nav-styles';
import { UpdateBadge } from '../features/settings/UpdateBadge';
import { navEntries, useVisibleNavEntries } from '../navigation/entries';
import { IconButton } from '../../ui/icon-button';
import { workspaceClient } from '../../modules/workspace/view';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';

/** 侧栏文字随折叠状态淡入/淡出,与宽度过渡同步(参照 Chrome 垂直标签页)。 */
const labelFade = 'transition-opacity duration-slow ease-out';

function ShortcutSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium tracking-[0.12em] text-ink-3">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ShortcutRow({ hint, keys, label }: { hint?: string; keys?: string[]; label: string }) {
  return (
    <div className="flex h-9 items-center justify-between gap-8">
      <span className="min-w-0 truncate text-sm text-ink-2">{label}</span>
      {keys ? (
        <span className="flex shrink-0 items-center gap-1">
          {keys.map((key) => (
            <kbd
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-chip bg-field px-1.5 text-xs font-medium text-ink-2 shadow-hairline"
              key={key}
            >
              {key}
            </kbd>
          ))}
        </span>
      ) : (
        <span className="shrink-0 text-sm text-ink-3">{hint}</span>
      )}
    </div>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const desktopWindow = window.dela?.window;
    if (!desktopWindow) return undefined;
    let active = true;
    void desktopWindow
      .getState()
      .then((state) => {
        if (active) setMaximized(state.maximized);
      })
      .catch(() => {});
    const unsubscribe = desktopWindow.onStateChange((state) => setMaximized(state.maximized));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!window.dela || platform === 'mac') return null;

  return (
    <div className="[-webkit-app-region:no-drag] flex h-full">
      <button
        aria-label="最小化"
        className="grid h-full w-12 place-items-center text-ink-2 transition-colors duration-base hover:bg-hover-strong hover:text-ink"
        onClick={() => window.dela?.window.minimize()}
        type="button"
      >
        <Minus className="size-4" strokeWidth={1.8} />
      </button>
      <button
        aria-label={maximized ? '还原' : '最大化'}
        className="grid h-full w-12 place-items-center text-ink-2 transition-colors duration-base hover:bg-hover-strong hover:text-ink"
        onClick={() => window.dela?.window.toggleMaximize()}
        type="button"
      >
        {maximized ? (
          <Copy className="size-3.5" strokeWidth={1.8} />
        ) : (
          <Square className="size-3" strokeWidth={1.8} />
        )}
      </button>
      <button
        aria-label="关闭"
        className="grid h-full w-12 place-items-center text-ink-2 transition-colors duration-base hover:bg-window-close hover:text-on-accent"
        onClick={() => window.dela?.window.close()}
        type="button"
      >
        <X className="size-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}

type AppShellProps = {
  view: AppView;
  onNavigate: (next: ShellView | NavTarget) => void;
  mobileDrawer?: MobileDrawer | null;
  onMobileDrawerChange?: (drawer: MobileDrawer | null) => void;
  onBack: () => void;
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
  zoom: ZoomPreference;
  onZoomChange: (zoom: ZoomPreference) => void;
  children: ReactNode;
  /** 工作台导入目标（当前项目）；无项目时导入到根。 */
  onImportFiles: () => void;
  onNewProject: () => void;
  onSearch: () => void;
  notificationCount: number;
  /** TODO 未读数（readAt === null）：顶栏 TODO 图标据此变蓝，判定同系统通知的 todo 口径。 */
  todoUnreadCount: number;
  sessionsByProject: Record<string, NavSessionSummary[]>;
  runBadge: (sessionId: string) => SessionRunBadge;
  activeSessionId?: string | null;
  projectId: string | null;
  onOpenProject: (id: string) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenGeneralChat: () => void;
  /** 「资料」入口：进入通用（资料）工作台。 */
  onOpenSources: () => void;
  /** 焦点工作组的活动标签是否为会话；通用池内据此互斥高亮「通用聊天/资料」。 */
  activeTabIsChat: boolean;
  onNavigateBusiness: (id: BusinessNavId) => void;
};

export function AppShell({
  view,
  onNavigate,
  mobileDrawer,
  onMobileDrawerChange,
  onBack,
  onForward,
  canBack,
  canForward,
  zoom,
  onZoomChange,
  children,
  onImportFiles,
  onNewProject,
  onSearch,
  notificationCount,
  todoUnreadCount,
  sessionsByProject,
  runBadge,
  activeSessionId = null,
  projectId,
  onOpenProject,
  onOpenSession,
  onDeleteSession,
  onOpenGeneralChat,
  onOpenSources,
  activeTabIsChat,
  onNavigateBusiness,
}: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const bindings = useShortcuts((state) => state.bindings);
  const sidebarCollapsed = usePreferences((state) => state.shellSidebarCollapsed);
  const projectOpenTarget = usePreferences((state) => state.projectOpenTarget);
  const setPreference = usePreferences((state) => state.setPreference);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const narrow = useMediaQuery('(max-width: 767px)');
  const drawer = mobileDrawer ?? null;
  const [helpOpen, setHelpOpen] = useState(false);
  const explorerMobileOpen = useExplorerState((s) => s.mobileOpen);
  const viewportWidth = useViewportWidth();
  // 远端项目的目录在远端：VS Code 是经 Remote-SSH 打开的，文案必须写明，否则会被当成开本地目录。
  const projectIsRemote = useWorkspaceStore(
    (state) => state.workspace.entries.find((item) => item.id === projectId)?.remoteId != null,
  );
  // 远端项目在本地没有目录：资源管理器入口不渲染，快捷图标也只指向 VS Code(SSH)。
  const effectiveOpenTarget: 'vscode' | 'explorer' = projectIsRemote ? 'vscode' : projectOpenTarget;
  const vscodeOpenLabel = projectIsRemote ? '在 VS Code 中打开（SSH）' : '在 VS Code 打开项目';

  // 窄屏双抽屉互斥：两个抽屉都锚定屏幕左侧，叠开会出「点了没反应/凭空出现」的假象。
  // 目录抽屉只在 workbench 视图挂载，互斥也只在该视图生效，避免残留状态误关其他视图的抽屉。
  useEffect(() => {
    if (!narrow || view !== 'workbench' || !explorerMobileOpen || drawer === null) return;
    onMobileDrawerChange?.(null);
  }, [drawer, narrow, view, explorerMobileOpen, onMobileDrawerChange]);
  useEffect(() => {
    if (!narrow || drawer === null) return;
    if (useExplorerState.getState().mobileOpen) useExplorerState.getState().setMobileOpen(false);
  }, [drawer, narrow]);

  // 视口钳制：壳侧栏渲染宽度不超过视口约 28%（下限 200），给内容区保留可用宽度；
  // 用户拖拽偏好保留原值，仅渲染时钳制（与目录侧栏的钳制合计 ≤ 约 56% 视口）。
  const effectiveSidebarWidth = Math.min(
    sidebarWidth,
    Math.max(200, Math.round(viewportWidth * 0.28)),
  );

  // 拉宽窗口,或经后退/前进离开邮箱视图时,收起可能残留的邮箱级抽屉。
  useEffect(() => {
    if (!narrow || (drawer === 'mail' && view !== 'mail')) onMobileDrawerChange?.(null);
  }, [drawer, narrow, onMobileDrawerChange, view]);

  const navHidden = narrow ? drawer === null : sidebarCollapsed;
  const visibleEntries = useVisibleNavEntries();
  /** 「资料」入口高亮：通用池内看文档标签时才算资料（与会话标签互斥）。 */
  const sourcesActive = view === 'workbench' && projectId === null && !activeTabIsChat;

  const openProjectDirectory = (target: 'vscode' | 'explorer') => {
    if (view !== 'workbench' || !projectId || !window.dela) return;
    // 远端项目没有本地目录：入口只留 VS Code(SSH)，这里再兜一层，快捷图标不会掉进必然失败的路径。
    const effective: 'vscode' | 'explorer' = projectIsRemote ? 'vscode' : target;
    if (effective === target) setPreference('projectOpenTarget', target);
    void workspaceClient
      .openProjectDirectory({ id: projectId, target: effective })
      .catch((cause: unknown) => {
        showToast({
          variant: 'error',
          title: '打开项目目录失败',
          description: errorText(cause),
        });
      });
  };

  const navigate = (next: ShellView | NavTarget) => {
    onNavigate(next);
    if (narrow)
      onMobileDrawerChange?.(typeof next !== 'string' && next.page === 'mail' ? 'mail' : null);
  };

  // Ctrl/⌘ +/-/0 的缩放步进：在设置页同一组档位间移动，两端保持不动；0 重置。
  const stepZoom = (direction: 1 | -1 | 0) => {
    if (direction === 0) {
      onZoomChange(1);
      return;
    }
    const index = zoomLevels.indexOf(zoom);
    onZoomChange(zoomLevels[Math.max(0, Math.min(index + direction, zoomLevels.length - 1))]!);
  };

  // 快捷键回调经 ref 取最新值：keydown 监听只注册一次，避免每次渲染重绑。
  const shortcutsRef = useRef({ navigate, onImportFiles, onNewProject, onSearch, stepZoom });
  useEffect(() => {
    shortcutsRef.current = { navigate, onImportFiles, onNewProject, onSearch, stepZoom };
  });
  useEffect(() => {
    // 启动时读取一次用户覆盖的键位（默认值首帧即可用）。
    void useShortcuts.getState().load();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // 动作由键位表解析：用户改键后此处无需改动，未绑定/未命中即不拦截。
      const action = matchShortcut(useShortcuts.getState().bindings, event, 'global', platform);
      if (!action) return;
      const { navigate, onImportFiles, onNewProject, onSearch, stepZoom } = shortcutsRef.current;
      event.preventDefault();
      switch (action) {
        case 'new-project':
          onNewProject();
          break;
        case 'import-files':
          onImportFiles();
          break;
        case 'global-search':
          onSearch();
          break;
        case 'zoom-in':
          stepZoom(1);
          break;
        case 'zoom-out':
          stepZoom(-1);
          break;
        case 'zoom-reset':
          stepZoom(0);
          break;
        case 'toggle-word-wrap':
          useEditorSettings.getState().toggleWordWrap();
          break;
        case 'open-home':
          navigate('home');
          break;
        case 'open-mail':
          navigate({ page: 'mail' });
          break;
        case 'open-timetable':
          navigate({ page: 'timetable' });
          break;
        case 'open-settings':
          navigate('settings');
          break;
        case 'open-shortcuts':
          setHelpOpen(true);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className={cn(
        'relative grid h-dvh grid-cols-[var(--sidebar-width)_0px_1px_minmax(0,1fr)] grid-rows-[env(titlebar-area-height,2.5rem)_minmax(0,1fr)] bg-page text-ink transition-[grid-template-columns] duration-slow ease-(--ease-out-strong)',
        sidebarResizing && 'transition-none',
      )}
      style={
        {
          '--sidebar-width': narrow || sidebarCollapsed ? '0px' : `${effectiveSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <header
        className={cn(
          'col-span-full flex items-center justify-between bg-page',
          'select-none [-webkit-app-region:drag]',
          'pl-[env(titlebar-area-x,0px)] [&_button]:max-h-[env(titlebar-area-height,none)] [&_div]:max-h-[env(titlebar-area-height,none)]',
        )}
      >
        <div className="flex h-full items-center">
          <IconButton
            aria-controls="main-nav"
            aria-expanded={!navHidden}
            aria-label={navHidden ? '展开侧边栏' : '收起侧边栏'}
            className={cn(
              '[-webkit-app-region:no-drag] ml-2',
              !navHidden && 'opacity-70 hover:opacity-100',
            )}
            onClick={() =>
              narrow
                ? onMobileDrawerChange?.(drawer ? null : view === 'mail' ? 'mail' : 'nav')
                : setPreference('shellSidebarCollapsed', !sidebarCollapsed)
            }
            title={navHidden ? '展开侧边栏' : '收起侧边栏'}
          >
            {navHidden ? (
              narrow ? (
                <Menu strokeWidth={1.8} />
              ) : (
                <PanelLeft strokeWidth={1.8} />
              )
            ) : (
              <PanelLeftClose strokeWidth={1.8} />
            )}
          </IconButton>
          <IconButton
            aria-label="后退"
            className="[-webkit-app-region:no-drag] ml-1.5"
            disabled={!canBack}
            onClick={onBack}
            title="后退"
          >
            <ArrowLeft strokeWidth={1.8} />
          </IconButton>
          <IconButton
            aria-label="前进"
            className="[-webkit-app-region:no-drag] ml-0.5"
            disabled={!canForward}
            onClick={onForward}
            title="前进"
          >
            <ArrowRight strokeWidth={1.8} />
          </IconButton>
          {/* 侧栏折叠后首页与功能入口随侧栏隐藏，这里补回可达入口（与侧栏同一份可见性，窄屏由抽屉承载）。 */}
          {!narrow && sidebarCollapsed && (
            <div className="[-webkit-app-region:no-drag] ml-2 flex h-full items-center gap-1">
              <IconButton
                aria-current={view === 'home' ? 'page' : undefined}
                aria-label="首页"

                onClick={onOpenGeneralChat}
                title="首页"
              >
                <House strokeWidth={1.8} />
              </IconButton>
              {visibleEntries.map((item) => {
                const Icon = item.icon;
                const active = item.id === 'sources' ? sourcesActive : view === item.id;
                return (
                  <IconButton
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}

                    key={item.id}
                    onClick={() =>
                      item.id === 'sources' ? onOpenSources() : onNavigateBusiness(item.id)
                    }
                    title={item.label}
                  >
                    <Icon strokeWidth={1.8} />
                  </IconButton>
                );
              })}
              <IconButton
                aria-current={view === 'settings' ? 'page' : undefined}
                aria-label="设置"

                onClick={() => navigate('settings')}
                title="设置"
              >
                <Settings strokeWidth={1.8} />
              </IconButton>
            </div>
          )}
          {/* 更新提示固定排在左侧这一组的最右端：它是状态提示，不属于前进/后退那串导航动作。 */}
          <UpdateBadge />
        </div>
        <div className="flex h-full items-center">
          {/* 侧栏折叠后铃铛/搜索随侧栏隐藏，这里补回可达入口（窄屏由抽屉承载）。 */}
          {!narrow && sidebarCollapsed && (
            <div className="[-webkit-app-region:no-drag] flex h-full items-center gap-1 pr-1">
              <IconButton
                aria-current={view === 'todo' ? 'page' : undefined}
                aria-label={todoUnreadCount > 0 ? `TODO，${todoUnreadCount} 条新消息` : 'TODO'}

                onClick={() => navigate({ page: 'todo' })}
                title="TODO"
              >
                <SquareCheckBig
                  className={cn('size-4', todoUnreadCount > 0 && 'text-accent')}
                  strokeWidth={1.8}
                />
              </IconButton>
              <IconButton
                aria-label={notificationCount > 0 ? `通知，${notificationCount} 条未读` : '通知'}
                aria-current={view === 'notifications' ? 'page' : undefined}
                className="relative"
                onClick={() => navigate({ page: 'notifications' })}
                title="通知"
              >
                <Bell strokeWidth={1.8} />
                {notificationCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 size-1.5 rounded-full bg-accent ring-2 ring-page"
                  />
                )}
              </IconButton>
              <IconButton
                aria-label="搜索"

                onClick={onSearch}
                title="全局搜索 (Ctrl/⌘+K)"
              >
                <Search strokeWidth={1.8} />
              </IconButton>
            </div>
          )}
          {view === 'workbench' && projectId && window.dela && (
            <div className="[-webkit-app-region:no-drag] flex shrink-0 items-center gap-1 px-2">
              <div className="flex h-7 items-center rounded-control shadow-hairline">
                <button
                  aria-label={
                    effectiveOpenTarget === 'vscode'
                      ? vscodeOpenLabel
                      : `在 ${fileManagerName} 中打开项目`
                  }
                  className="grid size-7 place-items-center rounded-l-control text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink"
                  onClick={() => openProjectDirectory(effectiveOpenTarget)}
                  title={
                    effectiveOpenTarget === 'vscode'
                      ? vscodeOpenLabel
                      : `在 ${fileManagerName} 中打开项目`
                  }
                  type="button"
                >
                  {effectiveOpenTarget === 'vscode' ? (
                    <CodeXml className="size-4 text-accent" />
                  ) : (
                    <FolderOpen className="size-4" />
                  )}
                </button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="选择项目打开方式"
                      className="grid h-full w-6 place-items-center rounded-r-control border-l border-line text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink data-[state=open]:bg-selected"
                      title="选择项目打开方式"
                      type="button"
                    >
                      <ChevronDown className="size-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!projectIsRemote && (
                      <DropdownMenuItem onSelect={() => openProjectDirectory('explorer')}>
                        <FolderOpen />
                        {fileManagerName}
                        {effectiveOpenTarget === 'explorer' && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => openProjectDirectory('vscode')}>
                      <CodeXml className="text-accent" />
                      {projectIsRemote ? 'VS Code（SSH）' : 'VS Code'}
                      {effectiveOpenTarget === 'vscode' && <Check className="ml-auto" />}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <IconButton
                aria-label="打开项目终端"

                onClick={() => projectId && useNavigationStore.getState().openTerminal(projectId)}
                title="打开项目终端"
              >
                <SquareTerminal strokeWidth={1.8} />
              </IconButton>
            </div>
          )}
          {/* 资料页（通用工作台）的聊天入口：新对话落为工作台标签，单组分屏、多组进最右组。 */}
          {view === 'workbench' && projectId === null && window.dela && (
            <IconButton
              aria-label="新聊天"
              className="[-webkit-app-region:no-drag] mr-1"
              onClick={() => void useNavigationStore.getState().newChat(null)}
              title="新聊天"
            >
              <MessageCirclePlus strokeWidth={1.8} />
            </IconButton>
          )}
          <WindowControls />
        </div>
      </header>
      <Dialog onOpenChange={setHelpOpen} open={helpOpen}>
        <DialogContent size="xl" scroll className="p-8 max-md:p-6">
          <DialogHeader className="items-start gap-4">
            <div>
              <DialogTitle className="text-lg tracking-tight">快捷键</DialogTitle>
              <DialogDescription>
                与设置 › 快捷键 同源；工作台类快捷键需焦点在工作区内。
              </DialogDescription>
            </div>
            <DialogClose className="-mr-1 -mt-1" />
          </DialogHeader>
          <div className="mt-8 grid items-start gap-x-12 gap-y-8 sm:grid-cols-2">
            {/* 提示按当前生效键位渲染：用户在设置里改键后此处同步。 */}
            {shortcutGroups().map((group) => (
              <ShortcutSection key={group.title} title={group.title}>
                {group.actions.map((action) => {
                  const keys = bindings[action.id]
                    ? acceleratorKeys(bindings[action.id], platform, action.family)
                    : null;
                  return (
                    <ShortcutRow
                      hint={keys ? undefined : '未绑定'}
                      key={action.id}
                      keys={keys ?? undefined}
                      label={action.label}
                    />
                  );
                })}
              </ShortcutSection>
            ))}
            <ShortcutSection title="鼠标">
              <ShortcutRow hint="关闭标签" label="中键点击标签" />
              <ShortcutRow hint="新建文件" label="双击目录空白处" />
            </ShortcutSection>
          </div>
        </DialogContent>
      </Dialog>
      {narrow && drawer !== null && (
        <div
          aria-hidden="true"
          className={cn(overlayFade, 'absolute inset-x-0 bottom-0 top-10 z-scrim bg-scrim')}
          onMouseDown={() => onMobileDrawerChange?.(null)}
        />
      )}
      <aside
        aria-label="主导航"
        className={cn(
          // 滚动收敛在 ProjectSessionNav 内部的单一滚动容器，避免 aside/置顶/项目三层滚动嵌套。
          'flex min-h-0 flex-col overflow-hidden bg-page pb-3 text-ink',
          narrow
            ? cn(
                drawerFromLeft,
                'absolute bottom-0 left-0 top-10 z-overlay w-[17.5rem] max-w-[85vw] px-2 shadow-overlay',
                drawer === null && 'hidden',
              )
            : cn(
                // 收起时延后 invisible,让文字先随宽度动画淡出;w-0 会让内容立即消失。
                'col-start-1 row-start-2 transition-[visibility] duration-0',
                sidebarCollapsed && 'invisible delay-200',
              ),
        )}
        id="main-nav"
      >
        {/* 宽屏内容按目标宽度固定排版:展开/收起动画期间被容器裁剪显示,而非回流换行。 */}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            narrow ? cn('min-w-0', drawer === 'mail' && 'hidden') : 'px-2',
          )}
          style={narrow ? undefined : { width: effectiveSidebarWidth }}
        >
          <div className="flex h-11 shrink-0 items-center gap-1.5 px-1">
            {/* 纯品牌展示；回首页由下方「首页」行承担，避免相邻双入口。 */}
            <div className="flex min-w-0 items-center gap-2 px-1 py-0.5">
              <DelaBrand className="h-[1.125rem] w-auto" />
              <span
                className={cn(
                  'text-base font-semibold tracking-tight text-ink',
                  labelFade,
                  sidebarCollapsed && 'opacity-0',
                )}
              >
                Dela
              </span>
            </div>
            <div className="flex-1" />
            <IconButton
              aria-current={view === 'todo' ? 'page' : undefined}
              aria-label={todoUnreadCount > 0 ? `TODO，${todoUnreadCount} 条新消息` : 'TODO'}

              onClick={() => navigate({ page: 'todo' })}
              title="TODO"
            >
              <SquareCheckBig
                className={cn('size-4', todoUnreadCount > 0 && 'text-accent')}
                strokeWidth={1.8}
              />
            </IconButton>
            <IconButton
              aria-label={notificationCount > 0 ? `通知，${notificationCount} 条未读` : '通知'}
              aria-current={view === 'notifications' ? 'page' : undefined}
              className={cn('relative', view === 'notifications' && 'bg-selected text-ink')}
              onClick={() => navigate({ page: 'notifications' })}
              title="通知"
            >
              <Bell strokeWidth={1.8} />
              {notificationCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-accent ring-2 ring-page"
                />
              )}
            </IconButton>
            <IconButton
              aria-label="搜索"

              onClick={() => {
                onMobileDrawerChange?.(null);
                onSearch();
              }}
              title="全局搜索 (Ctrl/⌘+K)"
            >
              <Search strokeWidth={1.8} />
            </IconButton>
          </div>
          <ProjectSessionNav
            activeBusinessId={navEntries.find((entry) => entry.id === view)?.id ?? null}
            activeProjectId={view === 'workbench' ? projectId : null}
            activeSessionId={view === 'home' ? null : activeSessionId}
            collapsed={!narrow && sidebarCollapsed}
            generalChatActive={view === 'home'}
            onDeleteSession={onDeleteSession}
            onNewChat={(id) => void useNavigationStore.getState().newChat(id)}
            onNavigateBusiness={onNavigateBusiness}
            onNewProject={() => {
              onNewProject();
              if (narrow) onMobileDrawerChange?.(null);
            }}
            onOpenGeneralChat={() => {
              onOpenGeneralChat();
              if (narrow) onMobileDrawerChange?.(null);
            }}
            onOpenProject={(id) => {
              onOpenProject(id);
              if (narrow) onMobileDrawerChange?.(null);
            }}
            onOpenSession={onOpenSession}
            onOpenSources={() => {
              onOpenSources();
              if (narrow) onMobileDrawerChange?.(null);
            }}
            runBadge={runBadge}
            sessionsByProject={sessionsByProject}
            sourcesActive={sourcesActive}
          />
          <div className="grid shrink-0 gap-0.5 pt-2">
            <button
              aria-current={view === 'settings' ? 'page' : undefined}
              className={navRow(view === 'settings')}
              onClick={() => navigate('settings')}
              type="button"
            >
              <Settings className={navIcon(view === 'settings')} strokeWidth={1.8} />
              <span className={cn('truncate', labelFade, sidebarCollapsed && 'opacity-0')}>
                设置
              </span>
            </button>
          </div>
        </div>
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col',
            narrow && drawer === 'mail' ? cn('flex', fadeIn) : 'hidden',
          )}
        >
          <div className="flex h-11 shrink-0 items-center px-1">
            <button
              aria-label="返回主菜单"
              className={navRow(false)}
              onClick={() => onMobileDrawerChange?.('nav')}
              type="button"
            >
              <ChevronLeft className="size-4" strokeWidth={1.8} />
              <span>主菜单</span>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col" id="mail-drawer-slot" />
        </div>
      </aside>
      <Resizer
        className={cn(
          'col-start-3 row-start-2 bg-transparent',
          // 折叠/窄屏时间隔条整体隐藏（网格列为固定 1px，不影响布局）：
          // 仅 pointer-events-none 时键盘仍可聚焦，方向键调整是看不见的假反馈。
          (sidebarCollapsed || narrow) && 'hidden',
        )}
        label="调整侧边栏宽度"
        // 拖拽绑定用户偏好值与原上限：渲染宽度另有视口钳制，若把钳制值当 max，
        // 窄窗下 min==max==value 会把拖拽完全锁死，还会把钳制值写回偏好。
        max={360}
        min={200}
        onChange={setSidebarWidth}
        onResizingChange={setSidebarResizing}
        value={sidebarWidth}
      />
      {/* relative + id：供页内悬浮面板（如会话历史）portal 锚定到内容区。 */}
      {/* 浮岛卡片：标题栏与侧栏同为画布色，内容区以圆角卡片浮在其上，仅保留外圈细边框。
          侧栏不额外预留间隙；分隔线仅占 1px，拖动命中范围由 Resizer 的透明伪元素扩展。 */}
      <main
        className={cn(
          'relative col-start-4 row-start-2 mt-1 mr-1.5 flex min-w-0 flex-col overflow-hidden rounded-t-window bg-surface shadow-hairline',
          'max-md:mt-0 max-md:mr-0 max-md:rounded-none max-md:border-0',
        )}
        id="app-main"
      >
        {children}
        <ToastHost />
      </main>
    </div>
  );
}
