// 会话行：标题/时间/运行徽标/删除（docs/refactor/structure.md §3.1 navigation/SessionRow）。
// 数据与运行状态全部经注入接口进入，不 import sessions/（3B 接线时连接镜像）。
import { Trash2 } from 'lucide-react';
import type { RunStatus } from '../../shared/api';
import { cn } from '../lib/utils';

/** 注入的会话摘要（近期优先排序由注入方保证）。 */
export interface NavSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** 运行/失败/完成等徽标；null 表示无进行中或需注意的状态。 */
export type SessionRunBadge = RunStatus | null;

const badgeVisual: Record<Exclude<SessionRunBadge, null>, { className: string; label: string }> = {
  pending: { className: 'bg-primary animate-pulse', label: '等待运行' },
  running: { className: 'bg-primary animate-pulse', label: '运行中' },
  waiting_input: { className: 'bg-amber-500', label: '等待输入' },
  completed: { className: 'bg-emerald-500', label: '已完成' },
  failed: { className: 'bg-destructive', label: '运行失败' },
  stopped: { className: 'bg-muted-foreground', label: '已停止' },
  interrupted: { className: 'bg-muted-foreground', label: '已中断' },
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

export function SessionRow({
  session,
  badge,
  active = false,
  onOpen,
  onDelete,
}: {
  session: NavSessionSummary;
  badge: SessionRunBadge;
  active?: boolean;
  onOpen: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}) {
  const visual = badge === null ? null : badgeVisual[badge];
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg py-1 pl-6 pr-1.5 transition-colors',
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
      )}
    >
      <button
        aria-current={active ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => onOpen(session.id)}
        title={session.title || '新对话'}
        type="button"
      >
        {visual && (
          <span
            aria-label={visual.label}
            className={cn('size-1.5 shrink-0 rounded-full', visual.className)}
            role="img"
            title={visual.label}
          />
        )}
        <span className={cn('min-w-0 flex-1 truncate text-xs', active && 'font-medium')}>
          {session.title || '新对话'}
        </span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {formatTime(session.updatedAt)}
        </span>
      </button>
      {onDelete && (
        <button
          aria-label={`删除会话 ${session.title || '新对话'}`}
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground',
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100',
          )}
          onClick={() => onDelete(session.id)}
          title="删除会话"
          type="button"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}
