import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  CalendarDays,
  Copy,
  FolderKanban,
  FolderOpen,
  House,
  Mail,
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
import { cn } from '../../lib/utils';
import delaLogo from '../../../../assets/Dela_Logo.png';

export type ViewId = 'home' | 'project' | 'sources' | 'mail' | 'timetable' | 'settings';

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
  children: ReactNode;
};

export function AppShell({ view, onNavigate, children }: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  const resizeSidebar = (event: PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    setSidebarWidth(Math.min(360, Math.max(200, start.width + event.clientX - start.x)));
  };

  return (
    <div
      className={cn(
        'grid h-dvh grid-cols-[var(--sidebar-width)_6px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)] bg-background transition-[grid-template-columns] duration-200 ease-out',
        sidebarResizing && 'transition-none',
      )}
      style={{ '--sidebar-width': `${sidebarCollapsed ? 0 : sidebarWidth}px` } as CSSProperties}
    >
      <header
        className={cn(
          'col-span-full flex items-center justify-between border-b border-sidebar-border bg-sidebar',
          'user-select-none [-webkit-app-region:drag]',
        )}
      >
        <div className="flex h-full items-center">
          <button
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            className={cn(
              '[-webkit-app-region:no-drag] ml-2 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
              !sidebarCollapsed && 'opacity-70 hover:opacity-100',
            )}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            type="button"
          >
            {sidebarCollapsed ? (
              <PanelLeft className="size-4" strokeWidth={1.8} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.8} />
            )}
          </button>
        </div>
        <WindowControls />
      </header>
      <aside
        aria-label="主导航"
        className={cn(
          'col-start-1 row-start-2 flex min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-sidebar pb-3 text-sidebar-foreground',
          sidebarCollapsed ? 'invisible w-0 px-0' : 'px-2',
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-1.5 px-1">
          <button
            className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-sidebar-accent"
            onClick={() => onNavigate('home')}
            title="回到首页"
            type="button"
          >
            <img alt="" className="h-[18px] w-auto" src={delaLogo} />
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
                className={cn(
                  'flex h-8 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                )}
                key={item.id}
                onClick={() => onNavigate(item.id)}
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
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
                    current
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                  )}
                  key={project.name}
                  onClick={() => project.current && onNavigate('project')}
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
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
              view === 'settings'
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            )}
            onClick={() => onNavigate('settings')}
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
      </aside>
      <div
        aria-label="调整侧边栏宽度"
        className={cn(
          'col-start-2 row-start-2 cursor-ew-resize touch-none',
          sidebarCollapsed && 'pointer-events-none',
        )}
        onPointerDown={(event) => {
          resizeStart.current = { x: event.clientX, width: sidebarWidth };
          setSidebarResizing(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={resizeSidebar}
        onPointerUp={(event) => {
          resizeStart.current = null;
          setSidebarResizing(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        role="separator"
        tabIndex={-1}
      />
      <main className="col-start-3 row-start-2 flex min-w-0 flex-col overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
