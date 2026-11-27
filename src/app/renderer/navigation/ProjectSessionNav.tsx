// 顶部功能入口与按项目分组的会话历史；会话数据与运行徽标由接入方注入。
import { useState } from 'react';
import { Button } from '../../../ui/button';
import { useDismissOnOutsidePointer } from '../../../ui/hooks/use-dismiss-on-outside-pointer';
import { CollapsibleChevron } from '../../../ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/tooltip';
import {
  MessageCirclePlus,
  Server,
  Folder,
  FolderOpen,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { EntryDialogs, type EntryDialogRequest } from '../workspace/entry-dialogs';
import { cn } from '../../../ui/lib/cn';
import type { WorkspaceEntry } from '../../../modules/workspace/contract';
import { remoteAccent } from '../../../modules/remotes/view';
import { useVisibleNavEntries, type NavEntryId } from './entries';
import { showToast } from '../../../ui/toast';
import { SessionRow, type NavSessionSummary, type SessionRunBadge } from './SessionRow';
import { usePreferences } from '../shell/preferences';
import { useTreeState } from './store';
import { refreshSessionLists, chatClient } from '../../../modules/chat/view';
import { closeTabEverywhere } from '../workbench/layout-store';
import { Input } from '../../../ui/input';
import { purgeRemovedEntries } from '../workbench/removed-cleanup';
import { navIcon, navRow, navSectionTitle, rowActions } from './nav-styles';
import { useRemoteActivity } from './remote-activity';
import { RemoteConnectionTip } from './remote-connection-tip';
import { useRemoteConnections } from './remote-connections';
import { workspaceClient, useWorkspaceStore } from '../../../modules/workspace/view';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../ui/dialog';
import { errorMessage } from '../../../core/protocol/contract';

const fileManagerName = window.dela?.platform === 'darwin' ? 'Finder' : '资源管理器';

export type { NavSessionSummary, SessionRunBadge };

export type BusinessNavId = Exclude<NavEntryId, 'sources'>;

const RECENT_SESSIONS = 3;

const labelFade = 'transition-opacity duration-slow ease-out';

export function ProjectSessionNav({
  sessionsByProject,
  runBadge,
  onOpenSession,
  onDeleteSession,
  activeSessionId = null,
  onOpenProject,
  onNewProject,
  onNewChat,
  onOpenGeneralChat,
  generalChatActive = false,
  onOpenSources,
  sourcesActive = false,
  activeProjectId = null,
  onNavigateBusiness,
  activeBusinessId = null,
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
  activeBusinessId?: NavEntryId | null;
  collapsed?: boolean;
}) {
  const entries = useWorkspaceStore((s) => s.workspace.entries);
  const visibleEntries = useVisibleNavEntries();
  const openProjects = useTreeState((s) => s.openProjects);
  const toggleProject = useTreeState((s) => s.toggleProject);
  const fullSessionLists = useTreeState((s) => s.fullSessionLists);
  const toggleFullSessionList = useTreeState((s) => s.toggleFullSessionList);
  const preferences = usePreferences((state) => state.projectNav);
  const setProjectPreference = usePreferences((state) => state.patchProjectNav);
  const projects = entries
    .filter((entry) => entry.kind === 'project')
    .sort(
      (a, b) =>
        Number(Boolean(preferences[b.id]?.pinned)) - Number(Boolean(preferences[a.id]?.pinned)),
    );
  // 连接取自共享缓存，取数状态由目录树写、这里读，两处说法因此一致。
  const connections = useRemoteConnections();
  const activity = useRemoteActivity((state) => state.byProject);
  const [entryRequest, setEntryRequest] = useState<EntryDialogRequest | null>(null);
  const [sectionProjectId, setSectionProjectId] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  useDismissOnOutsidePointer(confirmArchive !== null, '[data-archive-confirm]', () =>
    setConfirmArchive(null),
  );
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
      showToast({ variant: 'error', title, description: errorMessage(cause) });
    }
  };
  const hidden = cn('truncate', labelFade, collapsed && 'opacity-0');

  const sessionGroup = (
    project: WorkspaceEntry,
    sessions: NavSessionSummary[],
    groupActive: boolean,
  ) => {
    const key = project.id;
    const label = project.name;
    const Icon = project.remoteId ? Server : Folder;
    const accent = project.remoteId ? { color: remoteAccent(project.remoteId, 'text') } : undefined;
    const expanded = openProjects.includes(key);
    const full = fullSessionLists.includes(key);
    const unpinned = sessions.filter((session) => !session.pinned);
    const visible = full ? unpinned : unpinned.slice(0, RECENT_SESSIONS);
    // 会话行已高亮时项目行不再叠加底色：位置强调只落在最深的一个可见行上。
    const shownActiveSession =
      expanded && visible.some((session) => session.id === activeSessionId);
    const rowActive =
      groupActive &&
      !shownActiveSession &&
      !sessions.some((session) => session.pinned && session.id === activeSessionId);
    // 远端项目行挂连接提示；挂在名称按钮上而非整行，键盘聚焦时也能看到。
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
            <CollapsibleChevron open={expanded} />
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
            <div className={cn(rowActions, rowActive ? 'bg-selected' : 'bg-hover')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${label} 的项目菜单`}
                    title="项目菜单"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-56">
                  <DropdownMenuLabel className="break-words text-sm text-ink">
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
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <List />
                      分组
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-40">
                      <DropdownMenuItem onSelect={() => setProjectPreference(key, { section: '' })}>
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
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem
                    onSelect={() =>
                      void runAction('打开目录失败', async () => workspaceClient.openLocal(key))
                    }
                  >
                    <FolderOpen />在 {fileManagerName} 中显示
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`在 ${label} 中新建对话`}
                  title="新对话"

                  onClick={() => onNewChat(key)}
                >
                  <SquarePen />
                </Button>
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
                    const ids = await chatClient.archiveProject(key);
                    ids.forEach((id) => closeTabEverywhere(`chat:${id}`));
                    await refreshSessionLists();
                    setConfirmArchive(null);
                  } catch (cause) {
                    setArchiving(false);
                    throw cause;
                  }
                  setArchiving(false);
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
                className="flex h-7 items-center gap-2 rounded-control pl-8 pr-2 text-left text-sm text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink-2"
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
                className="flex h-7 items-center rounded-control pl-8 pr-2 text-left text-xs text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink-2"
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
      <nav aria-label="功能入口" className="grid shrink-0 gap-px">
        <button
          aria-current={generalChatActive ? 'page' : undefined}
          className={navRow(generalChatActive)}
          onClick={onOpenGeneralChat}
          type="button"
        >
          <MessageCirclePlus className={navIcon(generalChatActive)} strokeWidth={1.8} />
          <span className={hidden}>新对话</span>
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
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="新建项目"

          onClick={onNewProject}
          title="新建项目"
        >
          <Plus strokeWidth={1.8} />
        </Button>
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
      <Dialog
        open={sectionProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setSectionProjectId(null);
        }}
      >
        <DialogContent size="sm">
          <DialogTitle>新建项目分组</DialogTitle>
          <DialogDescription>将当前项目放入此分组。</DialogDescription>
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
            <DialogFooter className="mt-0">
              <Button onClick={() => setSectionProjectId(null)} variant="ghost">
                取消
              </Button>
              <Button type="submit" disabled={!sectionName.trim()}>
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
