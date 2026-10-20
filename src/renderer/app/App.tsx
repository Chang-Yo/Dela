// 应用根组件：launch 阶段（首启引导）、AppShell 壳与视图切换。
// 视图路由在 ./navigation；主题/缩放在 ./theme；通知镜像在 ./notifications；工作台在 workbench/WorkbenchShell。
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppShell } from '../components/AppShell';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MailView } from '../features/mail';
import { ClassroomView } from '../features/classroom';
import { CompletionOverlay } from '../features/onboarding/CompletionOverlay';
import { OnboardingFlow } from '../features/onboarding/OnboardingFlow';
import { CapabilitySetup } from '../features/onboarding/CapabilitySetup';
import { OnboardingWindowBar } from '../features/onboarding/onboarding-window-bar';
import { Button } from '../components/ui/button';
import { isSmokeTest, onboardingCompleted } from '../features/onboarding/onboarding-state';
import { NotificationsView } from '../features/notifications/NotificationsView';
import { leaveComposer } from '../features/mail/compose-close';
import { SettingsView } from '../features/settings';
import { UpdatePrompt } from '../features/settings/UpdatePrompt';
import { ReleaseNotesDialog } from '../features/release-notes/ReleaseNotesDialog';
import { useUpdateState } from '../features/settings/update';
import { useExperimental, useExperimentEnabled } from '../features/settings/experimental';
import { parsePreviewTabId } from '../content/preview/tab-id';
import { ShuiyuanView } from '../features/shuiyuan';
import { GlobalSearchDialog } from '../features/search/GlobalSearchDialog';
import { TimetableView } from '../features/timetable';
import { TodoView } from '../features/todo/TodoView';
import type { ChatSessionSummary, GlobalSearchResult } from '../../shared/api';
import type { NavSessionSummary } from '../navigation/ProjectSessionNav';
import { useRuns } from '../sessions/runs';
import { useSessions, updateSession } from '../sessions/store';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { walkGroups } from '../workbench/layout-schema';
import { importFromDialog } from '../workspace/entry-actions';
import { useNoteDrafts } from '../content/note/drafts';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { showToast } from './toasts';
import {
  projectIdFromLegacyScope,
  useNavigationStore,
  type MobileDrawer,
} from '../navigation/view';
import { useNotifications } from './notifications';
import { useAppearance } from './theme';
import { WorkbenchShell } from '../workbench/WorkbenchShell';
import { setDefaultNoteEditMode } from '../content/note/default-mode';
import { useNoteSpellcheck } from '../content/note/note-spellcheck';

/** 项目会话导航的数据装配：sessions 镜像预热 + 按项目摘要（近期优先由 main 排序保证）。
 *  通用池（键 'general'）不入项目树，但保留镜像预热：会话标签标题解析（registry
 *  的 chatTitleOf）与通用聊天定位都读它。
 *  运行徽标不在此订阅：SessionRow 按行订阅 runs 镜像，run 事件不再全 App 重渲。 */
function useSessionNavData(): { sessionsByProject: Record<string, NavSessionSummary[]> } {
  const lists = useSessions((state) => state.lists);
  // 选择器必须返回稳定引用（useSyncExternalStore 的 getSnapshot 缓存要求），过滤放渲染期。
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  const projects = entries.filter((entry) => entry.kind === 'project');
  const projectIds = projects.map((project) => project.id);
  const projectKey = projectIds.join('\n');
  useEffect(() => {
    for (const id of projectKey.split('\n').filter(Boolean))
      void useSessions
        .getState()
        .refresh(id)
        .catch(() => {});
    void useSessions
      .getState()
      .refresh(null)
      .catch(() => {});
  }, [projectKey]);
  const toSummaries = (list: ChatSessionSummary[]): NavSessionSummary[] =>
    list.map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      pinned: session.pinned,
    }));
  const sessionsByProject: Record<string, NavSessionSummary[]> = {};
  for (const project of projects)
    sessionsByProject[project.id] = toSummaries(lists[project.id] ?? []);
  return { sessionsByProject };
}

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawer | null>(null);
  // 首次启动引导：flow 期间主界面不渲染；completion 时主界面已挂载、完成动画叠在其上渐隐。
  const [launchStage, setLaunchStage] = useState<
    'flow' | 'checking' | 'capabilities' | 'completion' | 'app'
  >(() => (isSmokeTest ? 'app' : onboardingCompleted() ? 'checking' : 'flow'));
  const [setupCheck, setSetupCheck] = useState(0);
  const [setupError, setSetupError] = useState<string | null>(null);
  const appVisible = launchStage === 'app' || launchStage === 'completion';

  useEffect(() => {
    if (launchStage !== 'checking') return;
    if (!window.dela) {
      setLaunchStage('app');
      return;
    }
    let active = true;
    void window.dela.capability
      .needsSetup()
      .then((required) => {
        if (active) setLaunchStage(required ? 'capabilities' : 'app');
      })
      .catch((cause) => {
        if (active) setSetupError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [launchStage, setupCheck]);

  const view = useNavigationStore((state) => state.view);
  const projectId = useNavigationStore((state) => state.projectId);
  const canBack = useNavigationStore((state) => state.backStack.length > 0);
  const canForward = useNavigationStore((state) => state.forwardStack.length > 0);
  const mailRequest = useNavigationStore((state) => state.mailRequest);
  const todoRequest = useNavigationStore((state) => state.todoRequest);
  const settingsRequest = useNavigationStore((state) => state.settingsRequest);

  const { theme, zoom, fontSize, changeTheme, changeZoom, changeFontSize } = useAppearance();
  const notifications = useNotifications(appVisible);
  const { sessionsByProject } = useSessionNavData();
  const homeSessionId = useNavigationStore((state) => state.generalChat?.sessionId ?? null);
  const workbenchSessionId = useWorkbenchLayout((state) => {
    const group = walkGroups(state.root).find((node) => node.id === state.focus);
    const active = group?.active;
    return active?.startsWith('chat:') ? active.slice('chat:'.length) : null;
  });
  const activeSessionId =
    view === 'home' ? homeSessionId : view === 'workbench' ? workbenchSessionId : null;
  // 焦点组活动标签是否为会话：通用池里据此互斥高亮「通用聊天」（会话标签）与「资料」
  // （笔记/预览标签或空工作台）。
  const activeTabIsChat = useWorkbenchLayout((state) => {
    const group = walkGroups(state.root).find((node) => node.id === state.focus);
    return group?.active?.startsWith('chat:') ?? false;
  });

  // 水源功能关闭：停在水源页的回首页，已打开的水源来源标签一并关闭（入口隐藏则不受影响）。
  const shuiyuanEnabled = useExperimentEnabled('shuiyuan');
  const experimentsLoaded = useExperimental((state) => state.state !== null);
  useEffect(() => {
    void useExperimental.getState().load();
  }, []);
  useEffect(() => {
    if (!experimentsLoaded || shuiyuanEnabled) return;
    if (useNavigationStore.getState().view === 'shuiyuan')
      useNavigationStore.getState().openGeneralChat(false);
    const entries = useWorkspaceStore.getState().workspace.entries;
    const isShuiyuan = (sourceId?: string | null) =>
      Boolean(sourceId?.startsWith('shuiyuan-topic:'));
    const layout = useWorkbenchLayout.getState();
    for (const group of walkGroups(layout.root))
      for (const tab of group.tabs) {
        const target = parsePreviewTabId(tab);
        if (!target) continue;
        const sourceId =
          'sourceId' in target
            ? target.sourceId
            : entries.find((entry) => entry.id === target.entryId)?.sourceId;
        if (isShuiyuan(sourceId)) layout.closeTab(tab, group.id);
      }
  }, [experimentsLoaded, shuiyuanEnabled]);

  // 更新快照的订阅属于应用而不是设置页：标题栏要在用户从没打开过设置页时也能提示有新版本。
  useEffect(() => {
    useUpdateState.getState().attach();
  }, []);

  // 工作区镜像载入 + 会话静默后的条目/Canvas/干净草稿刷新（工具可能写过工作区）。
  useEffect(() => {
    void useWorkspaceStore.getState().load();
    return window.dela?.session.onSessionUpdate((sessionId, chat) => {
      if (chat.running) return;
      const store = useWorkspaceStore.getState();
      // 会话终态后的后台自动刷新失败不打扰用户（浮窗只留给用户主动的动作），仅留诊断线索。
      void store.refresh().catch(console.error);
      void window.dela?.canvas.getState().then(store.setCanvas).catch(console.error);
      for (const [id, draft] of Object.entries(useNoteDrafts.getState().drafts)) {
        if (draft.text === draft.saved)
          void useNoteDrafts.getState().acquire(id, true).catch(console.error);
      }
      // 首条消息会给会话命名（标题在 run 开始时落库）：终态时重读所属池的列表镜像，
      // 导航与会话列表的标题不再陈旧；只做终态刷新，运行中标题变化无即时展示需求。
      const lists = useSessions.getState().lists;
      for (const [pool, list] of Object.entries(lists)) {
        if (list.some((session) => session.id === sessionId)) {
          void useSessions
            .getState()
            .refresh(pool === 'general' ? null : pool)
            .catch(() => {});
          break;
        }
      }
    });
  }, []);

  useEffect(() => {
    void window.dela?.settings
      .getWorkspacePrefs()
      .then((prefs) => {
        setDefaultNoteEditMode(prefs.defaultNoteEditMode);
        useNoteSpellcheck.getState().setSpellcheck(prefs.noteSpellcheck);
      })
      .catch(() => {});
  }, []);

  // 未保存笔记的退出守卫（草稿自动保存有 600ms 防抖窗口）。
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        Object.values(useNoteDrafts.getState().drafts).some((draft) => draft.text !== draft.saved)
      )
        event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  // 托盘与原生菜单共用动作入口。
  useEffect(() => {
    return window.dela?.window.onTrayAction((action) => {
      const navigation = useNavigationStore.getState();
      if (action === 'new-chat') navigation.openGeneralChat(true);
      else if (action === 'new-project') navigation.newProject();
      else if (action === 'open-settings') navigation.navigate('settings');
    });
  }, []);

  // 全局搜索入口交给 AppShell 的快捷键派发（Ctrl/⌘+K 可改键）；此处只守卫引导阶段：
  // completion 遮罩期间打开会落在遮罩之下并抢占输入焦点。
  const openSearch = () => {
    if (launchStage !== 'app') return;
    setMobileDrawer(null);
    setSearchOpen(true);
  };

  // 稳定引用：CompletionOverlay 以它为依赖设一次性定时器，避免 App 重渲染重置计时。
  const finishCompletion = useCallback(() => setLaunchStage('app'), []);

  const importFiles = () => {
    importFromDialog(view === 'workbench' ? useNavigationStore.getState().projectId : null);
  };

  // 侧栏「资料」入口：通用工作台即旧资料页（课程资料/我的资料/归档 + 文档标签）。
  // 已在通用池时与「通用聊天」对称：把焦点让给已有的文档标签；没有则保持现状。
  const openSources = () => {
    const navigation = useNavigationStore.getState();
    if (navigation.view !== 'workbench' || navigation.projectId !== null) {
      void navigation.openProject('');
      return;
    }
    const layout = useWorkbenchLayout.getState();
    const docTab = walkGroups(layout.root)
      .flatMap((group) => group.tabs)
      .find((tab) => tab.startsWith('note:') || tab.startsWith('preview:'));
    if (docTab) layout.openTab(docTab);
  };

  // 全局搜索结果分发：chat 深链把旧 scope 身份归一到项目/通用池；course-file 落工作台预览标签。
  const openSearchResult = (result: GlobalSearchResult) => {
    if (!leaveComposer(() => openSearchResult(result))) return;
    const navigation = useNavigationStore.getState();
    const target = result.target;
    if (target.page === 'projects') navigation.openProject(target.entryId);
    else if (target.page === 'chat')
      navigation.openChat(target.sessionId, projectIdFromLegacyScope(target.scope));
    else if (target.page === 'mail') navigation.openMail(target.messageId);
    else if (target.page === 'sources') navigation.openDocument(`source:${target.sourceId}`);
    else if (target.page === 'todo') navigation.openTodo(target.todoId);
    else navigation.openSettings(target.section);
  };

  return (
    <>
      {appVisible && (
        <AppShell
          canBack={canBack}
          canForward={canForward}
          mobileDrawer={mobileDrawer}
          onBack={() => void useNavigationStore.getState().goBack()}
          onForward={() => void useNavigationStore.getState().goForward()}
          onMobileDrawerChange={setMobileDrawer}
          onNavigate={(next) => void useNavigationStore.getState().navigate(next)}
          onZoomChange={(next) =>
            void changeZoom(next).catch((cause) =>
              showToast({ variant: 'error', title: '调整缩放失败', description: errorText(cause) }),
            )
          }
          view={view}
          zoom={zoom}
          projectId={projectId}
          onOpenProject={(id) => void useNavigationStore.getState().openProject(id)}
          onNewProject={() => void useNavigationStore.getState().newProject()}
          onImportFiles={importFiles}
          onSearch={openSearch}
          onOpenSources={openSources}
          activeTabIsChat={activeTabIsChat}
          notificationCount={notifications.count}
          todoUnreadCount={notifications.todoUnread}
          sessionsByProject={sessionsByProject}
          runBadge={(sessionId) => useRuns.getState().bySession[sessionId]?.status ?? null}
          activeSessionId={activeSessionId}
          onDeleteSession={async (sessionId) => {
            await updateSession(sessionId, { archived: true });
          }}
          onOpenSession={(sessionId) => {
            // 会话行只带 sessionId：所属项目从镜像列表反查，未命中按通用池。
            const lists = useSessions.getState().lists;
            let owner: string | null = null;
            for (const [pool, list] of Object.entries(lists)) {
              if (list.some((session) => session.id === sessionId)) {
                owner = pool === 'general' ? null : pool;
                break;
              }
            }
            void useNavigationStore.getState().openChat(sessionId, owner);
          }}
          onOpenGeneralChat={() => void useNavigationStore.getState().openGeneralChat(false)}
          onNavigateBusiness={(id) => void useNavigationStore.getState().navigate(id)}
        >
          <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="flex min-h-0 flex-1 flex-col"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0, y: 4 }}
                // home 与工作台共用装配壳和 key；主动打开项目或资料时复用宿主，
                // 避免整壳淡出重挂与布局重复载入。
                key={view === 'home' || view === 'workbench' ? 'workspace' : view}
                transition={{ duration: 0.16 }}
              >
                {/* 视图切换层的错误边界：单个视图渲染崩溃降级为静态提示，可重试重挂载。 */}
                <ErrorBoundary title="此视图遇到错误">
                  {(view === 'workbench' || view === 'home') && (
                    <WorkbenchShell home={view === 'home'} />
                  )}
                  {view === 'mail' && (
                    <MailView
                      mobileDrawerOpen={mobileDrawer === 'mail'}
                      onMobileDrawerClose={() => setMobileDrawer(null)}
                      openRequest={mailRequest ?? undefined}
                    />
                  )}
                  {view === 'timetable' && (
                    <TimetableView
                      onOpenTodo={(todoId) => void useNavigationStore.getState().openTodo(todoId)}
                    />
                  )}
                  {view === 'shuiyuan' && <ShuiyuanView />}
                  {view === 'classroom' && <ClassroomView />}
                  {view === 'todo' && <TodoView request={todoRequest ?? undefined} />}
                  {view === 'notifications' && (
                    <NotificationsView
                      state={notifications.notifications}
                      loading={notifications.loading}
                      error={notifications.error}
                      onRefresh={() =>
                        window.dela?.notifications &&
                        void notifications.run(() => window.dela!.notifications.refresh())
                      }
                      onMarkRead={(id) =>
                        window.dela?.notifications &&
                        void notifications.run(() => window.dela!.notifications.markRead(id))
                      }
                      onMarkAllRead={() =>
                        window.dela?.notifications &&
                        void notifications.run(() => window.dela!.notifications.markAllRead())
                      }
                      onSnooze={(until) =>
                        window.dela?.notifications &&
                        void notifications.run(() => window.dela!.notifications.setSnooze(until))
                      }
                      onOpen={notifications.openNotification}
                    />
                  )}
                  {view === 'settings' && (
                    <SettingsView
                      fontSize={fontSize}
                      onFontSizeChange={changeFontSize}
                      onThemeChange={changeTheme}
                      onOpenMail={() => void useNavigationStore.getState().navigate('mail')}
                      onOpenShuiyuan={() => void useNavigationStore.getState().navigate('shuiyuan')}
                      onOpenTimetable={() =>
                        void useNavigationStore.getState().navigate('timetable')
                      }
                      onZoomChange={changeZoom}
                      sectionRequest={settingsRequest ?? undefined}
                      theme={theme}
                      zoom={zoom}
                    />
                  )}
                </ErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </MotionConfig>
        </AppShell>
      )}
      {appVisible && (
        <GlobalSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={openSearchResult}
        />
      )}
      {launchStage === 'flow' && (
        <OnboardingFlow
          onConsentDone={() => setLaunchStage('checking')}
          onWizardDone={() => setLaunchStage('completion')}
        />
      )}
      {launchStage === 'checking' && (
        <div className="grid h-dvh grid-rows-[auto_1fr] bui-light bg-surface text-ink">
          <OnboardingWindowBar />
          <main className="mx-auto w-full max-w-3xl px-6 pt-16">
            {setupError ? (
              <div className="mt-4 grid justify-items-start gap-3">
                <h1 className="text-2xl font-semibold">能力拓展</h1>
                <p role="alert" className="text-13 text-red">
                  {setupError}
                </p>
                <Button
                  onClick={() => {
                    setSetupError(null);
                    setSetupCheck((value) => value + 1);
                  }}
                >
                  重试
                </Button>
              </div>
            ) : (
              <p role="status" className="sr-only">
                正在启动…
              </p>
            )}
          </main>
        </div>
      )}
      {launchStage === 'capabilities' && <CapabilitySetup onDone={() => setLaunchStage('app')} />}
      {/* 下载完成的确认弹窗挂在应用层：下载在后台跑完时，用户可能已经离开设置页。 */}
      {appVisible && <UpdatePrompt />}
      {launchStage === 'app' && <ReleaseNotesDialog />}
      {launchStage === 'completion' && <CompletionOverlay onFinished={finishCompletion} />}
    </>
  );
}
