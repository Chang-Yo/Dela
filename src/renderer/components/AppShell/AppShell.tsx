import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { StatusDot } from '../StatusDot';
import styles from './AppShell.module.css';

export type ViewId = 'home' | 'project' | 'sources' | 'settings';

const primaryNav: Array<{ id: ViewId; label: string; icon: string }> = [
  { id: 'home', label: '首页', icon: '⌂' },
  { id: 'project', label: '项目', icon: '□' },
  { id: 'sources', label: '资料', icon: '◇' },
];

const projects: Array<{ name: string; tone: 'amber' | 'green' | 'blue'; current?: boolean }> = [
  { name: '机器学习 Lab 1', tone: 'amber', current: true },
  { name: '毕业设计', tone: 'green' },
  { name: '暑研申请', tone: 'blue' },
];

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let active = true;
    void window.dela.window.getState().then((state) => {
      if (active) setMaximized(state.maximized);
    });
    const unsubscribe = window.dela.window.onStateChange((state) => setMaximized(state.maximized));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <div className={styles.windowControls}>
      <button
        aria-label="最小化"
        className={styles.windowButton}
        onClick={() => window.dela.window.minimize()}
        type="button"
      >
        –
      </button>
      <button
        aria-label={maximized ? '还原' : '最大化'}
        className={styles.windowButton}
        onClick={() => window.dela.window.toggleMaximize()}
        type="button"
      >
        {maximized ? '⧉' : '□'}
      </button>
      <button
        aria-label="关闭"
        className={clsx(styles.windowButton, styles.closeButton)}
        onClick={() => window.dela.window.close()}
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
  return (
    <div className={styles.appShell}>
      <div className={styles.titleBar}>
        <span className={styles.titleBarLabel}>Dela</span>
        <WindowControls />
      </div>
      <aside className={styles.sidebar}>
        <div className={styles.brandRow}>
          <span aria-hidden="true" className={styles.brandMark}>
            D
          </span>
          <span className={styles.brandName}>Dela</span>
        </div>
        <nav aria-label="主导航" className={styles.primaryNav}>
          {primaryNav.map((item) => (
            <button
              className={clsx(styles.navItem, view === item.id && styles.isActive)}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <span aria-hidden="true" className={styles.navIcon}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <section aria-labelledby="project-nav-title" className={styles.projectNav}>
          <div className={styles.sectionLabelRow}>
            <span id="project-nav-title">项目</span>
            <button className={styles.iconButton} title="新建项目" type="button">
              ＋
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
              ⚙
            </span>
            <span>设置</span>
          </button>
          <div className={styles.syncState}>
            <StatusDot glow size="sm" />
            本地数据可用
          </div>
        </div>
      </aside>
      <main className={styles.workspace}>{children}</main>
    </div>
  );
}
