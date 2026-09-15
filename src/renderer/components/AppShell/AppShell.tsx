import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  Copy,
  FolderKanban,
  FolderOpen,
  House,
  Mail,
  Menu,
  Minus,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Resizer } from '../ui/resizer';
import { DelaBrand } from '../ui/dela-brand';
import { ShuiyuanIcon } from '../ui/shuiyuan-icon';
import { cn } from '../../lib/utils';
import { useWorkspace } from '../../features/projects/workspace';
import { zoomLevels, type ZoomPreference } from '../../../shared/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export type ViewId =
  'home' | 'project' | 'sources' | 'mail' | 'timetable' | 'shuiyuan' | 'settings';

/** 窄屏抽屉层级:null 关闭;nav 主导航;mail 邮箱功能层(仅邮箱视图可达)。 */
export type MobileDrawer = 'nav' | 'mail';
type TitleMenuId = 'file' | 'sources' | 'view' | 'help';
type ShuiyuanIconType = typeof ShuiyuanIcon;

const primaryNav: Array<{ id: ViewId; label: string; icon: LucideIcon | ShuiyuanIconType }> = [
  { id: 'home', label: '首页', icon: House },
  { id: 'project', label: '项目', icon: FolderKanban },
  { id: 'sources', label: '资料', icon: FolderOpen },
  { id: 'mail', label: '邮箱', icon: Mail },
  { id: 'timetable', label: '课表', icon: CalendarDays },
  { id: 'shuiyuan', label: '水源', icon: ShuiyuanIcon },
];

/** 侧栏文字随折叠状态淡入/淡出,与宽度过渡同步(参照 Chrome 垂直标签页)。 */
const labelFade = 'transition-opacity duration-200 ease-out';

/** Ctrl/⌘+数字直达的主视图,序号与侧栏 primaryNav 排布一致。 */
const viewShortcuts: Record<string, ViewId> = {
  '1': 'home',
  '2': 'project',
  '3': 'sources',
  '4': 'mail',
  '5': 'timetable',
};

// 快捷键弹窗的按键提示按运行平台显示 Ctrl 或 ⌘。
const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

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
      <span className="text-sm text-foreground/80">{label}</span>
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
    void desktopWindow.getState().then((state) => {
      if (active) setMaximized(state.maximized);
    });
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
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  mobileDrawer?: MobileDrawer | null;
  onMobileDrawerChange?: (drawer: MobileDrawer | null) => void;
  onBack: () => void;
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
  zoom: ZoomPreference;
  onZoomChange: (zoom: ZoomPreference) => void;
  children: ReactNode;
  projectId: string | null;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
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
  projectId,
  onOpenProject,
  onNewProject,
}: AppShellProps) {
  const entries = useWorkspace((state) => state.workspace.entries);
  const drafts = useWorkspace((state) => state.drafts);
  const projects = entries.filter((entry) => entry.kind === 'project');
  const [sidebarWidth, setSidebarWidth] = useState(200);
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
  const hasSaveableNote = Object.values(drafts).some((draft) => Boolean(draft.content.revision));

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

  const navigate = (next: ViewId) => {
    onNavigate(next);
    if (narrow) onMobileDrawerChange?.(next === 'mail' ? 'mail' : null);
  };

  const importFiles = () => {
    if (!window.dela) return;
    void window.dela.workspace
      .importFiles(view === 'project' ? projectId : null)
      .then(() => useWorkspace.getState().refresh())
      .catch(useWorkspace.getState().setError);
  };

  const saveAllNotes = () => {
    void Promise.all(Object.keys(drafts).map((key) => useWorkspace.getState().save(key)));
  };

  // Ctrl/⌘ +/-/0 的缩放步进：在设置页同一组档位间移动，两端保持不动；0 重置。
  const stepZoom = (direction: 1 | -1 | 0) => {
    if (direction === 0) {
      onZoomChange(1);
      return;
    }
    const index = zoomLevels.indexOf(zoom);
    const next = zoomLevels[Math.max(0, Math.min(index + direction, zoomLevels.length - 1))];
    if (next !== undefined) onZoomChange(next);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n' && event.shiftKey) {
        event.preventDefault();
        onNewProject();
      } else if (key === 'o' && !event.shiftKey) {
        event.preventDefault();
        importFiles();
      } else if (key === 's' && !event.shiftKey) {
        event.preventDefault();
        saveAllNotes();
      } else if (!event.shiftKey && (key === '=' || key === '+' || key === '-' || key === '0')) {
        event.preventDefault();
        stepZoom(key === '-' ? -1 : key === '0' ? 0 : 1);
      } else if (!event.shiftKey && (key === ',' || viewShortcuts[key])) {
        event.preventDefault();
        setOpenMenu(null);
        navigate(key === ',' ? 'settings' : viewShortcuts[key]!);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [importFiles, navigate, onNewProject, saveAllNotes, stepZoom]);

  return (
    <div
      className={cn(
        'relative grid h-dvh grid-cols-[var(--sidebar-width)_1px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)] bg-background transition-[grid-template-columns] duration-200 ease-out',
        sidebarResizing && 'transition-none',
      )}
      style={
        {
          '--sidebar-width': narrow || sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <header
        className={cn(
          'col-span-full flex items-center justify-between border-b border-sidebar-border bg-sidebar',
          'user-select-none [-webkit-app-region:drag]',
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
                  className="h-7 min-w-12 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground"
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
                <DropdownMenuItem onSelect={selectMenu(importFiles)}>
                  导入本地文件
                  <DropdownMenuShortcut>Ctrl/⌘O</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!hasSaveableNote} onSelect={selectMenu(saveAllNotes)}>
                  保存所有已打开笔记
                  <DropdownMenuShortcut>Ctrl/⌘S</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => updateMenu('sources', open)}
              open={openMenu === 'sources'}
            >
              <DropdownMenuTrigger asChild>
                <button
                  className="h-7 min-w-12 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground"
                  onPointerEnter={() => hoverMenu('sources')}
                  type="button"
                >
                  资料
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52" sideOffset={6}>
                <DropdownMenuItem onSelect={selectMenu(() => navigate('sources'))}>
                  Canvas 资料
                  <DropdownMenuShortcut>Ctrl/⌘3</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={selectMenu(() => navigate('mail'))}>
                  邮箱
                  <DropdownMenuShortcut>Ctrl/⌘4</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={selectMenu(() => navigate('timetable'))}>
                  课表
                  <DropdownMenuShortcut>Ctrl/⌘5</DropdownMenuShortcut>
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
                  className="h-7 min-w-12 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground"
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
                <DropdownMenuItem onSelect={selectMenu(() => navigate('project'))}>
                  项目
                  <DropdownMenuShortcut>Ctrl/⌘2</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={selectMenu(() => navigate('settings'))}>
                  设置
                  <DropdownMenuShortcut>Ctrl/⌘,</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu
            modal={false}
            onOpenChange={(open) => updateMenu('help', open)}
            open={openMenu === 'help'}
          >
            <DropdownMenuTrigger asChild>
              <button
                className="[-webkit-app-region:no-drag] ml-0.5 grid h-7 min-w-12 shrink-0 place-items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground"
                onPointerEnter={() => hoverMenu('help')}
                type="button"
              >
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
        <WindowControls />
      </header>
      <Dialog.Root onOpenChange={setHelpOpen} open={helpOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-popover p-8 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150 max-md:w-[calc(100%-2rem)] max-md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-lg font-semibold tracking-tight">快捷键</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  以下快捷键在任何界面均直接生效。
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
              <ShortcutSection title="导航">
                <ShortcutRow keys={[modKey, '1']} label="首页" />
                <ShortcutRow keys={[modKey, '2']} label="项目" />
                <ShortcutRow keys={[modKey, '3']} label="Canvas 资料" />
                <ShortcutRow keys={[modKey, '4']} label="邮箱" />
                <ShortcutRow keys={[modKey, '5']} label="课表" />
                <ShortcutRow keys={[modKey, ',']} label="设置" />
              </ShortcutSection>
              <div className="flex flex-col gap-8">
                <ShortcutSection title="通用">
                  <ShortcutRow keys={[modKey, '⇧', 'N']} label="新建项目" />
                  <ShortcutRow keys={[modKey, 'O']} label="导入本地文件" />
                  <ShortcutRow keys={[modKey, 'S']} label="保存所有已打开笔记" />
                  <ShortcutRow keys={[modKey, '=']} label="放大" />
                  <ShortcutRow keys={[modKey, '-']} label="缩小" />
                  <ShortcutRow keys={[modKey, '0']} label="重置缩放" />
                </ShortcutSection>
                <ShortcutSection title="鼠标">
                  <ShortcutRow hint="关闭文档" label="中键点击文档标签" />
                  <ShortcutRow hint="新建笔记" label="双击标签栏或目录空白处" />
                </ShortcutSection>
              </div>
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
          'flex min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-sidebar pb-3 text-sidebar-foreground',
          narrow
            ? cn(
                'animate-in fade-in slide-in-from-left-6 duration-150 absolute bottom-0 left-0 top-10 z-40 w-[280px] max-w-[85vw] border-r border-sidebar-border px-2 shadow-2xl',
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
          style={narrow ? undefined : { width: sidebarWidth }}
        >
          <div className="flex h-11 shrink-0 items-center gap-1.5 px-1">
            <button
              className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-sidebar-accent"
              onClick={() => navigate('home')}
              title="回到首页"
              type="button"
            >
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
            </button>
            <div className="flex-1" />
            <button
              aria-label="搜索"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              title="搜索"
              type="button"
            >
              <Search className="size-4" strokeWidth={1.8} />
            </button>
          </div>
          <nav aria-label="功能导航" className="mt-1 grid gap-0.5">
            {primaryNav.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                  )}
                  key={item.id}
                  onClick={() => navigate(item.id)}
                  type="button"
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    strokeWidth={1.8}
                  />
                  <span className={cn('truncate', labelFade, sidebarCollapsed && 'opacity-0')}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
          <section aria-labelledby="project-nav-title" className="mt-5">
            <div className="flex items-center justify-between px-2 pb-1">
              <span
                id="project-nav-title"
                className={cn(
                  'whitespace-nowrap text-xs font-medium text-muted-foreground',
                  labelFade,
                  sidebarCollapsed && 'opacity-0',
                )}
              >
                项目
              </span>
              <button
                aria-label="新建项目"
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                title="新建项目"
                onClick={() => {
                  onNewProject();
                  if (narrow) onMobileDrawerChange?.(null);
                }}
                type="button"
              >
                <Plus className="size-3.5" strokeWidth={1.8} />
              </button>
            </div>
            <div className="grid gap-0.5">
              {projects.map((project) => {
                const current = view === 'project' && project.id === projectId;
                return (
                  <button
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex h-8 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                      current
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                    )}
                    key={project.id}
                    onClick={() => {
                      onOpenProject(project.id);
                      if (narrow) onMobileDrawerChange?.(null);
                    }}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full bg-muted-foreground"
                    />
                    <span className={cn('truncate', labelFade, sidebarCollapsed && 'opacity-0')}>
                      {project.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          <div className="mt-auto grid gap-0.5 pt-4">
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
          'col-start-2 row-start-2',
          (sidebarCollapsed || narrow) && 'pointer-events-none',
        )}
        label="调整侧边栏宽度"
        max={360}
        min={200}
        onChange={setSidebarWidth}
        onResizingChange={setSidebarResizing}
        value={sidebarWidth}
      />
      {/* relative + id：供页内悬浮面板（如首页历史对话）portal 锚定到内容区。 */}
      <main
        className="relative col-start-3 row-start-2 flex min-w-0 flex-col overflow-hidden bg-background"
        id="app-main"
      >
        {children}
      </main>
    </div>
  );
}
