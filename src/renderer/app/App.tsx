// 应用根组件（批次 3B 装配）：launch 阶段（首启引导）、AppShell 壳、视图切换动画。
// 视图路由与定位脉冲在 ./navigation；主题/缩放在 ./theme；通知镜像在 ./notifications；
// 工作台（Provider + 目录侧栏 + 弹窗）在 ./workbench-shell。
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AppShell } from '../components/AppShell';
import { MailView } from '../features/mail';
import { CompletionOverlay } from '../features/onboarding/CompletionOverlay';
import { OnboardingFlow } from '../features/onboarding/OnboardingFlow';
import { isSmokeTest, onboardingCompleted } from '../features/onboarding/onboarding-state';
import { NotificationsView } from '../features/notifications/NotificationsView';
import { leaveComposer } from '../features/mail/compose-close';
import { SettingsView } from '../features/settings';
import { ShuiyuanView } from '../features/shuiyuan';
import { GlobalSearchDialog } from '../features/search/GlobalSearchDialog';
import { TimetableView } from '../features/timetable';
import { TodoView } from '../features/todo/TodoView';
import type { GlobalSearchResult } from '../../shared/api';
import type { NavSessionSummary } from '../navigation/ProjectSessionNav';
import { useRuns } from '../sessions/runs';
import { useSessions } from '../sessions/store';
import { useWorkbenchLayout } from '../workbench/layout-store';
import { walkGroups } from '../workbench/layout-schema';
import { importFromDialog } from '../workspace/entry-actions';
import { useNoteDrafts } from '../workspace/drafts';
import { useWorkspaceStore } from '../workspace/store';
import { projectIdFromLegacyScope, useNavigationStore, type MobileDrawer } from './navigation';
import { useNotifications } from './notifications';
import { useAppearance } from './theme';
import { WorkbenchShell } from './workbench-shell';
import { setDefaultNoteEditMode } from '../content/note/default-mode';

/** 项目会话导航的数据装配：sessions 镜像预热 + 按项目摘要（近期优先由 main 排序保证）。 */
function useSessionNavData(): Record<string, NavSessionSummary[]> {
  const lists = useSessions((state) => state.lists);
  // 选择器必须返回稳定引用（useSyncExternalStore 的 getSnapshot 缓存要求），过滤放渲染期。
  const entries = useWorkspaceStore((state) => state.workspace.entries);
  // 徽标数据随 run 事件推送刷新；行渲染时即时读取。
  useRuns((state) => state.bySession);
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
  const sessionsByProject: Record<string, NavSessionSummary[]> = {};
  for (const project of projects)
    sessionsByProject[project.id] = (lists[project.id] ?? []).map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
    }));
  return sessionsByProject;
}

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawer | null>(null);
  // 首次启动引导：flow 期间主界面不渲染；completion 时主界面已挂载、完成动画叠在其上渐隐。
  const [launchStage, setLaunchStage] = useState<'flow' | 'completion' | 'app'>(() =>
    isSmokeTest || onboardingCompleted() ? 'app' : 'flow',
  );

  const view = useNavigationStore((state) => state.view);
  const projectId = useNavigationStore((state) => state.projectId);
  const canBack = useNavigationStore((state) => state.backStack.length > 0);
  const canForward = useNavigationStore((state) => state.forwardStack.length > 0);
  const mailRequest = useNavigationStore((state) => state.mailRequest);
  const todoRequest = useNavigationStore((state) => state.todoRequest);
  const settingsRequest = useNavigationStore((state) => state.settingsRequest);
  const navigationError = useNavigationStore((state) => state.navigationError);

  const { theme, zoom, fontScale, changeTheme, changeZoom, changeFontScale } = useAppearance();
  const notifications = useNotifications(launchStage !== 'flow');
  const sessionsByProject = useSessionNavData();
  const activeSessionId = useWorkbenchLayout((state) => {
    const group = walkGroups(state.root).find((node) => node.id === state.focus);
    const active = group?.active;
    return active?.startsWith('chat:') ? active.slice('chat:'.length) : null;
  });

  // 工作区镜像载入 + 会话静默后的条目/Canvas/干净草稿刷新（工具可能写过工作区）。
  useEffect(() => {
    void useWorkspaceStore.getState().load();
    return window.dela?.session.onSessionUpdate((sessionId, chat) => {
      if (chat.running) return;
      const store = useWorkspaceStore.getState();
      void store.refresh().catch(store.setError);
      void window.dela?.canvas.getState().then(store.setCanvas).catch(store.setError);
      for (const [id, draft] of Object.entries(useNoteDrafts.getState().drafts)) {
        if (draft.text === draft.saved)
          void useNoteDrafts.getState().acquire(id, true).catch(store.setError);
      }
      // 首条消息会给会话命名（标题在 run 开始时落库）：终态时重读所属池的列表镜像，
      // 导航与会话列表的标题不再陈旧；只做终态刷新，运行中标题变化无即时展示需求。
      const lists = useSessions.getState().lists;
      for (const [pool, list] of Object.entries(lists)) {
        if (list.some((session) => session.id === sessionId)) {
          void useSessions.getState().refresh(pool === 'general' ? null : pool).catch(() => {});
          break;
        }
      }
    });
  }, []);

  // 工作区偏好（设置 › 工作区）：水合默认笔记编辑方式；关闭「启动恢复上次项目」时
  // 回到通用工作台（navigation 初始已按 localStorage 恢复，这里做偏好校正）。
  useEffect(() => {
    void window.dela?.settings
      .getWorkspacePrefs()
      .then((prefs) => {
        setDefaultNoteEditMode(prefs.defaultNoteEditMode);
        if (!prefs.restoreLastProject) {
          const navigation = useNavigationStore.getState();
          if (navigation.view === 'workbench' && navigation.projectId) navigation.openProject('');
        }
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

  // 托盘：新建对话 → 通用聊天新会话；新建项目 → 工作台的新建项目弹窗。
  useEffect(() => {
    return window.dela?.window.onTrayAction((action) => {
      const navigation = useNavigationStore.getState();
      if (action === 'new-chat') navigation.openGeneralChat(true);
      else navigation.newProject();
    });
  }, []);

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

  // 稳定引用：CompletionOverlay 以它为依赖设一次性定时器，避免 App 重渲染重置计时。
  const finishCompletion = useCallback(() => setLaunchStage('app'), []);

  const importFiles = () => {
    importFromDialog(view === 'workbench' ? useNavigationStore.getState().projectId : null);
  };

  // 全局搜索结果分发：chat 深链把旧 scope 身份归一到项目/通用池；course-file 落工作台预览标签。
  const openSearchResult = (result: GlobalSearchResult) => {
    if (!leaveComposer(() => openSearchResult(result))) return;
    const navigation = useNavigationStore.getState();
    navigation.setNavigationError(null);
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
      {launchStage !== 'flow' && (
        <AppShell
          canBack={canBack}
          canForward={canForward}
          mobileDrawer={mobileDrawer}
          onBack={() => void useNavigationStore.getState().goBack()}
          onForward={() => void useNavigationStore.getState().goForward()}
          onMobileDrawerChange={setMobileDrawer}
          onNavigate={(next) => void useNavigationStore.getState().navigate(next)}
          onZoomChange={(next) => void changeZoom(next)}
          view={view}
          zoom={zoom}
          projectId={projectId}
          onOpenProject={(id) => void useNavigationStore.getState().openProject(id)}
          onNewProject={() => void useNavigationStore.getState().newProject()}
          onImportFiles={importFiles}
          onSearch={() => setSearchOpen(true)}
          notificationCount={notifications.count}
          sessionsByProject={sessionsByProject}
          runBadge={(sessionId) => useRuns.getState().bySession[sessionId]?.status ?? null}
          activeSessionId={activeSessionId}
          onDeleteSession={(sessionId) => {
            void window.dela?.session.remove(sessionId);
            useSessions.getState().forgetSession(sessionId);
            void useSessions
              .getState()
              .refresh(null)
              .catch(() => {});
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
          {navigationError && (
            <p className="px-4 py-2 text-sm text-destructive" role="alert">
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
                {view === 'workbench' && <WorkbenchShell />}
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
                    fontScale={fontScale}
                    onFontScaleChange={changeFontScale}
                    onThemeChange={changeTheme}
                    onOpenMail={() => void useNavigationStore.getState().navigate('mail')}
                    onOpenShuiyuan={() => void useNavigationStore.getState().navigate('shuiyuan')}
                    onOpenTimetable={() => void useNavigationStore.getState().navigate('timetable')}
                    onZoomChange={changeZoom}
                    sectionRequest={settingsRequest ?? undefined}
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
