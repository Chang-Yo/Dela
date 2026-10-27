// 项目会话导航：顶部功能入口，中部按项目分组的会话历史（前 3 条 + 「显示更多」）。
// 会话数据与运行徽标由接入方注入（本组件不 import sessions/）；通用池会话不入项目树。
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { Dialog, DropdownMenu as Menu } from 'radix-ui';
import {
  ChevronRight,
  Cloud,
  Folder,
  FolderOpen,
  House,
  MoreHorizontal,
  Plus,
  SquarePen,
  Pencil,
  Pin,
  PinOff,
  Archive,
  Trash2,
  List,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { EntryDialogs, type EntryDialogRequest } from '../workspace/entry-dialogs';
import { cn } from '../lib/utils';
import { fileManagerName } from '../lib/platform';
import type { WorkspaceEntry } from '../../shared/api';
import { remoteAccent } from './remote-color';
import { useExperimental } from '../features/settings/experimental';
import { useVisibleNavEntries, type NavEntryId } from './entries';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { showToast } from '../app/toasts';
import { SessionRow, type NavSessionSummary, type SessionRunBadge } from './SessionRow';
import { useNavigationStore, useProjectNavPrefs } from './store';
import { closeSessionTabs, refreshSessionLists } from '../sessions/store';
import { dialogOverlay, dialogPanel } from '../components/ui/motion';
import { Input } from '../components/ui/input';
import { purgeRemovedEntries } from '../workbench/removed-cleanup';
import { menuItem, menuPanel } from '../components/ui/menu-styles';
import { navIcon, navRow, navSectionTitle, rowActions, rowIconButton } from './nav-styles';
import { useRemoteActivity } from './remote-activity';
import { RemoteConnectionTip } from './remote-connection-tip';
import { useRemoteConnections } from './remote-connections';

export type { NavSessionSummary, SessionRunBadge };

/** 底部业务入口 id（邮箱/课表/课堂视频/水源；TODO 入口在顶栏铃铛旁，跳转由 onNavigateBusiness 注入）。 */
export type BusinessNavId = Exclude<NavEntryId, 'sources'>;

/** 每项目默认展示的近期会话条数（§4.1「前 3 条 + 显示更多」）。 */
export const RECENT_SESSIONS = 3;

/** 侧栏文字随折叠状态淡入/淡出（与 AppShell 壳的宽度过渡同步）。 */
const labelFade = 'transition-opacity duration-200 ease-out';

export function ProjectSessionNav({
  /** 按项目 id 注入的近期会话（近期优先排序），来自 sessions/ 镜像。 */
  sessionsByProject,
  /** 会话运行状态徽标，来自 sessions/runs 镜像。 */
  runBadge,
  onOpenSession,
  onDeleteSession,
  activeSessionId = null,
  onOpenProject,
  onNewProject,
  onNewChat,
  /** 顶部「通用聊天」入口（无项目会话池，§4.1 保留）。 */
  onOpenGeneralChat,
  generalChatActive = false,
  /** 顶部「资料」入口（通用/资料工作台）与互斥高亮。 */
  onOpenSources,
  sourcesActive = false,
  activeProjectId = null,
  /** 底部业务入口跳转（邮箱/课表/水源），由接线方注入。 */
  onNavigateBusiness,
  activeBusinessId = null,
  /** 侧栏折叠时文字淡出（与 AppShell 折叠动画同步）。 */
  collapsed = false,
}: {
  sessionsByProject: Record<string, NavSessionSummary[]>;
  runBadge: (sessionId: string) => SessionRunBadge;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  activeSessionId?: string | null;
  onOpenProject: (projectId: string) => void;
  onNewProject: () => void;
  onNewChat?: (projectId: string | null) => void;
  onOpenGeneralChat: () => void;
  generalChatActive?: boolean;
  onOpenSources?: () => void;
  sourcesActive?: boolean;
  activeProjectId?: string | null;
  onNavigateBusiness?: (id: BusinessNavId) => void;
  activeBusinessId?: BusinessNavId | null;
  collapsed?: boolean;
}) {
  const entries = useWorkspaceStore((s) => s.workspace.entries);
  const visibleEntries = useVisibleNavEntries();
  useEffect(() => {
    void useExperimental.getState().load();
  }, []);
  const openProjects = useNavigationStore((s) => s.openProjects);
  const toggleProject = useNavigationStore((s) => s.toggleProject);
  const fullSessionLists = useNavigationStore((s) => s.fullSessionLists);
  const toggleFullSessionList = useNavigationStore((s) => s.toggleFullSessionList);
  const preferences = useProjectNavPrefs((state) => state.projects);
  const setProjectPreference = useProjectNavPrefs((state) => state.setProject);
  const projects = entries
    .filter((entry) => entry.kind === 'project')
    .sort(
      (a, b) =>
        Number(Boolean(preferences[b.id]?.pinned)) - Number(Boolean(preferences[a.id]?.pinned)),
    );
  // 远端项目的悬浮提示要「连的是哪台」与「此刻在不在连」：连接列表按涉及到的连接拉一次，
  // 取数状态由目录树写、这里读（两处说法因此一致）。
  const remoteIdsKey = projects
    .map((project) => project.remoteId)
    .filter(Boolean)
    .join('|');
  const connections = useRemoteConnections(remoteIdsKey);
  const activity = useRemoteActivity((state) => state.byProject);
  const [entryRequest, setEntryRequest] = useState<EntryDialogRequest | null>(null);
  const [sectionProjectId, setSectionProjectId] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  useEffect(() => {
    if (confirmArchive === null) return;
    const cancel = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-archive-confirm]')))
        setConfirmArchive(null);
    };
    document.addEventListener('pointerdown', cancel);
    return () => document.removeEventListener('pointerdown', cancel);
  }, [confirmArchive]);
  const sectionNames = [
    ...new Set(
      Object.values(preferences)
        .map((pref) => pref.section)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const runAction = async (title: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (cause) {
      showToast({ variant: 'error', title, description: errorText(cause) });
    }
  };
  const hidden = cn('truncate', labelFade, collapsed && 'opacity-0');

  /** 会话历史组（通用对话/项目）共用的一段：折叠头 + 近期会话 + 「显示更多」。
   *  行点击即展开/折叠该组；打开项目工作台走项目菜单的「打开项目」。
   *  图标与配色跟着项目走：远端项目用云朵与该连接的配色，和资源管理器里是同一副样子。 */
  const sessionGroup = (
    project: WorkspaceEntry,
    sessions: NavSessionSummary[],
    groupActive: boolean,
  ) => {
    const key = project.id;
    const label = project.name;
    const Icon = project.remoteId ? Cloud : Folder;
    const accent = project.remoteId ? { color: remoteAccent(project.remoteId, 'text') } : undefined;
    const expanded = openProjects.includes(key);
    const full = fullSessionLists.includes(key);
    const unpinned = sessions.filter((session) => !session.pinned);
    const visible = full ? unpinned : unpinned.slice(0, RECENT_SESSIONS);
    // 会话行已高亮时项目行不再叠加底色：位置强调只落在最深的一个可见行上。
    // 可见 = 置顶区的置顶会话，或展开后列出的近期会话（折叠、藏在「显示更多」后的不算）。
    const shownActiveSession =
      expanded && visible.some((session) => session.id === activeSessionId);
    const rowActive =
      groupActive &&
      !shownActiveSession &&
      !sessions.some((session) => session.pinned && session.id === activeSessionId);
    // 远端项目行挂连接提示：连的是哪台、远端根在哪、此刻在不在连（本机行不需要）。
    // 挂在项目名按钮上而不是整行：键盘聚焦时也能看到，而且鼠标移到右侧动作区时提示该让位。
    const labelButton = (
      <button
        aria-current={rowActive ? 'page' : undefined}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => toggleProject(key)}
        title={project.remoteId ? undefined : label}
        type="button"
      >
        <Icon className={navIcon(rowActive)} strokeWidth={1.8} style={accent} />
        <span className={cn('sidebar-title min-w-0 flex-1', labelFade, collapsed && 'opacity-0')}>
          {label}
        </span>
      </button>
    );
    return (
      <div key={key} className="min-w-0">
        <div className={cn(navRow(rowActive), 'group group/nav relative pl-1.5')}>
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? '收起' : '展开'} ${label} 的会话`}
            className="grid size-4 shrink-0 place-items-center text-ink-3"
            onClick={() => toggleProject(key)}
            type="button"
          >
            <ChevronRight
              className={cn(
                'size-3 transition-transform duration-150 motion-reduce:transition-none',
                expanded && 'rotate-90',
              )}
            />
          </button>
          {project.remoteId ? (
            <Tooltip>
              <TooltipTrigger asChild>{labelButton}</TooltipTrigger>
              <TooltipContent side="right" className="px-2.5 py-2">
                <RemoteConnectionTip
                  activity={activity[project.id]}
                  connection={connections[project.remoteId]}
                  project={project}
                />
              </TooltipContent>
            </Tooltip>
          ) : (
            labelButton
          )}
          {!collapsed && (
            <div className={cn(rowActions, rowActive ? 'bg-hover-2' : 'bg-hover')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={`${label} 的项目菜单`}
                    title="项目菜单"
                    className={rowIconButton}
                    type="button"
                  >
                    <MoreHorizontal />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-56">
                  <DropdownMenuLabel className="break-words text-13 text-ink">
                    {label}
                  </DropdownMenuLabel>
                  <DropdownMenuLabel>{sessions.length} 个对话</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onOpenProject(key)}>
                    <FolderOpen />
                    打开项目
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      setProjectPreference(key, { pinned: !preferences[key]?.pinned })
                    }
                  >
                    {preferences[key]?.pinned ? <PinOff /> : <Pin />}
                    {preferences[key]?.pinned ? '取消置顶' : '置顶'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEntryRequest({ action: 'rename', id: key })}>
                    <Pencil />
                    编辑项目
                  </DropdownMenuItem>
                  <Menu.Sub>
                    <Menu.SubTrigger className={cn(menuItem, 'data-[state=open]:bg-hover')}>
                      <List />
                      分组
                      <ChevronRight className="ml-auto" />
                    </Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent className={cn(menuPanel, 'min-w-40')} sideOffset={4}>
                        <DropdownMenuItem
                          onSelect={() => setProjectPreference(key, { section: '' })}
                        >
                          默认分组
                        </DropdownMenuItem>
                        {sectionNames.map((name) => (
                          <DropdownMenuItem
                            key={name}
                            onSelect={() => setProjectPreference(key, { section: name })}
                          >
                            {name}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            setSectionProjectId(key);
                            setSectionName('');
                          }}
                        >
                          <Plus />
                          新建分组
                        </DropdownMenuItem>
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>
                  <DropdownMenuItem
                    onSelect={() =>
                      void runAction('打开目录失败', async () =>
                        window.dela?.workspace.openLocal(key),
                      )
                    }
                  >
                    <FolderOpen />在 {fileManagerName} 中显示
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {/* 「新建对话」由悬停按钮承担，不进菜单；行点击用于展开/折叠会话组。 */}
                  <DropdownMenuItem disabled={archiving} onSelect={() => setConfirmArchive(key)}>
                    <Archive />
                    归档项目对话
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setEntryRequest({ action: 'remove', id: key })}
                  >
                    <Trash2 />
                    移除项目
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {onNewChat && (
                <button
                  aria-label={`在 ${label} 中新建对话`}
                  title="新对话"
                  className={rowIconButton}
                  onClick={() => onNewChat(key)}
                  type="button"
                >
                  <SquarePen />
                </button>
              )}
            </div>
          )}
        </div>
        {confirmArchive === key && (
          <div className="flex items-center gap-2 py-1 pl-8">
            <Button
              data-archive-confirm=""
              size="sm"
              variant="destructive"
              disabled={archiving}
              onClick={() =>
                void runAction('归档失败', async () => {
                  if (!window.dela) throw new Error('会话管理仅在桌面端可用');
                  setArchiving(true);
                  try {
                    const ids = await window.dela.session.archiveProject(key);
                    closeSessionTabs(ids);
                    await refreshSessionLists();
                    setConfirmArchive(null);
                  } finally {
                    setArchiving(false);
                  }
                })
              }
            >
              确认归档全部对话
            </Button>
          </div>
        )}
        {expanded && (
          <div className="grid grid-cols-1 gap-px pb-1">
            {sessions.length === 0 && onNewChat && (
              <button
                className="flex h-7 items-center gap-2 rounded-control pl-8 pr-2 text-left text-13 text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink-2"
                onClick={() => onNewChat(key)}
                type="button"
              >
                <SquarePen className="size-3.5 shrink-0" />
                新建第一个对话
              </button>
            )}
            {visible.map((session) => (
              <SessionRow
                projectName={label}
                remoteId={project.remoteId}
                active={session.id === activeSessionId}
                badge={runBadge(session.id)}
                key={session.id}
                onDelete={onDeleteSession}
                onOpen={onOpenSession}
                session={session}
              />
            ))}
            {unpinned.length > RECENT_SESSIONS && (
              <button
                className="flex h-7 items-center rounded-control pl-8 pr-2 text-left text-xs text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink-2"
                onClick={() => toggleFullSessionList(key)}
                type="button"
              >
                {full ? '收起' : `显示更多（${unpinned.length - RECENT_SESSIONS}）`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 功能入口、置顶与「项目」标题行固定在顶部；滚动只发生在项目列表项。 */}
      <nav aria-label="功能入口" className="grid shrink-0 gap-px">
        <button
          aria-current={generalChatActive ? 'page' : undefined}
          className={navRow(generalChatActive)}
          onClick={onOpenGeneralChat}
          type="button"
        >
          <House className={navIcon(generalChatActive)} strokeWidth={1.8} />
          <span className={hidden}>首页</span>
        </button>
        {visibleEntries.map((item) => {
          const Icon = item.icon;
          const active = item.id === 'sources' ? sourcesActive : item.id === activeBusinessId;
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={navRow(active)}
              key={item.id}
              onClick={() =>
                item.id === 'sources' ? onOpenSources?.() : onNavigateBusiness?.(item.id)
              }
              type="button"
            >
              <Icon className={navIcon(active)} strokeWidth={1.8} />
              <span className={hidden}>{item.label}</span>
            </button>
          );
        })}
      </nav>
      {/* 置顶与「项目」标题行固定：钉住的内容常驻可见，滚动条也只覆盖项目列表项。 */}
      {(projects.some((project) => preferences[project.id]?.pinned) ||
        projects.some((project) =>
          sessionsByProject[project.id]?.some((session) => session.pinned),
        )) && (
        <section aria-label="置顶" className="mt-5 grid shrink-0 gap-px">
          <p className={cn(navSectionTitle, labelFade, collapsed && 'opacity-0')}>置顶</p>
          {projects
            .filter((project) => preferences[project.id]?.pinned)
            .map((project) =>
              sessionGroup(
                project,
                sessionsByProject[project.id] ?? [],
                project.id === activeProjectId,
              ),
            )}
          {projects.flatMap((project) =>
            (sessionsByProject[project.id] ?? [])
              .filter((session) => session.pinned)
              .map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  projectName={project.name}
                  remoteId={project.remoteId}
                  active={session.id === activeSessionId}
                  onOpen={onOpenSession}
                  onDelete={onDeleteSession}
                />
              )),
          )}
        </section>
      )}
      <div className="mt-5 flex shrink-0 items-center justify-between px-2 pb-1">
        <span
          className={cn(
            'whitespace-nowrap text-xs font-medium text-ink-3',
            labelFade,
            collapsed && 'opacity-0',
          )}
          id="project-session-nav-title"
        >
          项目
        </span>
        <button
          aria-label="新建项目"
          className={rowIconButton}
          onClick={onNewProject}
          title="新建项目"
          type="button"
        >
          <Plus strokeWidth={1.8} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <section aria-labelledby="project-session-nav-title" className="grid content-start gap-px">
          {['', ...sectionNames].map((section) => (
            <div key={section} className="min-w-0">
              {section &&
                projects.some(
                  (project) =>
                    !preferences[project.id]?.pinned &&
                    preferences[project.id]?.section === section,
                ) && <p className={cn(navSectionTitle, 'pt-3 font-normal')}>{section}</p>}
              {projects
                .filter(
                  (project) =>
                    !preferences[project.id]?.pinned &&
                    (preferences[project.id]?.section ?? '') === section,
                )
                .map((project) =>
                  sessionGroup(
                    project,
                    sessionsByProject[project.id] ?? [],
                    project.id === activeProjectId,
                  ),
                )}
            </div>
          ))}
        </section>
      </div>
      <EntryDialogs
        request={entryRequest}
        onClose={() => setEntryRequest(null)}
        onRemoved={purgeRemovedEntries}
      />
      <Dialog.Root
        open={sectionProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setSectionProjectId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlay} />
          <Dialog.Content className={cn(dialogPanel, 'max-w-sm')}>
            <Dialog.Title className="text-base font-semibold">新建项目分组</Dialog.Title>
            <Dialog.Description className="mt-1 text-13 text-ink-3">
              将当前项目放入此分组。
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const name = sectionName.trim();
                if (sectionProjectId && name) {
                  setProjectPreference(sectionProjectId, { section: name });
                  setSectionProjectId(null);
                }
              }}
            >
              <Input
                aria-label="分组名称"
                className="my-4"
                value={sectionName}
                maxLength={80}
                onChange={(event) => setSectionName(event.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="ghost">取消</Button>
                </Dialog.Close>
                <Button type="submit" disabled={!sectionName.trim()}>
                  创建
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
