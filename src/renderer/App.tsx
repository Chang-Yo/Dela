import { leaveComposer } from './features/mail/compose-close';
import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppShell, type MobileDrawer, type ViewId } from './components/AppShell';
import { HomeView } from './features/home';
import { MailView } from './features/mail';
import { FirstLaunchSplash } from './features/onboarding/FirstLaunchSplash';
import { ProjectView } from './features/projects';
import { SettingsView } from './features/settings';
import { ShuiyuanView } from './features/shuiyuan';
import { SourcesView } from './features/sources';
import { TimetableView } from './features/timetable';
import { useWorkspace } from './features/projects/workspace';
import {
  fontScaleLevels,
  type FontScalePreference,
  type ThemePreference,
  type ZoomPreference,
} from '../shared/api';

const themeStorageKey = 'dela.theme';
const fontScaleStorageKey = 'dela.font-scale';

function initialTheme(): ThemePreference {
  const theme = localStorage.getItem(themeStorageKey);
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

// 与主题同理：localStorage 缓存避免启动瞬间回退默认字号。
function initialFontScale(): FontScalePreference {
  const value = Number(localStorage.getItem(fontScaleStorageKey));
  return (fontScaleLevels as readonly number[]).includes(value)
    ? (value as FontScalePreference)
    : 1;
}

export default function App() {
  const [view, setView] = useState<ViewId>('home');
  const [backStack, setBackStack] = useState<ViewId[]>([]);
  const [forwardStack, setForwardStack] = useState<ViewId[]>([]);
  const [projectId, setProjectId] = useState<string | null>(() =>
    localStorage.getItem('dela.workspace.project'),
  );
  const [createProject, setCreateProject] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawer | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [zoom, setZoom] = useState<ZoomPreference>(1);
  const [fontScale, setFontScale] = useState<FontScalePreference>(initialFontScale);
  useEffect(() => {
    void useWorkspace.getState().load();
    return window.dela?.workspace.onChatUpdate((_scope, chat) => {
      if (chat.running) return;
      const store = useWorkspace.getState();
      void store.refresh().catch(store.setError);
      void window.dela?.canvas.getState().then(store.setCanvas).catch(store.setError);
      for (const [id, draft] of Object.entries(store.drafts)) {
        if (draft.text === draft.saved) void store.read(id, true).catch(store.setError);
      }
    });
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale));
    localStorage.setItem(fontScaleStorageKey, String(fontScale));
  }, [fontScale]);
  // 浏览器预览没有主进程缩放，用 CSS zoom 降级；桌面端由主进程 setZoomFactor 生效。
  useEffect(() => {
    if (!window.dela) document.documentElement.style.zoom = String(zoom);
  }, [zoom]);
  useEffect(() => {
    void window.dela?.settings
      .getTheme()
      .then(setTheme)
      .catch(() => {});
    void window.dela?.settings
      .getZoom()
      .then(setZoom)
      .catch(() => {});
    void window.dela?.settings
      .getFontScale()
      .then(setFontScale)
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
    if (!leaveComposer(() => openProject(id))) return;
    if (!navigate('project')) return;
    setProjectId(id || null);
    localStorage.setItem('dela.workspace.project', id);
  };
  const newProject = () => {
    if (!leaveComposer(newProject)) return;
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

  const changeZoom = async (next: ZoomPreference) => {
    if (!window.dela) {
      setZoom(next);
      return;
    }
    setZoom(await window.dela.settings.setZoom(next));
  };

  const changeFontScale = async (next: FontScalePreference) => {
    if (!window.dela) {
      setFontScale(next);
      return;
    }
    setFontScale(await window.dela.settings.setFontScale(next));
  };

  const navigate = (next: ViewId) => {
    if (next === view) return true;
    if (!leaveComposer(() => navigate(next))) return false;
    setBackStack((stack) => [...stack, view]);
    setForwardStack([]);
    setView(next);
    return true;
  };

  const goBack = () => {
    const prev = backStack[backStack.length - 1];
    if (prev === undefined || !leaveComposer(goBack)) return;
    setBackStack((stack) => stack.slice(0, -1));
    setForwardStack((stack) => [view, ...stack]);
    setView(prev);
  };

  const goForward = () => {
    const next = forwardStack[0];
    if (next === undefined || !leaveComposer(goForward)) return;
    setBackStack((stack) => [...stack, view]);
    setForwardStack((stack) => stack.slice(1));
    setView(next);
  };

  return (
    <>
      <AppShell
        canBack={backStack.length > 0}
        canForward={forwardStack.length > 0}
        mobileDrawer={mobileDrawer}
        onBack={goBack}
        onMobileDrawerChange={setMobileDrawer}
        onForward={goForward}
        onNavigate={navigate}
        onZoomChange={(next) => void changeZoom(next)}
        view={view}
        zoom={zoom}
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
                  onMobileDrawerClose={() => setMobileDrawer(null)}
                />
              )}
              {view === 'timetable' && <TimetableView />}
              {view === 'shuiyuan' && <ShuiyuanView />}
              {view === 'settings' && (
                <SettingsView
                  fontScale={fontScale}
                  onFontScaleChange={changeFontScale}
                  onThemeChange={changeTheme}
                  onOpenMail={() => navigate('mail')}
                  onOpenTimetable={() => navigate('timetable')}
                  onZoomChange={changeZoom}
                  theme={theme}
                  zoom={zoom}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </MotionConfig>
      </AppShell>
      <FirstLaunchSplash />
    </>
  );
}
