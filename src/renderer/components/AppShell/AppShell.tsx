import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
import { cn } from '../../lib/utils';
import delaLogo from '../../../../assets/Dela_Logo.png';

export type ViewId = 'home' | 'project' | 'sources' | 'mail' | 'timetable' | 'settings';

/** 窄屏抽屉层级:null 关闭;nav 主导航;mail 邮箱功能层(仅邮箱视图可达)。 */
export type MobileDrawer = 'nav' | 'mail';

const primaryNav: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'home', label: '首页', icon: House },
  { id: 'project', label: '项目', icon: FolderKanban },
  { id: 'sources', label: '资料', icon: FolderOpen },
  { id: 'mail', label: '邮箱', icon: Mail },
  { id: 'timetable', label: '课表', icon: CalendarDays },
];

const projects: Array<{ name: string; tone: string; current?: boolean }> = [
  { name: '机器学习 Lab 1', tone: 'bg-amber-500', current: true },
  { name: '毕业设计', tone: 'bg-emerald-500' },
  { name: '暑研申请', tone: 'bg-sky-500' },
];

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
  children: ReactNode;
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
  children,
}: AppShellProps) {
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
          <button
            className="[-webkit-app-region:no-drag] ml-0.5 grid h-7 shrink-0 place-items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            type="button"
          >
            帮助
          </button>
        </div>
        <WindowControls />
      </header>
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
            : cn('col-start-1 row-start-2 px-2', sidebarCollapsed && 'invisible w-0 px-0'),
        )}
        id="main-nav"
      >
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            narrow && drawer === 'mail' && 'hidden',
          )}
        >
          <div className="flex h-11 shrink-0 items-center gap-1.5 px-1">
            <button
              className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-sidebar-accent"
              onClick={() => navigate('home')}
              title="回到首页"
              type="button"
            >
              <img alt="Dela" className="h-[18px] w-auto" src={delaLogo} />
              <span className="text-[15px] font-semibold tracking-tight">Dela</span>
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
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <section aria-labelledby="project-nav-title" className="mt-5">
            <div className="flex items-center justify-between px-2 pb-1">
              <span id="project-nav-title" className="text-xs font-medium text-muted-foreground">
                项目
              </span>
              <button
                aria-label="新建项目"
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                title="新建项目"
                type="button"
              >
                <Plus className="size-3.5" strokeWidth={1.8} />
              </button>
            </div>
            <div className="grid gap-0.5">
              {projects.map((project) => {
                const current = view === 'project' && project.current;
                return (
                  <button
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex h-8 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                      current
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                    )}
                    key={project.name}
                    onClick={() => project.current && navigate('project')}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-2 shrink-0 rounded-full', project.tone)}
                    />
                    <span className="truncate">{project.name}</span>
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
              <span className="truncate">设置</span>
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
      <main className="col-start-3 row-start-2 flex min-w-0 flex-col overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
