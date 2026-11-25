import { useEffect, useEffectEvent, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  CodeXml,
  Copy,
  FolderOpen,
  Menu,
  MessageCirclePlus,
  Minus,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  Square,
  SquareCheckBig,
  SquareTerminal,
  X,
} from 'lucide-react';
import { Resizable } from '../../../ui/resizable';
import { useEditorSettings } from '../../../modules/preview/view';
import { usePreferences } from './preferences';
import { showToast, Toaster } from '../../../ui/toast';
import { Lightbox } from '../../../ui/lightbox';
import { cn } from '../../../ui/lib/cn';
import { useMediaQuery } from '../../../ui/hooks/use-media-query';
import type { NavTarget } from '../../module';
import { useNavigationStore, type AppView, type ShellView } from '../navigation/view';
import type { MobileDrawer } from './mobile-drawer';
import { useShortcuts } from './shortcuts';
import { useViewportWidth } from '../../../ui/hooks/use-viewport-width';
import {
  ProjectSessionNav,
  type BusinessNavId,
  type NavSessionSummary,
  type SessionRunBadge,
} from '../navigation/ProjectSessionNav';
import { zoomLevels, type ZoomPreference } from '../../../modules/settings/contract';
import { acceleratorKeys, matchShortcut, shortcutGroups } from '../../../modules/settings/contract';
import { DropdownMenuItem } from '../../../ui/dropdown-menu';
import { SplitButton, SplitButtonAction, SplitButtonMenu } from '../../../ui/split-button';
import { drawerFromLeft, fadeIn, overlayFade } from '../../../ui/lib/motion';
import { navIcon, navRow } from '../navigation/nav-styles';
import { UpdateBadge } from '../../../modules/update/view';
import { navEntries, useVisibleNavEntries } from '../navigation/entries';
import { pages } from '../../views';
import { Button } from '../../../ui/button';
import { Kbd } from '../../../ui/kbd';
import { workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../ui/dialog';
import { errorMessage } from '../../../core/protocol/contract';

const platform = window.dela?.platform === 'darwin' ? 'mac' : 'other';
const fileManagerName = window.dela?.platform === 'darwin' ? 'Finder' : '资源管理器';

const labelFade = 'transition-opacity duration-slow ease-out';

function ShortcutSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium tracking-[0.12em] text-ink-3">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ShortcutRow({ hint, keys, label }: { hint?: string; keys?: string[]; label: string }) {
  return (
    <div className="flex h-9 items-center justify-between gap-8">
      <span className="min-w-0 truncate text-sm text-ink-2">{label}</span>
      {keys ? (
        <span className="flex shrink-0 items-center gap-1">
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      ) : (
        <span className="shrink-0 text-sm text-ink-3">{hint}</span>
      )}
    </div>
  );
}

function WindowControls() {
  const queryClient = useQueryClient();
  const windowState = useQuery({
    queryKey: ['window', 'state'],
    queryFn: () => window.dela!.window.getState(),
    enabled: Boolean(window.dela),
  });
  const maximized = windowState.data?.maximized ?? false;
  useEffect(
    () =>
      window.dela?.window.onStateChange((state) =>
        queryClient.setQueryData(['window', 'state'], state),
      ),
    [queryClient],
  );

  if (!window.dela || platform === 'mac') return null;

  return (
    <div className="[-webkit-app-region:no-drag] flex h-full">
      <button
        aria-label="最小化"
        className="grid h-full w-12 place-items-center text-ink-2 transition-colors duration-base hover:bg-hover-strong hover:text-ink"
        onClick={() => window.dela?.window.minimize()}
        type="button"
      >
        <Minus className="size-4" strokeWidth={1.8} />
      </button>
      <button
        aria-label={maximized ? '还原' : '最大化'}
        className="grid h-full w-12 place-items-center text-ink-2 transition-colors duration-base hover:bg-hover-strong hover:text-ink"
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
        className="grid h-full w-12 place-items-center text-ink-2 transition-colors duration-base hover:bg-window-close hover:text-on-accent"
        onClick={() => window.dela?.window.close()}
        type="button"
      >
        <X className="size-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}

type AppShellProps = {
  view: AppView;
  onNavigate: (next: ShellView | NavTarget) => void;
  mobileDrawer?: MobileDrawer | null;
  onMobileDrawerChange?: (drawer: MobileDrawer | null) => void;
  onDrawerSlot: (element: HTMLElement | null) => void;
  onBack: () => void;
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
  zoom: ZoomPreference;
  onZoomChange: (zoom: ZoomPreference) => void;
  children: ReactNode;
  onImportFiles: () => void;
  onNewProject: () => void;
  onSearch: () => void;
  notificationCount: number;
  todoUnreadCount: number;
  sessionsByProject: Record<string, NavSessionSummary[]>;
  runBadge: (sessionId: string) => SessionRunBadge;
  activeSessionId: string | null;
  projectId: string | null;
  onOpenProject: (id: string) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenGeneralChat: () => void;
  onOpenSources: () => void;
  activeTabIsChat: boolean;
  onNavigateBusiness: (id: BusinessNavId) => void;
};

export function AppShell({
  view,
  onNavigate,
  mobileDrawer,
  onMobileDrawerChange,
  onDrawerSlot,
  onBack,
  onForward,
  canBack,
  canForward,
  zoom,
  onZoomChange,
  children,
  onImportFiles,
  onNewProject,
  onSearch,
  notificationCount,
  todoUnreadCount,
  sessionsByProject,
  runBadge,
  activeSessionId,
  projectId,
  onOpenProject,
  onOpenSession,
  onDeleteSession,
  onOpenGeneralChat,
  onOpenSources,
  activeTabIsChat,
  onNavigateBusiness,
}: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const bindings = useShortcuts((state) => state.bindings);
  const sidebarCollapsed = usePreferences((state) => state.shellSidebarCollapsed);
  const projectOpenTarget = usePreferences((state) => state.projectOpenTarget);
  const setPreference = usePreferences((state) => state.setPreference);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const narrow = useMediaQuery('(max-width: 767px)');
  const drawer = mobileDrawer ?? null;
  const navDrawerOpen = drawer === 'nav' || drawer === 'page';
  const [helpOpen, setHelpOpen] = useState(false);
  const viewportWidth = useViewportWidth();
  // 远端项目的目录在远端：VS Code 是经 Remote-SSH 打开的，文案必须写明，否则会被当成开本地目录。
  const projectIsRemote = useWorkspaceStore(
    (state) => state.workspace.entries.find((item) => item.id === projectId)?.remoteId != null,
  );
  const effectiveOpenTarget: 'vscode' | 'explorer' = projectIsRemote ? 'vscode' : projectOpenTarget;
  const vscodeOpenLabel = projectIsRemote ? '在 VS Code 中打开（SSH）' : '在 VS Code 打开项目';

  // 视口钳制：壳侧栏渲染宽度不超过视口约 28%（下限 200），给内容区保留可用宽度；
  // 用户拖拽偏好保留原值，仅渲染时钳制（与目录侧栏的钳制合计 ≤ 约 56% 视口）。
  const effectiveSidebarWidth = Math.min(
    sidebarWidth,
    Math.max(200, Math.round(viewportWidth * 0.28)),
  );

  const navHidden = narrow ? !navDrawerOpen : sidebarCollapsed;
  const visibleEntries = useVisibleNavEntries();
  const sourcesActive = view === 'workbench' && projectId === null && !activeTabIsChat;

  const openProjectDirectory = (target: 'vscode' | 'explorer') => {
    if (view !== 'workbench' || !projectId || !window.dela) return;
    const effective: 'vscode' | 'explorer' = projectIsRemote ? 'vscode' : target;
    if (effective === target) setPreference('projectOpenTarget', target);
    void workspaceClient
      .openProjectDirectory({ id: projectId, target: effective })
      .catch((cause: unknown) => {
        showToast({
          variant: 'error',
          title: '打开项目目录失败',
          description: errorMessage(cause),
        });
      });
  };

  const navigate = (next: ShellView | NavTarget) => {
    onNavigate(next);
    if (narrow)
      onMobileDrawerChange?.(
        typeof next !== 'string' && pages.of(next.page)?.drawer ? 'page' : null,
      );
  };

  const stepZoom = (direction: 1 | -1 | 0) => {
    if (direction === 0) {
      onZoomChange(1);
      return;
    }
    const index = zoomLevels.indexOf(zoom);
    onZoomChange(zoomLevels[Math.max(0, Math.min(index + direction, zoomLevels.length - 1))]!);
  };

  const runShortcut = useEffectEvent((action: NonNullable<ReturnType<typeof matchShortcut>>) => {
    switch (action) {
      case 'new-project':
        onNewProject();
        break;
      case 'import-files':
        onImportFiles();
        break;
      case 'global-search':
        onSearch();
        break;
      case 'zoom-in':
        stepZoom(1);
        break;
      case 'zoom-out':
        stepZoom(-1);
        break;
      case 'zoom-reset':
        stepZoom(0);
        break;
      case 'toggle-word-wrap':
        useEditorSettings.getState().toggleWordWrap();
        break;
      case 'open-settings':
        navigate('settings');
        break;
      case 'open-shortcuts':
        setHelpOpen(true);
        break;
    }
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const action = matchShortcut(useShortcuts.getState().bindings, event, 'global', platform);
      if (!action) return;
      event.preventDefault();
      runShortcut(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className={cn(
        'relative grid h-dvh grid-cols-[var(--sidebar-width)_0px_1px_minmax(0,1fr)] grid-rows-[env(titlebar-area-height,2.5rem)_minmax(0,1fr)] bg-page text-ink transition-[grid-template-columns] duration-slow ease-(--ease-out-strong)',
        sidebarResizing && 'transition-none',
      )}
      style={
        {
          '--sidebar-width': narrow || sidebarCollapsed ? '0px' : `${effectiveSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <header
        className={cn(
          'col-span-full flex items-center justify-between bg-page',
          'select-none [-webkit-app-region:drag]',
          'pl-[env(titlebar-area-x,0px)] [&_button]:max-h-[env(titlebar-area-height,none)] [&_div]:max-h-[env(titlebar-area-height,none)]',
        )}
      >
        <div className="flex h-full items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-controls="main-nav"
            aria-expanded={!navHidden}
            aria-label={navHidden ? '展开侧边栏' : '收起侧边栏'}
            className={cn(
              '[-webkit-app-region:no-drag] ml-2',
              !navHidden && 'opacity-70 hover:opacity-100',
            )}
            onClick={() =>
              narrow
                ? onMobileDrawerChange?.(
                    navDrawerOpen ? null : pages.of(view)?.drawer ? 'page' : 'nav',
                  )
                : setPreference('shellSidebarCollapsed', !sidebarCollapsed)
            }
            title={navHidden ? '展开侧边栏' : '收起侧边栏'}
          >
            {navHidden ? (
              narrow ? (
                <Menu strokeWidth={1.8} />
              ) : (
                <PanelLeft strokeWidth={1.8} />
              )
            ) : (
              <PanelLeftClose strokeWidth={1.8} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="后退"
            className="[-webkit-app-region:no-drag] ml-1.5"
            disabled={!canBack}
            onClick={onBack}
            title="后退"
          >
            <ArrowLeft strokeWidth={1.8} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="前进"
            className="[-webkit-app-region:no-drag] ml-0.5"
            disabled={!canForward}
            onClick={onForward}
            title="前进"
          >
            <ArrowRight strokeWidth={1.8} />
          </Button>
          {!narrow && sidebarCollapsed && (
            <div className="[-webkit-app-region:no-drag] ml-2 flex h-full items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-current={view === 'home' ? 'page' : undefined}
                aria-label="新对话"

                onClick={onOpenGeneralChat}
                title="新对话"
              >
                <MessageCirclePlus strokeWidth={1.8} />
              </Button>
              {visibleEntries.map((item) => {
                const Icon = item.icon;
                const active = item.id === 'sources' ? sourcesActive : view === item.id;
                return (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}

                    key={item.id}
                    onClick={() =>
                      item.id === 'sources' ? onOpenSources() : onNavigateBusiness(item.id)
                    }
                    title={item.label}
                  >
                    <Icon strokeWidth={1.8} />
                  </Button>
                );
              })}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-current={view === 'settings' ? 'page' : undefined}
                aria-label="设置"

                onClick={() => navigate('settings')}
                title="设置"
              >
                <Settings strokeWidth={1.8} />
              </Button>
            </div>
          )}
          <UpdateBadge onOpen={() => useNavigationStore.getState().openSettings('general')} />
        </div>
        <div className="flex h-full items-center">
          {!narrow && sidebarCollapsed && (
            <div className="[-webkit-app-region:no-drag] flex h-full items-center gap-1 pr-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-current={view === 'todo' ? 'page' : undefined}
                aria-label={todoUnreadCount > 0 ? `TODO，${todoUnreadCount} 条新消息` : 'TODO'}

                onClick={() => navigate({ page: 'todo' })}
                title="TODO"
              >
                <SquareCheckBig
                  className={cn('size-4', todoUnreadCount > 0 && 'text-accent')}
                  strokeWidth={1.8}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={notificationCount > 0 ? `通知，${notificationCount} 条未读` : '通知'}
                aria-current={view === 'notifications' ? 'page' : undefined}
                className="relative"
                onClick={() => navigate({ page: 'notifications' })}
                title="通知"
              >
                <Bell strokeWidth={1.8} />
                {notificationCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 size-1.5 rounded-full bg-accent ring-2 ring-page"
                  />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="搜索"

                onClick={onSearch}
                title="全局搜索 (Ctrl/⌘+K)"
              >
                <Search strokeWidth={1.8} />
              </Button>
            </div>
          )}
          {view === 'workbench' && projectId && window.dela && (
            <div className="[-webkit-app-region:no-drag] flex shrink-0 items-center gap-1 px-2">
              <SplitButton>
                <SplitButtonAction
                  aria-label={
                    effectiveOpenTarget === 'vscode'
                      ? vscodeOpenLabel
                      : `在 ${fileManagerName} 中打开项目`
                  }
                  onClick={() => openProjectDirectory(effectiveOpenTarget)}
                  size="icon-sm"
                  title={
                    effectiveOpenTarget === 'vscode'
                      ? vscodeOpenLabel
                      : `在 ${fileManagerName} 中打开项目`
                  }
                >
                  {effectiveOpenTarget === 'vscode' ? (
                    <CodeXml className="text-accent" />
                  ) : (
                    <FolderOpen />
                  )}
                </SplitButtonAction>
                <SplitButtonMenu label="选择项目打开方式">
                  {!projectIsRemote && (
                    <DropdownMenuItem onSelect={() => openProjectDirectory('explorer')}>
                      <FolderOpen />
                      {fileManagerName}
                      {effectiveOpenTarget === 'explorer' && <Check className="ml-auto" />}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => openProjectDirectory('vscode')}>
                    <CodeXml className="text-accent" />
                    {projectIsRemote ? 'VS Code（SSH）' : 'VS Code'}
                    {effectiveOpenTarget === 'vscode' && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                </SplitButtonMenu>
              </SplitButton>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="打开项目终端"

                onClick={() => projectId && useNavigationStore.getState().openTerminal(projectId)}
                title="打开项目终端"
              >
                <SquareTerminal strokeWidth={1.8} />
              </Button>
            </div>
          )}
          {view === 'workbench' && projectId === null && window.dela && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="新聊天"
              className="[-webkit-app-region:no-drag] mr-1"
              onClick={() => void useNavigationStore.getState().newChat(null)}
              title="新聊天"
            >
              <MessageCirclePlus strokeWidth={1.8} />
            </Button>
          )}
          <WindowControls />
        </div>
      </header>
      <Dialog onOpenChange={setHelpOpen} open={helpOpen}>
        <DialogContent size="xl" scroll className="p-8 max-md:p-6">
          <DialogHeader className="items-start gap-4">
            <div>
              <DialogTitle className="text-lg tracking-tight">快捷键</DialogTitle>
              <DialogDescription>
                与设置 › 快捷键 同源；工作台类快捷键需焦点在工作区内。
              </DialogDescription>
            </div>
            <DialogClose className="-mr-1 -mt-1" />
          </DialogHeader>
          <div className="mt-8 grid items-start gap-x-12 gap-y-8 sm:grid-cols-2">
            {shortcutGroups().map((group) => (
              <ShortcutSection key={group.title} title={group.title}>
                {group.actions.map((action) => {
                  const keys = bindings[action.id]
                    ? acceleratorKeys(bindings[action.id], platform, action.family)
                    : null;
                  return (
                    <ShortcutRow
                      hint={keys ? undefined : '未绑定'}
                      key={action.id}
                      keys={keys ?? undefined}
                      label={action.label}
                    />
                  );
                })}
              </ShortcutSection>
            ))}
            <ShortcutSection title="鼠标">
              <ShortcutRow hint="关闭标签" label="中键点击标签" />
              <ShortcutRow hint="新建文件" label="双击目录空白处" />
            </ShortcutSection>
          </div>
        </DialogContent>
      </Dialog>
      {narrow && navDrawerOpen && (
        <div
          aria-hidden="true"
          className={cn(overlayFade, 'absolute inset-x-0 bottom-0 top-10 z-scrim bg-scrim')}
          onMouseDown={() => onMobileDrawerChange?.(null)}
        />
      )}
      <aside
        aria-label="主导航"
        className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-page pb-3 text-ink',
          narrow
            ? cn(
                drawerFromLeft,
                'absolute bottom-0 left-0 top-10 z-overlay w-70 max-w-[85vw] px-2 shadow-overlay',
                !navDrawerOpen && 'hidden',
              )
            : cn(
                // 收起时延后 invisible,让文字先随宽度动画淡出;w-0 会让内容立即消失。
                'col-start-1 row-start-2 transition-[visibility] duration-0',
                sidebarCollapsed && 'invisible delay-200',
              ),
        )}
        id="main-nav"
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            narrow ? cn('min-w-0', drawer === 'page' && 'hidden') : 'px-2',
          )}
          style={narrow ? undefined : { width: effectiveSidebarWidth }}
        >
          <div className="flex h-11 shrink-0 items-center gap-1.5 px-1">
            <span
              className={cn(
                'min-w-0 px-1 text-base font-semibold tracking-tight text-ink',
                labelFade,
                sidebarCollapsed && 'opacity-0',
              )}
            >
              Dela
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-current={view === 'todo' ? 'page' : undefined}
              aria-label={todoUnreadCount > 0 ? `TODO，${todoUnreadCount} 条新消息` : 'TODO'}

              onClick={() => navigate({ page: 'todo' })}
              title="TODO"
            >
              <SquareCheckBig
                className={cn('size-4', todoUnreadCount > 0 && 'text-accent')}
                strokeWidth={1.8}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={notificationCount > 0 ? `通知，${notificationCount} 条未读` : '通知'}
              aria-current={view === 'notifications' ? 'page' : undefined}
              className={cn('relative', view === 'notifications' && 'bg-selected text-ink')}
              onClick={() => navigate({ page: 'notifications' })}
              title="通知"
            >
              <Bell strokeWidth={1.8} />
              {notificationCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-accent ring-2 ring-page"
                />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="搜索"

              onClick={() => {
                onMobileDrawerChange?.(null);
                onSearch();
              }}
              title="全局搜索 (Ctrl/⌘+K)"
            >
              <Search strokeWidth={1.8} />
            </Button>
          </div>
          <ProjectSessionNav
            activeBusinessId={navEntries.find((entry) => entry.id === view)?.id ?? null}
            activeProjectId={view === 'workbench' ? projectId : null}
            activeSessionId={view === 'home' ? null : activeSessionId}
            collapsed={!narrow && sidebarCollapsed}
            generalChatActive={view === 'home'}
            onDeleteSession={onDeleteSession}
            onNewChat={(id) => void useNavigationStore.getState().newChat(id)}
            onNavigateBusiness={onNavigateBusiness}
            onNewProject={() => {
              onNewProject();
              if (narrow) onMobileDrawerChange?.(null);
            }}
            onOpenGeneralChat={() => {
              onOpenGeneralChat();
              if (narrow) onMobileDrawerChange?.(null);
            }}
            onOpenProject={(id) => {
              onOpenProject(id);
              if (narrow) onMobileDrawerChange?.(null);
            }}
            onOpenSession={onOpenSession}
            onOpenSources={() => {
              onOpenSources();
              if (narrow) onMobileDrawerChange?.(null);
            }}
            runBadge={runBadge}
            sessionsByProject={sessionsByProject}
            sourcesActive={sourcesActive}
          />
          <div className="grid shrink-0 gap-0.5 pt-2">
            <button
              aria-current={view === 'settings' ? 'page' : undefined}
              className={navRow(view === 'settings')}
              onClick={() => navigate('settings')}
              type="button"
            >
              <Settings className={navIcon(view === 'settings')} strokeWidth={1.8} />
              <span className={cn('truncate', labelFade, sidebarCollapsed && 'opacity-0')}>
                设置
              </span>
            </button>
          </div>
        </div>
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col',
            narrow && drawer === 'page' ? cn('flex', fadeIn) : 'hidden',
          )}
        >
          <div className="flex h-11 shrink-0 items-center px-1">
            <button
              aria-label="返回主菜单"
              className={navRow(false)}
              onClick={() => onMobileDrawerChange?.('nav')}
              type="button"
            >
              <ChevronLeft className="size-4" strokeWidth={1.8} />
              <span>主菜单</span>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col" ref={onDrawerSlot} />
        </div>
      </aside>
      <Resizable
        className={cn(
          'col-start-3 row-start-2 bg-transparent',
          // 折叠/窄屏时间隔条整体隐藏（网格列为固定 1px，不影响布局）：
          // 仅 pointer-events-none 时键盘仍可聚焦，方向键调整是看不见的假反馈。
          (sidebarCollapsed || narrow) && 'hidden',
        )}
        label="调整侧边栏宽度"
        // 拖拽绑定用户偏好值与原上限：渲染宽度另有视口钳制，若把钳制值当 max，
        // 窄窗下 min==max==value 会把拖拽完全锁死，还会把钳制值写回偏好。
        max={360}
        min={200}
        onValueChange={setSidebarWidth}
        onResizingChange={setSidebarResizing}
        value={sidebarWidth}
      />
      {/* 浮岛卡片：分隔线仅占 1px，拖动命中范围由 Resizable 的透明伪元素扩展。 */}
      <main
        className={cn(
          'relative col-start-4 row-start-2 mt-1 mr-1.5 flex min-w-0 flex-col overflow-hidden rounded-t-window bg-surface shadow-hairline',
          'max-md:mt-0 max-md:mr-0 max-md:rounded-none max-md:border-0',
        )}
        id="app-main"
      >
        {children}
        <Toaster />
        <Lightbox />
      </main>
    </div>
  );
}
