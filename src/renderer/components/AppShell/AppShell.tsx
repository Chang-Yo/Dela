import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  Copy,
  Menu,
  Minus,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  Square,
  X,
} from 'lucide-react';
import { Resizer } from '../ui/resizer';
import { useEditorSettings } from '../../content/editor-settings';
import { DelaBrand } from '../ui/dela-brand';
import { cn } from '../../lib/utils';
import { useNavigationStore, type AppView, type MobileDrawer } from '../../app/navigation';
import { useShortcuts } from '../../app/shortcuts';
import { useExplorerState, useViewportWidth } from '../../workbench/explorer-state';
import {
  ProjectSessionNav,
  type BusinessNavId,
  type NavSessionSummary,
  type SessionRunBadge,
} from '../../navigation/ProjectSessionNav';
import { zoomLevels, type ZoomPreference } from '../../../shared/api';
import { acceleratorKeys, matchShortcut, shortcutGroups } from '../../../shared/keybindings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/** 窄屏抽屉层级:null 关闭;nav 主导航;mail 邮箱功能层(仅邮箱视图可达)。 */
type TitleMenuId = 'file' | 'view' | 'help';

/** 侧栏文字随折叠状态淡入/淡出,与宽度过渡同步(参照 Chrome 垂直标签页)。 */
const labelFade = 'transition-opacity duration-200 ease-out';

// 快捷键提示按运行平台显示 ⌘ 或 Ctrl（键位串里的 Mod 由 acceleratorKeys 展开）。
const platform = /Mac|iPhone|iPad/.test(navigator.platform) ? ('mac' as const) : ('other' as const);

/** 标题栏菜单（文件/视图/帮助）触发按钮的共用样式。 */
const titleMenuButtonClass =
  'h-7 min-w-12 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground';

function ShortcutSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium tracking-[0.12em] text-muted-foreground">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ShortcutRow({ hint, keys, label }: { hint?: string; keys?: string[]; label: string }) {
  return (
    <div className="flex h-9 items-center justify-between gap-8">
      <span className="min-w-0 truncate text-sm text-foreground/80">{label}</span>
      {keys ? (
        <span className="flex shrink-0 items-center gap-1">
          {keys.map((key) => (
            <kbd
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border bg-muted/50 px-1.5 text-xs font-medium text-foreground/80"
              key={key}
            >
              {key}
            </kbd>
          ))}
        </span>
      ) : (
        <span className="shrink-0 text-sm text-muted-foreground">{hint}</span>
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

  if (!window.dela) return null;

  return (
    <div className="[-webkit-app-region:no-drag] flex h-full">
      <button
        aria-label="最小化"
        className="grid h-full w-12 place-items-center text-foreground/70 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => window.dela?.window.minimize()}
        type="button"
      >
        <Minus className="size-4" strokeWidth={1.8} />
      </button>
      <button
        aria-label={maximized ? '还原' : '最大化'}
        className="grid h-full w-12 place-items-center text-foreground/70 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
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
        className="grid h-full w-12 place-items-center text-foreground/70 transition-colors hover:bg-[#e81123] hover:text-white"
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
  onNavigate: (view: AppView) => void;
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
  /** 项目会话导航（sessions/runs 镜像数据与跳转回调由 App 装配后传入）。 */
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
  const wordWrap = useEditorSettings((state) => state.wordWrap);
  const bindings = useShortcuts((state) => state.bindings);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('dela.shell.sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const drawer = mobileDrawer ?? null;
  const [helpOpen, setHelpOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<TitleMenuId | null>(null);
  const explorerMobileOpen = useExplorerState((s) => s.mobileOpen);
  const viewportWidth = useViewportWidth();

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

  useEffect(() => {
    try {
      localStorage.setItem('dela.shell.sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // 窄屏下侧边栏是覆盖式抽屉,由左上角菜单按钮控制;宽屏沿用完全折叠。
  // 拉宽窗口,或经后退/前进离开邮箱视图时,收起可能残留的邮箱级抽屉。
  useEffect(() => {
    if (!narrow || (drawer === 'mail' && view !== 'mail')) onMobileDrawerChange?.(null);
  }, [drawer, narrow, onMobileDrawerChange, view]);

  const navHidden = narrow ? drawer === null : sidebarCollapsed;

  const navigate = (next: AppView) => {
    onNavigate(next);
    if (narrow) onMobileDrawerChange?.(next === 'mail' ? 'mail' : null);
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

  const updateMenu = (menu: TitleMenuId, open: boolean) => {
    setOpenMenu((current) => (open ? menu : current === menu ? null : current));
  };

  const hoverMenu = (menu: TitleMenuId) => {
    setOpenMenu((current) => (current === null ? null : menu));
  };

  const selectMenu = (action: () => void) => () => {
    setOpenMenu(null);
    action();
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
      const action = matchShortcut(useShortcuts.getState().bindings, event, 'global');
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
          setOpenMenu(null);
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
          navigate('mail');
          break;
        case 'open-timetable':
          navigate('timetable');
          break;
        case 'open-settings':
          navigate('settings');
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className={cn(
        'relative grid h-dvh grid-cols-[var(--sidebar-width)_0px_1px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)] bg-sidebar transition-[grid-template-columns] duration-200 ease-out',
        sidebarResizing && 'transition-none',
      )}
      style={
        {
          '--sidebar-width':
            narrow || sidebarCollapsed ? '0px' : `${effectiveSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <header
        className={cn(
          'col-span-full flex items-center justify-between bg-sidebar',
          'select-none [-webkit-app-region:drag]',
        )}
      >
        <div className="flex h-full items-center">
          <button
            aria-controls="main-nav"
            aria-expanded={!navHidden}
            aria-label={navHidden ? '展开侧边栏' : '收起侧边栏'}
            className={cn(
              '[-webkit-app-region:no-drag] ml-2 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
              !navHidden && 'opacity-70 hover:opacity-100',
            )}
            onClick={() =>
              narrow
                ? onMobileDrawerChange?.(drawer ? null : view === 'mail' ? 'mail' : 'nav')
                : setSidebarCollapsed((value) => !value)
            }
            title={navHidden ? '展开侧边栏' : '收起侧边栏'}
            type="button"
          >
            {navHidden ? (
              narrow ? (
                <Menu className="size-4" strokeWidth={1.8} />
              ) : (
                <PanelLeft className="size-4" strokeWidth={1.8} />
              )
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.8} />
            )}
          </button>
          <button
            aria-label="后退"
            className="[-webkit-app-region:no-drag] ml-1.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-40"
            disabled={!canBack}
            onClick={onBack}
            title="后退"
            type="button"
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
          </button>
          <button
            aria-label="前进"
            className="[-webkit-app-region:no-drag] ml-0.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-40"
            disabled={!canForward}
            onClick={onForward}
            title="前进"
            type="button"
          >
            <ArrowRight className="size-4" strokeWidth={1.8} />
          </button>
          <div className="[-webkit-app-region:no-drag] ml-2 hidden h-full items-center gap-0.5 md:flex">
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => updateMenu('file', open)}
              open={openMenu === 'file'}
            >
              <DropdownMenuTrigger asChild>
                <button
                  className={titleMenuButtonClass}
                  onPointerEnter={() => hoverMenu('file')}
                  type="button"
                >
                  文件
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52" sideOffset={6}>
                <DropdownMenuItem onSelect={selectMenu(onNewProject)}>
                  新建项目
                  <DropdownMenuShortcut>Ctrl/⌘⇧N</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={selectMenu(onImportFiles)}>
                  导入本地文件
                  <DropdownMenuShortcut>Ctrl/⌘O</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => updateMenu('view', open)}
              open={openMenu === 'view'}
            >
              <DropdownMenuTrigger asChild>
                <button
                  className={titleMenuButtonClass}
                  onPointerEnter={() => hoverMenu('view')}
                  type="button"
                >
                  视图
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52" sideOffset={6}>
                <DropdownMenuItem onSelect={selectMenu(() => navigate('home'))}>
                  首页
                  <DropdownMenuShortcut>Ctrl/⌘1</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={selectMenu(() => navigate('mail'))}>
                  邮箱
                  <DropdownMenuShortcut>Ctrl/⌘2</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={selectMenu(() => navigate('timetable'))}>
                  课表
                  <DropdownMenuShortcut>Ctrl/⌘3</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  role="menuitemcheckbox"
                  aria-checked={wordWrap}
                  onSelect={selectMenu(() => useEditorSettings.getState().toggleWordWrap())}
                >
                  <Check className={cn('size-4', !wordWrap && 'invisible')} />
                  自动换行
                  <DropdownMenuShortcut>Alt+Z</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={selectMenu(() => navigate('settings'))}>
                  设置
                  <DropdownMenuShortcut>Ctrl/⌘,</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* 窄窗口下与文件/视图菜单一并隐藏；帮助内容在设置中都有入口。 */}
          <div className="[-webkit-app-region:no-drag] ml-0.5 hidden shrink-0 md:block">
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => updateMenu('help', open)}
              open={openMenu === 'help'}
            >
              <DropdownMenuTrigger asChild>
                <button className={titleMenuButtonClass} onPointerEnter={() => hoverMenu('help')} type="button">
                  帮助
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52" sideOffset={6}>
                <DropdownMenuItem onSelect={selectMenu(() => setHelpOpen(true))}>
                  快捷键
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={selectMenu(() => navigate('settings'))}>
                  设置与关于
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex h-full items-center">
          {/* 各视图经 portal 往这里挂工作区级动作（目录/布局），挂在窗口控制按钮左侧。 */}
          <div
            id="titlebar-actions"
            className="[-webkit-app-region:no-drag] flex h-full items-center gap-1"
          />
          {/* 侧栏折叠后铃铛/搜索随侧栏隐藏，这里补回可达入口（窄屏由抽屉承载）。 */}
          {!narrow && sidebarCollapsed && (
            <div className="[-webkit-app-region:no-drag] flex h-full items-center gap-1 pr-1">
              <button
                aria-label={notificationCount > 0 ? `通知，${notificationCount} 条未读` : '通知'}
                aria-current={view === 'notifications' ? 'page' : undefined}
                className="relative grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                onClick={() => navigate('notifications')}
                title="通知"
                type="button"
              >
                <Bell className="size-4" strokeWidth={1.8} />
                {notificationCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
                  />
                )}
              </button>
              <button
                aria-label="搜索"
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                onClick={onSearch}
                title="全局搜索 (Ctrl/⌘+K)"
                type="button"
              >
                <Search className="size-4" strokeWidth={1.8} />
              </button>
            </div>
          )}
          <WindowControls />
        </div>
      </header>
      <Dialog.Root onOpenChange={setHelpOpen} open={helpOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-popover p-8 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150 max-md:w-[calc(100%-2rem)] max-md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-lg font-semibold tracking-tight">快捷键</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  与设置 › 快捷键 同源；工作台类快捷键需焦点在工作区内。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="关闭"
                  className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  type="button"
                >
                  <X className="size-4" strokeWidth={1.8} />
                </button>
              </Dialog.Close>
            </div>
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
                <ShortcutRow hint="新建笔记" label="双击目录空白处" />
              </ShortcutSection>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {narrow && drawer !== null && (
        <div
          aria-hidden="true"
          className="animate-in fade-in duration-150 absolute inset-x-0 bottom-0 top-10 z-30 bg-black/30"
          onMouseDown={() => onMobileDrawerChange?.(null)}
        />
      )}
      <aside
        aria-label="主导航"
        className={cn(
          // 滚动收敛在 ProjectSessionNav 内部的单一滚动容器，避免 aside/置顶/项目三层滚动嵌套。
          'flex min-h-0 flex-col overflow-hidden bg-sidebar pb-3 text-sidebar-foreground',
          narrow
            ? cn(
                'animate-in fade-in slide-in-from-left-6 duration-150 absolute bottom-0 left-0 top-10 z-40 w-[280px] max-w-[85vw] px-2 shadow-xl',
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
              <DelaBrand className="h-[18px] w-auto" />
              <span
                className={cn(
                  'text-[15px] font-semibold tracking-tight',
                  labelFade,
                  sidebarCollapsed && 'opacity-0',
                )}
              >
                Dela
              </span>
            </div>
            <div className="flex-1" />
            <button
              aria-label={notificationCount > 0 ? `通知，${notificationCount} 条未读` : '通知'}
              aria-current={view === 'notifications' ? 'page' : undefined}
              className={cn(
                'relative grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
                view === 'notifications' && 'bg-sidebar-accent text-foreground',
              )}
              onClick={() => navigate('notifications')}
              title="通知"
              type="button"
            >
              <Bell className="size-4" strokeWidth={1.8} />
              {notificationCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
                />
              )}
            </button>
            <button
              aria-label="搜索"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              onClick={() => {
                onMobileDrawerChange?.(null);
                onSearch();
              }}
              title="全局搜索 (Ctrl/⌘+K)"
              type="button"
            >
              <Search className="size-4" strokeWidth={1.8} />
            </button>
          </div>
          <ProjectSessionNav
            activeBusinessId={
              view === 'mail' || view === 'timetable' || view === 'shuiyuan' || view === 'todo'
                ? view
                : null
            }
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
            sourcesActive={view === 'workbench' && projectId === null && !activeTabIsChat}
          />
          <div className="grid shrink-0 gap-0.5 pt-2">
            <button
              aria-current={view === 'settings' ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                view === 'settings'
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}
              onClick={() => navigate('settings')}
              type="button"
            >
              <Settings
                className={cn(
                  'size-4 shrink-0',
                  view === 'settings' ? 'text-foreground' : 'text-muted-foreground',
                )}
                strokeWidth={1.8}
              />
              <span className={cn('truncate', labelFade, sidebarCollapsed && 'opacity-0')}>
                设置
              </span>
            </button>
          </div>
        </div>
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col',
            narrow && drawer === 'mail' ? 'flex animate-in fade-in duration-150' : 'hidden',
          )}
        >
          <div className="flex h-11 shrink-0 items-center px-1">
            <button
              aria-label="返回主菜单"
              className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
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
        max={Math.min(360, Math.max(200, effectiveSidebarWidth))}
        min={200}
        onChange={setSidebarWidth}
        onResizingChange={setSidebarResizing}
        value={effectiveSidebarWidth}
      />
      {/* relative + id：供页内悬浮面板（如会话历史）portal 锚定到内容区。 */}
      {/* 浮岛卡片：标题栏与侧栏同为画布色，内容区以圆角卡片浮在其上，仅保留外圈细边框。
          侧栏不额外预留间隙；分隔线仅占 1px，拖动命中范围由 Resizer 的透明伪元素扩展。 */}
      <main
        className={cn(
          'relative col-start-4 row-start-2 mt-1.5 mr-1.5 flex min-w-0 flex-col overflow-hidden rounded-t-xl border border-b-0 border-border/70 bg-background shadow-xs',
          'max-md:mt-0 max-md:mr-0 max-md:rounded-none max-md:border-0',
        )}
        id="app-main"
      >
        {children}
      </main>
    </div>
  );
}
