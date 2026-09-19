import { leaveComposer } from './features/mail/compose-close';
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppShell, type MobileDrawer, type ViewId } from './components/AppShell';
import { HomeView } from './features/home';
import { MailView } from './features/mail';
import { CompletionOverlay } from './features/onboarding/CompletionOverlay';
import { OnboardingFlow } from './features/onboarding/OnboardingFlow';
import { isSmokeTest, onboardingCompleted } from './features/onboarding/onboarding-state';
import { ProjectView } from './features/projects';
import { SettingsView } from './features/settings';
import { ShuiyuanView } from './features/shuiyuan';
import { SourcesView } from './features/sources';
import { TimetableView } from './features/timetable';
import { useShuiyuan } from './features/shuiyuan/store';
import { emptyView, errorText, useWorkspace } from './features/projects/workspace';
import { GlobalSearchDialog } from './features/search/GlobalSearchDialog';
import { NotificationsView } from './features/notifications/NotificationsView';
import {
  fontScaleLevels,
  type FontScalePreference,
  type ThemePreference,
  type ZoomPreference,
  type GlobalSearchResult,
  type NotificationItem,
  type NotificationState,
  type SettingsSectionId,
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [mailRequest, setMailRequest] = useState<{ messageId: number }>();
  const [chatRequest, setChatRequest] = useState<{ scope: string; sessionId: string }>();
  // 搜索选中设置入口时定位到对应分区;每次赋新对象,保证已在设置页时也能触发切换。
  const [settingsRequest, setSettingsRequest] = useState<{ section: SettingsSectionId }>();
  const [notifications, setNotifications] = useState<NotificationState | null>(null);
  const [notificationNow, setNotificationNow] = useState(Date.now);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
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
  // 首次启动引导：flow 期间主界面不渲染；completion 时主界面已挂载、完成动画叠在其上渐隐。
  const [launchStage, setLaunchStage] = useState<'flow' | 'completion' | 'app'>(() =>
    isSmokeTest || onboardingCompleted() ? 'app' : 'flow',
  );
  useEffect(() => {
    if (launchStage === 'flow') return;
    const api = window.dela?.notifications;
    if (!api) return;
    let active = true;
    let version = 0;
    const unsubscribe = api.onUpdate((state) => {
      version += 1;
      setNotificationNow(Date.now());
      if (active) setNotifications(state);
    });
    void api
      .getState()
      .then((state) => {
        if (active && version === 0) setNotifications(state);
      })
      .catch((error) => {
        if (active) setNotificationError(errorText(error));
      });
    // 暂停到期时重新读取，使铃铛无需等待下一次网络刷新即可恢复。
    const timer = window.setInterval(() => {
      setNotificationNow(Date.now());
      const requested = version;
      void api
        .getState()
        .then((state) => {
          if (active && version === requested) setNotifications(state);
        })
        .catch(() => {});
    }, 60_000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [launchStage]);
  useEffect(() => {
    // 仅主界面阶段响应；completion 遮罩期间打开会落在遮罩之下并抢占输入焦点。
    if (launchStage !== 'app') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMobileDrawer(null);
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [launchStage]);
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
  // 稳定引用：CompletionOverlay 以它为依赖设一次性定时器，避免 App 重渲染重置计时。
  const finishCompletion = useCallback(() => setLaunchStage('app'), []);
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
    setMailRequest(undefined);
    setChatRequest(undefined);
    setSettingsRequest(undefined);
    setNavigationError(null);
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

  // 项目里水源引用卡片的「在水源页打开」：切视图并请求定位到该帖。
  const openShuiyuanTopic = (topicId: number, postNumber?: number) => {
    navigate('shuiyuan');
    useShuiyuan.getState().requestTopic(topicId, postNumber);
  };

  const notificationAction = async (action: () => Promise<NotificationState>) => {
    setNotificationLoading(true);
    setNotificationError(null);
    try {
      setNotifications(await action());
    } catch (error) {
      setNotificationError(errorText(error));
    } finally {
      setNotificationLoading(false);
    }
  };
  const openSearchResult = (result: GlobalSearchResult) => {
    if (!leaveComposer(() => openSearchResult(result))) return;
    setNavigationError(null);
    const target = result.target;
    if (target.page === 'projects') openProject(target.entryId);
    else if (target.page === 'mail') {
      if (navigate('mail')) setMailRequest({ messageId: target.messageId });
    } else if (target.page === 'sources') {
      if (!navigate('sources')) return;
      const store = useWorkspace.getState();
      const saved = store.workspace.views.sources ?? emptyView;
      const key = `source:${target.sourceId}`;
      store.setView('sources', {
        ...saved,
        active: key,
        tabs: saved.tabs.includes(key) ? saved.tabs : [...saved.tabs, key],
      });
    } else if (target.page === 'settings') {
      if (navigate('settings')) setSettingsRequest({ section: target.section });
    } else {
      const scope = target.scope;
      const project = useWorkspace
        .getState()
        .workspace.entries.find((entry) => entry.id === scope && entry.kind === 'project');
      if (!['home', 'sources', 'projects'].includes(scope) && !project) {
        setNavigationError('这个会话所属的项目已不存在。');
        return;
      }
      const next = scope === 'home' ? 'home' : scope === 'sources' ? 'sources' : 'project';
      if (!navigate(next)) return;
      if (next === 'project') {
        setProjectId(project?.id ?? null);
        localStorage.setItem('dela.workspace.project', project?.id ?? '');
      }
      setChatRequest({ scope, sessionId: target.sessionId });
    }
  };
  const openNotification = (item: NotificationItem) => {
    if (!leaveComposer(() => openNotification(item))) return;
    const target = item.href;
    if (target.kind === 'mail') {
      if (!navigate('mail')) return;
      setMailRequest({ messageId: target.messageId });
    } else {
      if (!navigate('shuiyuan')) return;
      useShuiyuan.getState().requestTopic(target.topicId, target.postNumber ?? undefined);
    }
    if (!item.readAt && window.dela?.notifications) {
      void notificationAction(() => window.dela!.notifications.markRead(item.id));
    }
  };
  const notificationCount =
    notifications?.snoozedUntil && Date.parse(notifications.snoozedUntil) > notificationNow
      ? 0
      : (notifications?.unreadCount ?? 0);

  return (
    <>
      {launchStage !== 'flow' && (
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
          onSearch={() => setSearchOpen(true)}
          notificationCount={notificationCount}
        >
          {navigationError && (
            <p role="alert" className="px-4 py-2 text-sm text-destructive">
              {navigationError}
            </p>
          )}
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
                    chatRequest={chatRequest?.scope === 'home' ? chatRequest : undefined}
                    onOpenProject={openProject}
                    onNewProject={newProject}
                    onOpenSources={() => navigate('sources')}
                  />
                )}
                {view === 'project' && (
                  <ProjectView
                    chatRequest={
                      chatRequest?.scope === (projectId ?? 'projects') ? chatRequest : undefined
                    }
                    projectId={projectId}
                    onOpenProject={openProject}
                    onOpenShuiyuanTopic={openShuiyuanTopic}
                    createRequested={createProject}
                    onCreateHandled={() => setCreateProject(false)}
                  />
                )}
                {view === 'sources' && (
                  <SourcesView
                    chatRequest={chatRequest?.scope === 'sources' ? chatRequest : undefined}
                    onOpenProject={openProject}
                    onOpenShuiyuanTopic={openShuiyuanTopic}
                  />
                )}
                {view === 'mail' && (
                  <MailView
                    openRequest={mailRequest}
                    mobileDrawerOpen={mobileDrawer === 'mail'}
                    onMobileDrawerClose={() => setMobileDrawer(null)}
                  />
                )}
                {view === 'timetable' && <TimetableView />}
                {view === 'shuiyuan' && <ShuiyuanView />}
                {view === 'notifications' && (
                  <NotificationsView
                    state={notifications}
                    loading={notificationLoading}
                    error={notificationError}
                    onRefresh={() =>
                      window.dela?.notifications &&
                      void notificationAction(() => window.dela!.notifications.refresh())
                    }
                    onMarkRead={(id) =>
                      window.dela?.notifications &&
                      void notificationAction(() => window.dela!.notifications.markRead(id))
                    }
                    onMarkAllRead={() =>
                      window.dela?.notifications &&
                      void notificationAction(() => window.dela!.notifications.markAllRead())
                    }
                    onSnooze={(until) =>
                      window.dela?.notifications &&
                      void notificationAction(() => window.dela!.notifications.setSnooze(until))
                    }
                    onOpen={openNotification}
                  />
                )}
                {view === 'settings' && (
                  <SettingsView
                    fontScale={fontScale}
                    onFontScaleChange={changeFontScale}
                    onThemeChange={changeTheme}
                    onOpenMail={() => navigate('mail')}
                    onOpenShuiyuan={() => navigate('shuiyuan')}
                    onOpenTimetable={() => navigate('timetable')}
                    onZoomChange={changeZoom}
                    sectionRequest={settingsRequest}
                    theme={theme}
                    zoom={zoom}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </MotionConfig>
        </AppShell>
      )}
      {launchStage !== 'flow' && (
        <GlobalSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={openSearchResult}
        />
      )}
      {launchStage === 'flow' && (
        <OnboardingFlow onWizardDone={() => setLaunchStage('completion')} />
      )}
      {launchStage === 'completion' && <CompletionOverlay onFinished={finishCompletion} />}
    </>
  );
}
