import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppShell, type MobileDrawer, type ViewId } from './components/AppShell';
import { HomeView } from './features/home';
import { MailView } from './features/mail';
import { ProjectView } from './features/projects';
import { SettingsView } from './features/settings';
import { SourcesView } from './features/sources';
import { TimetableView } from './features/timetable';
import { useWorkspace } from './features/projects/workspace';
import type { ThemePreference } from '../shared/api';

const themeStorageKey = 'dela.theme';

function initialTheme(): ThemePreference {
  const theme = localStorage.getItem(themeStorageKey);
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

export default function App() {
  const [view, setView] = useState<ViewId>('home');
  const [backStack, setBackStack] = useState<ViewId[]>([]);
  const [forwardStack, setForwardStack] = useState<ViewId[]>([]);
  const [projectId, setProjectId] = useState<string | null>(() =>
    localStorage.getItem('dela.workspace.project'),
  );
  const [createProject, setCreateProject] = useState(false);
  const [mailComposeDirty, setMailComposeDirty] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawer | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  useEffect(() => {
    void useWorkspace.getState().load();
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);
  useEffect(() => {
    void window.dela?.settings
      .getTheme()
      .then(setTheme)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.values(useWorkspace.getState().drafts).some((draft) => draft.text !== draft.saved))
        event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const openProject = (id: string) => {
    if (!navigate('project')) return;
    setProjectId(id || null);
    localStorage.setItem('dela.workspace.project', id);
  };
  const newProject = () => {
    if (!navigate('project')) return;
    setCreateProject(true);
  };
  const changeTheme = async (next: ThemePreference) => {
    if (!window.dela) {
      setTheme(next);
      return;
    }
    setTheme(await window.dela.settings.setTheme(next));
  };

  // 后退/前进与普通导航共用同一守卫:用户取消确认时导航中止,历史保持不动。
  const leaveMail = (next: ViewId) => {
    if (view !== 'mail' || next === 'mail') return true;
    if (mailComposeDirty && !window.confirm('这封邮件不会保存。确定抛弃并离开吗？')) return false;
    setMailComposeDirty(false);
    return true;
  };

  const navigate = (next: ViewId) => {
    if (next === view) return true;
    if (!leaveMail(next)) return false;
    setBackStack((stack) => [...stack, view]);
    setForwardStack([]);
    setView(next);
    return true;
  };

  const goBack = () => {
    const prev = backStack[backStack.length - 1];
    if (prev === undefined || !leaveMail(prev)) return;
    setBackStack((stack) => stack.slice(0, -1));
    setForwardStack((stack) => [view, ...stack]);
    setView(prev);
  };

  const goForward = () => {
    const next = forwardStack[0];
    if (next === undefined || !leaveMail(next)) return;
    setBackStack((stack) => [...stack, view]);
    setForwardStack((stack) => stack.slice(1));
    setView(next);
  };

  return (
    <AppShell
      canBack={backStack.length > 0}
      canForward={forwardStack.length > 0}
      mobileDrawer={mobileDrawer}
      onBack={goBack}
      onMobileDrawerChange={setMobileDrawer}
      onForward={goForward}
      onNavigate={navigate}
      view={view}
      projectId={projectId}
      onOpenProject={openProject}
      onNewProject={newProject}
    >
      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex min-h-0 flex-1 flex-col"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0, y: 4 }}
            key={view}
            transition={{ duration: 0.16 }}
          >
            {view === 'home' && (
              <HomeView
                onOpenProject={openProject}
                onNewProject={newProject}
                onOpenSources={() => navigate('sources')}
              />
            )}
            {view === 'project' && (
              <ProjectView
                projectId={projectId}
                onOpenProject={openProject}
                createRequested={createProject}
                onCreateHandled={() => setCreateProject(false)}
              />
            )}
            {view === 'sources' && <SourcesView onOpenProject={openProject} />}
            {view === 'mail' && (
              <MailView
                mobileDrawerOpen={mobileDrawer === 'mail'}
                onComposeDirtyChange={setMailComposeDirty}
                onMobileDrawerClose={() => setMobileDrawer(null)}
              />
            )}
            {view === 'timetable' && <TimetableView />}
            {view === 'settings' && (
              <SettingsView
                onThemeChange={changeTheme}
                onOpenMail={() => navigate('mail')}
                onOpenTimetable={() => navigate('timetable')}
                theme={theme}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    </AppShell>
  );
}
