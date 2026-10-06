// 项目会话导航（docs/agent-workspace-plan.md §4.1、structure.md §3.1）：顶部为通用聊天 /
// 资料 / 业务入口位，中部为按项目展开的会话历史（前 3 条 + 「显示更多」，可滚动）；
// 通用池会话不入项目树（随聊不属于任何项目），经「首页」与全局搜索可达。
// 底部设置位由 AppShell 提供。项目列表来自 workspace/ 条目镜像；
// 会话数据与运行徽标经注入接口进入，本组件不 import sessions/（3B 接线时由 sessions/
// 镜像提供，见下方 props 注释）。
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Dialog, DropdownMenu as Menu } from 'radix-ui';
import {
  CalendarDays,
  ChevronRight,
  CircleCheckBig,
  Folder,
  FolderOpen,
  House,
  Mail,
  MoreHorizontal,
  Plus,
  SquarePen,
  Pencil,
  Pin,
  PinOff,
  Archive,
  X,
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
import { EntryDialogs } from '../workspace/entry-dialogs';
import { cn } from '../lib/utils';
import { ShuiyuanIcon } from '../components/ui/shuiyuan-icon';
import { useWorkspaceStore } from '../workspace/store';
import { SessionRow, type NavSessionSummary, type SessionRunBadge } from './SessionRow';
import { useNavigationStore, useProjectNavPrefs } from './store';
import { closeSessionTabs, refreshSessionLists } from '../sessions/store';

export type { NavSessionSummary, SessionRunBadge };

/** 底部业务入口 id（邮箱/课表/水源/TODO；跳转由 onNavigateBusiness 注入）。 */
export type BusinessNavId = 'mail' | 'timetable' | 'shuiyuan' | 'todo';

/** 每项目默认展示的近期会话条数（§4.1「前 3 条 + 显示更多」）。 */
export const RECENT_SESSIONS = 3;

const businessNav: Array<{ id: BusinessNavId; label: string; icon: typeof Mail }> = [
  { id: 'mail', label: '邮箱', icon: Mail },
  { id: 'timetable', label: '课表', icon: CalendarDays },
  { id: 'shuiyuan', label: '水源(beta)', icon: ShuiyuanIcon },
  { id: 'todo', label: 'TODO', icon: CircleCheckBig },
];

/** 侧栏文字随折叠状态淡入/淡出（与 AppShell 壳的宽度过渡同步）。 */
const labelFade = 'transition-opacity duration-200 ease-out';

const rowClass = (active: boolean) =>
  cn(
    'flex h-8 min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors',
    active
      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
  );

export function ProjectSessionNav({
  /** 按项目 id 注入的近期会话（近期优先排序）；3B 接线：来自 sessions/ 镜像。 */
  sessionsByProject,
  /** 会话运行状态徽标；3B 接线：来自 sessions/runs 镜像。 */
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
  /** 底部业务入口跳转（邮箱/课表/水源/TODO），由接线方注入。 */
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
  const openProjects = useNavigationStore((s) => s.openProjects);
  const toggleProject = useNavigationStore((s) => s.toggleProject);
  const fullSessionLists = useNavigationStore((s) => s.fullSessionLists);
  const toggleFullSessionList = useNavigationStore((s) => s.toggleFullSessionList);
  const preferences = useProjectNavPrefs((state) => state.projects);
  const setProjectPreference = useProjectNavPrefs((state) => state.setProject);
  const projects = entries
    .filter((entry) => entry.kind === 'project' && !preferences[entry.id]?.hidden)
    .sort(
      (a, b) =>
        Number(Boolean(preferences[b.id]?.pinned)) - Number(Boolean(preferences[a.id]?.pinned)),
    );
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [sectionProjectId, setSectionProjectId] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
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
  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };
  const hidden = cn('truncate', labelFade, collapsed && 'opacity-0');

  /** 会话历史组（通用对话/项目）共用的一段：折叠头 + 近期会话 + 「显示更多」。 */
  const sessionGroup = (
    key: string,
    label: string,
    icon: typeof Mail,
    sessions: NavSessionSummary[],
    onOpenGroup: () => void,
    groupActive: boolean,
  ) => {
    const expanded = openProjects.includes(key);
    const full = fullSessionLists.includes(key);
    const unpinned = sessions.filter((session) => !session.pinned);
    const visible = full ? unpinned : unpinned.slice(0, RECENT_SESSIONS);
    const Icon = icon;
    return (
      <div key={key} className="min-w-0">
        <div className={cn(rowClass(groupActive), 'group/nav relative pl-2')}>
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? '收起' : '展开'} ${label} 的会话`}
            className="grid size-4 shrink-0 place-items-center text-muted-foreground"
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
          <button
            aria-current={groupActive ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={onOpenGroup}
            title={label}
            type="button"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
            <span
              className={cn('sidebar-title min-w-0 flex-1', labelFade, collapsed && 'opacity-0')}
            >
              {label}
            </span>
          </button>
          {!collapsed && (
            <div className="pointer-events-none absolute right-1 flex items-center gap-0.5 rounded-md bg-sidebar opacity-0 transition-opacity duration-200 group-hover/nav:pointer-events-auto group-hover/nav:opacity-100 group-focus-within/nav:pointer-events-auto group-focus-within/nav:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 max-md:pointer-events-auto max-md:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={`${label} 的项目菜单`}
                    title="项目菜单"
                    className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    type="button"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-56">
                  <DropdownMenuLabel className="break-words text-foreground">
                    {label}
                  </DropdownMenuLabel>
                  <DropdownMenuLabel>{sessions.length} 个对话</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      setProjectPreference(key, { pinned: !preferences[key]?.pinned })
                    }
                  >
                    {preferences[key]?.pinned ? <PinOff /> : <Pin />}
                    {preferences[key]?.pinned ? '取消置顶' : '置顶'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRenameProjectId(key)}>
                    <Pencil />
                    编辑项目
                  </DropdownMenuItem>
                  <Menu.Sub>
                    <Menu.SubTrigger className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent">
                      <List className="size-4" />
                      分组
                      <ChevronRight className="ml-auto size-4" />
                    </Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
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
                      void runAction(async () => window.dela?.workspace.openLocal(key))
                    }
                  >
                    <FolderOpen />
                    在资源管理器中显示
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {/* 「打开项目文件」「新建对话」由行点击与悬停按钮承担，不进菜单。 */}
                  <DropdownMenuItem disabled={archiving} onSelect={() => setConfirmArchive(key)}>
                    <Archive />
                    归档项目对话
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setProjectPreference(key, { hidden: true })}>
                    <X />
                    移除项目入口
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {onNewChat && (
                <button
                  aria-label={`在 ${label} 中新建对话`}
                  title="新对话"
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  onClick={() => onNewChat(key)}
                  type="button"
                >
                  <SquarePen className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        {confirmArchive === key && (
          <div className="flex items-center gap-2 px-2 py-1">
            <Button
              data-archive-confirm=""
              size="sm"
              variant="destructive"
              disabled={archiving}
              onClick={() =>
                void runAction(async () => {
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
          <div className="grid grid-cols-1 gap-0.5">
            {sessions.length === 0 && onNewChat && (
              <button
                className="ml-6 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
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
                className="ml-6 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
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
      <nav aria-label="功能入口" className="grid shrink-0 gap-0.5">
        <button
          aria-current={generalChatActive ? 'page' : undefined}
          className={rowClass(generalChatActive)}
          onClick={onOpenGeneralChat}
          type="button"
        >
          <House className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <span className={hidden}>首页</span>
        </button>
        <button
          aria-current={sourcesActive ? 'page' : undefined}
          className={rowClass(sourcesActive)}
          onClick={onOpenSources}
          type="button"
        >
          <FolderOpen className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <span className={hidden}>资料</span>
        </button>
        {businessNav.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeBusinessId;
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={rowClass(active)}
              key={item.id}
              onClick={() => onNavigateBusiness?.(item.id)}
              type="button"
            >
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
                strokeWidth={1.8}
              />
              <span className={hidden}>{item.label}</span>
            </button>
          );
        })}
      </nav>
      {(projects.some((project) => preferences[project.id]?.pinned) ||
        projects.some((project) =>
          sessionsByProject[project.id]?.some((session) => session.pinned),
        )) && (
        <section aria-label="置顶" className="mt-5 grid min-h-0 shrink gap-0.5 overflow-y-auto">
          <p
            className={cn(
              'px-2 pb-1 text-xs font-medium text-muted-foreground',
              labelFade,
              collapsed && 'opacity-0',
            )}
          >
            置顶
          </p>
          {projects
            .filter((project) => preferences[project.id]?.pinned)
            .map((project) =>
              sessionGroup(
                project.id,
                project.name,
                Folder,
                sessionsByProject[project.id] ?? [],
                () => onOpenProject(project.id),
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
                  active={session.id === activeSessionId}
                  onOpen={onOpenSession}
                  onDelete={onDeleteSession}
                />
              )),
          )}
        </section>
      )}
      <section
        aria-labelledby="project-session-nav-title"
        className="mt-5 flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center justify-between px-2 pb-1">
          <span
            className={cn(
              'whitespace-nowrap text-xs font-medium text-muted-foreground',
              labelFade,
              collapsed && 'opacity-0',
            )}
            id="project-session-nav-title"
          >
            项目
          </span>
          <button
            aria-label="新建项目"
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            onClick={onNewProject}
            title="新建项目"
            type="button"
          >
            <Plus className="size-3.5" strokeWidth={1.8} />
          </button>
        </div>
        <div className="grid min-h-0 grid-cols-1 flex-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto">
          {['', ...sectionNames].map((section) => (
            <div key={section} className="min-w-0">
              {section &&
                projects.some(
                  (project) =>
                    !preferences[project.id]?.pinned &&
                    preferences[project.id]?.section === section,
                ) && <p className="px-2 pb-1 pt-3 text-xs text-muted-foreground">{section}</p>}
              {projects
                .filter(
                  (project) =>
                    !preferences[project.id]?.pinned &&
                    (preferences[project.id]?.section ?? '') === section,
                )
                .map((project) =>
                  sessionGroup(
                    project.id,
                    project.name,
                    Folder,
                    sessionsByProject[project.id] ?? [],
                    () => onOpenProject(project.id),
                    project.id === activeProjectId,
                  ),
                )}
            </div>
          ))}
        </div>
      </section>
      <EntryDialogs
        request={renameProjectId ? { action: 'rename', id: renameProjectId } : null}
        onClose={() => setRenameProjectId(null)}
      />
      {actionError && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {actionError}
        </p>
      )}
      <Dialog.Root
        open={sectionProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setSectionProjectId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150 max-md:w-[calc(100%-2rem)]">
            <Dialog.Title className="text-sm font-medium">新建项目分组</Dialog.Title>
            <Dialog.Description className="mt-2 text-xs text-muted-foreground">
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
              <input
                aria-label="分组名称"
                className="my-4 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={sectionName}
                maxLength={80}
                onChange={(event) => setSectionName(event.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-3">
                <Dialog.Close className="text-sm">取消</Dialog.Close>
                <button
                  type="submit"
                  disabled={!sectionName.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                >
                  创建
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
