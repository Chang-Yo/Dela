import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { HoverCard } from 'radix-ui';
import { Archive, Folder, Pin, PinOff } from 'lucide-react';
import type { RunStatus } from '../../shared/api';
import { cn } from '../lib/utils';
import { useSessionRunStatus } from '../sessions/runs';
import { updateSession } from '../sessions/store';
import { errorText } from '../workspace/store';

export interface NavSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
}
export type SessionRunBadge = RunStatus | null;
const badgeVisual: Record<RunStatus, { className: string; label: string }> = {
  pending: { className: 'bg-primary animate-pulse', label: '等待运行' },
  running: { className: 'bg-primary animate-pulse', label: '运行中' },
  waiting_input: { className: 'bg-warning', label: '等待输入' },
  completed: { className: 'bg-success', label: '已完成' },
  failed: { className: 'bg-destructive', label: '运行失败' },
  stopped: { className: 'bg-muted-foreground', label: '已停止' },
  interrupted: { className: 'bg-muted-foreground', label: '已中断' },
};
export function SessionRow({
  session,
  projectName,
  active = false,
  onOpen,
  onDelete,
}: {
  session: NavSessionSummary;
  projectName?: string;
  badge?: SessionRunBadge;
  active?: boolean;
  onOpen: (id: string) => void;
  /** 兼容装配接口名；此回调现在仅归档。 */
  onDelete?: (id: string) => void | Promise<void>;
}) {
  const badge = useSessionRunStatus(session.id);
  const visual = badge === null ? null : badgeVisual[badge];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const cancel = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-archive-confirm]')))
        setConfirming(false);
    };
    document.addEventListener('pointerdown', cancel);
    return () => document.removeEventListener('pointerdown', cancel);
  }, [confirming]);
  const change = async (archive: boolean) => {
    if (busy) return;
    if (archive && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      if (archive) await onDelete?.(session.id);
      else await updateSession(session.id, { pinned: !session.pinned });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={cn(
        'group relative flex min-w-0 items-center rounded-lg py-1 pl-6 pr-1.5 transition-colors',
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
      )}
    >
      <HoverCard.Root>
        <HoverCard.Trigger asChild>
          <button
            aria-current={active ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => onOpen(session.id)}
            type="button"
          >
            {visual && (
              <span
                role="img"
                aria-label={visual.label}
                className={cn('size-1.5 shrink-0 rounded-full', visual.className)}
              />
            )}
            <span className={cn('sidebar-title min-w-0 flex-1 text-xs', active && 'font-medium')}>
              {session.title || '新对话'}
            </span>
            {session.pinned && (
              <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="已置顶" />
            )}
          </button>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            side="right"
            align="start"
            className="z-50 grid max-w-80 gap-2 rounded-xl border bg-popover p-3 text-xs text-popover-foreground shadow-md"
          >
            <span className="break-words font-medium">{session.title || '新对话'}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <Folder className="size-3.5" />
              {projectName ?? '随聊'}
              {visual && ` · ${visual.label}`}
            </span>
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
      {confirming ? (
        <Button
          data-archive-confirm=""
          size="sm"
          variant="destructive"
          className="h-5 px-1.5 text-2xs"
          disabled={busy}
          onClick={() => void change(true)}
        >
          确认归档
        </Button>
      ) : (
        <div className="absolute right-1 flex items-center rounded-md bg-sidebar opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
          <button
            disabled={busy}
            aria-label={`${session.pinned ? '取消置顶' : '置顶'} ${session.title}`}
            title={session.pinned ? '取消置顶' : '置顶'}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            onClick={() => void change(false)}
            type="button"
          >
            {session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          {onDelete && (
            <button
              disabled={busy}
              aria-label={`归档 ${session.title}`}
              title="归档对话"
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              onClick={() => void change(true)}
              type="button"
            >
              <Archive className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {error && (
        <span role="alert" className="max-w-24 truncate text-2xs text-destructive" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
