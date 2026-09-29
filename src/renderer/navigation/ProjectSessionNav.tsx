// 项目会话导航（docs/agent-workspace-plan.md §4.1、structure.md §3.1）：按项目展开近期
// 会话（前 3 条 + 「显示更多」），顶部保留通用聊天入口，底部保留邮箱/课表/水源/TODO
// 业务入口位。项目列表来自 workspace/ 条目镜像；会话数据与运行徽标经注入接口进入，
// 本组件不 import sessions/（3B 接线时由 sessions/ 镜像提供，见下方 props 注释）。
import {
  CalendarDays,
  ChevronRight,
  CircleCheckBig,
  FolderKanban,
  Mail,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { ShuiyuanIcon } from '../components/ui/shuiyuan-icon';
import { useWorkspaceStore } from '../workspace/store';
import { SessionRow, type NavSessionSummary, type SessionRunBadge } from './SessionRow';
import { useNavigationStore } from './store';

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
  /** 顶部「通用聊天」入口（无项目会话池，§4.1 保留）。 */
  onOpenGeneralChat,
  generalChatActive = false,
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
  onOpenGeneralChat: () => void;
  generalChatActive?: boolean;
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
  const projects = entries.filter((entry) => entry.kind === 'project');
  const hidden = cn('truncate', labelFade, collapsed && 'opacity-0');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="会话导航" className="grid gap-0.5">
        <button
          aria-current={generalChatActive ? 'page' : undefined}
          className={rowClass(generalChatActive)}
          onClick={onOpenGeneralChat}
          type="button"
        >
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <span className={hidden}>通用聊天</span>
        </button>
      </nav>
      <section aria-labelledby="project-session-nav-title" className="mt-5">
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
        <div className="grid gap-0.5">
          {projects.map((project) => {
            const active = project.id === activeProjectId;
            const expanded = openProjects.includes(project.id);
            const sessions = sessionsByProject[project.id] ?? [];
            const full = fullSessionLists.includes(project.id);
            const visible = full ? sessions : sessions.slice(0, RECENT_SESSIONS);
            return (
              <div key={project.id}>
                <div className={cn(rowClass(active), 'group/nav pl-1')}>
                  <button
                    aria-expanded={expanded}
                    aria-label={`${expanded ? '收起' : '展开'} ${project.name} 的会话`}
                    className="grid size-4 shrink-0 place-items-center text-muted-foreground"
                    onClick={() => toggleProject(project.id)}
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
                    aria-current={active ? 'page' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onClick={() => onOpenProject(project.id)}
                    title={project.name}
                    type="button"
                  >
                    <FolderKanban
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.8}
                    />
                    <span className={hidden}>{project.name}</span>
                  </button>
                </div>
                {expanded && (
                  <div className="grid gap-0.5">
                    {visible.map((session) => (
                      <SessionRow
                        active={session.id === activeSessionId}
                        badge={runBadge(session.id)}
                        key={session.id}
                        onDelete={onDeleteSession}
                        onOpen={onOpenSession}
                        session={session}
                      />
                    ))}
                    {sessions.length > RECENT_SESSIONS && (
                      <button
                        className="ml-6 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                        onClick={() => toggleFullSessionList(project.id)}
                        type="button"
                      >
                        {full ? '收起' : `显示更多（${sessions.length - RECENT_SESSIONS}）`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <div className="mt-auto grid gap-0.5 pt-4">
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
      </div>
    </div>
  );
}
