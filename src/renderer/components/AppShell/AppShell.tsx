import clsx from 'clsx';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { StatusDot } from '../StatusDot';
import delaLogo from '../../../../assets/Dela_Logo.png';
import {
  CalendarDays,
  FolderKanban,
  FolderOpen,
  House,
  Mail,
  Plus,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import styles from './AppShell.module.css';

export type ViewId = 'home' | 'project' | 'sources' | 'mail' | 'timetable' | 'settings';

const primaryNav: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'home', label: '首页', icon: House },
  { id: 'project', label: '项目', icon: FolderKanban },
  { id: 'sources', label: '资料', icon: FolderOpen },
  { id: 'mail', label: '邮箱', icon: Mail },
  { id: 'timetable', label: '课表', icon: CalendarDays },
];

const projects: Array<{ name: string; tone: 'amber' | 'green' | 'blue'; current?: boolean }> = [
  { name: '机器学习 Lab 1', tone: 'amber', current: true },
  { name: '毕业设计', tone: 'green' },
  { name: '暑研申请', tone: 'blue' },
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
    <div className={styles.windowControls}>
      <button
        aria-label="最小化"
        className={styles.windowButton}
        onClick={() => window.dela?.window.minimize()}
        type="button"
      >
        –
      </button>
      <button
        aria-label={maximized ? '还原' : '最大化'}
        className={styles.windowButton}
        onClick={() => window.dela?.window.toggleMaximize()}
        type="button"
      >
        {maximized ? '⧉' : '□'}
      </button>
      <button
        aria-label="关闭"
        className={clsx(styles.windowButton, styles.closeButton)}
        onClick={() => window.dela?.window.close()}
        type="button"
      >
        ✕
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
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  const resizeSidebar = (event: PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    setSidebarWidth(Math.min(360, Math.max(184, start.width + event.clientX - start.x)));
  };

  return (
    <div
      className={clsx(styles.appShell, sidebarCollapsed && styles.isSidebarCollapsed)}
      style={{ '--sidebar-width': `${sidebarCollapsed ? 0 : sidebarWidth}px` } as CSSProperties}
    >
      <div className={styles.titleBar}>
        <button
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          className={styles.titleBarBrand}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          type="button"
        >
          <img alt="" className={styles.titleBarLogo} src={delaLogo} />
          <span className={styles.titleBarLabel}>Dela</span>
        </button>
        <WindowControls />
      </div>
      <aside className={clsx(styles.sidebar, sidebarCollapsed && styles.isCollapsed)}>
        <nav aria-label="主导航" className={styles.primaryNav}>
          {primaryNav.map((item) =>
            (() => {
              const Icon = item.icon;
              return (
                <button
                  className={clsx(styles.navItem, view === item.id && styles.isActive)}
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.navIcon}>
                    <Icon size={18} strokeWidth={1.7} />
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })(),
          )}
        </nav>
        <section aria-labelledby="project-nav-title" className={styles.projectNav}>
          <div className={styles.sectionLabelRow}>
            <span id="project-nav-title">项目</span>
            <button
              aria-label="新建项目"
              className={styles.iconButton}
              title="新建项目"
              type="button"
            >
              <Plus size={16} strokeWidth={1.8} />
            </button>
          </div>
          {projects.map((project) => (
            <button
              className={clsx(
                styles.projectLink,
                view === 'project' && project.current && styles.isCurrent,
              )}
              key={project.name}
              onClick={() => project.current && onNavigate('project')}
              type="button"
            >
              <StatusDot tone={project.tone} />
              {project.name}
            </button>
          ))}
        </section>
        <div className={styles.sidebarFooter}>
          <button className={styles.navItem} onClick={() => onNavigate('settings')} type="button">
            <span aria-hidden="true" className={styles.navIcon}>
              <Settings size={18} strokeWidth={1.7} />
            </span>
            <span>设置</span>
          </button>
        </div>
      </aside>
      <div
        aria-label="调整侧边栏宽度"
        className={styles.sidebarResizeHandle}
        onPointerDown={(event) => {
          resizeStart.current = { x: event.clientX, width: sidebarWidth };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={resizeSidebar}
        onPointerUp={(event) => {
          resizeStart.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        role="separator"
        tabIndex={0}
      />
      <main className={styles.workspace}>{children}</main>
    </div>
  );
}
