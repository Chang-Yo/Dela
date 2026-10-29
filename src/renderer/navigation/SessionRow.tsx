import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { HoverCard } from 'radix-ui';
import { Archive, Cloud, Folder, Pin, PinOff } from 'lucide-react';
import type { RunStatus } from '../../shared/api';
import { cn } from '../lib/utils';
import { menuPanel } from '../components/ui/menu-styles';
import { useSessionRunStatus } from '../sessions/runs';
import { updateSession } from '../sessions/store';
import { errorText } from '../workspace/store';
import { showToast } from '../app/toasts';
import { navSubRow, rowActions, rowIconButton } from './nav-styles';

export interface NavSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
}
export type SessionRunBadge = RunStatus | null;
const badgeVisual: Record<RunStatus, { className: string; label: string }> = {
  pending: { className: 'bg-bui-accent animate-pulse', label: '等待运行' },
  running: { className: 'bg-bui-accent animate-pulse', label: '运行中' },
  waiting_input: { className: 'bg-orange', label: '等待输入' },
  completed: { className: 'bg-green', label: '已完成' },
  failed: { className: 'bg-red', label: '运行失败' },
  stopped: { className: 'bg-ink-3', label: '已停止' },
  interrupted: { className: 'bg-ink-3', label: '已中断' },
};
export function SessionRow({
  session,
  projectName,
  remoteId = null,
  active = false,
  onOpen,
  onDelete,
}: {
  session: NavSessionSummary;
  projectName?: string;
  /** 所属项目是远端时，悬停卡里的项目图标与侧栏一样用云朵。 */
  remoteId?: string | null;
  badge?: SessionRunBadge;
  active?: boolean;
  onOpen: (id: string) => void;
  /** 兼容装配接口名；此回调现在仅归档。 */
  onDelete?: (id: string) => void | Promise<void>;
}) {
  const ProjectIcon = remoteId ? Cloud : Folder;
  const title = session.title || '新对话';
  const badge = useSessionRunStatus(session.id);
  const visual = badge === null ? null : badgeVisual[badge];
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const cancel = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-archive-confirm]')))
        setConfirming(false);
    };
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirming(false);
    };
    document.addEventListener('pointerdown', cancel);
    document.addEventListener('keydown', cancelOnEscape);
    return () => {
      document.removeEventListener('pointerdown', cancel);
      document.removeEventListener('keydown', cancelOnEscape);
    };
  }, [confirming]);
  const change = async (archive: boolean) => {
    if (busy) return;
    if (archive && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    try {
      if (archive) await onDelete?.(session.id);
      else await updateSession(session.id, { pinned: !session.pinned });
    } catch (cause) {
      showToast({ variant: 'error', title: '会话操作失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={navSubRow(active)}>
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
            <span className={cn('sidebar-title min-w-0 flex-1 text-13', active && 'font-medium')}>
              {title}
            </span>
            {session.pinned && <Pin className="size-3 shrink-0 text-ink-3" aria-label="已置顶" />}
          </button>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            side="right"
            align="start"
            className={cn(menuPanel, 'grid max-w-80 gap-1.5 p-3 text-xs')}
            sideOffset={8}
          >
            <span className="break-words font-medium">{title}</span>
            <span className="flex items-center gap-1.5 text-ink-3">
              <ProjectIcon className="size-3.5" aria-hidden="true" />
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
          className="h-6 px-2 text-xs"
          disabled={busy}
          onBlur={() => setConfirming(false)}
          onClick={() => void change(true)}
        >
          确认归档
        </Button>
      ) : (
        <div className={cn(rowActions, active ? 'bg-hover-2' : 'bg-hover')}>
          <button
            disabled={busy}
            aria-label={`${session.pinned ? '取消置顶' : '置顶'} ${title}`}
            title={session.pinned ? '取消置顶' : '置顶'}
            className={rowIconButton}
            onClick={() => void change(false)}
            type="button"
          >
            {session.pinned ? <PinOff /> : <Pin />}
          </button>
          {onDelete && (
            <button
              disabled={busy}
              aria-label={`归档 ${title}`}
              title="归档对话"
              className={rowIconButton}
              onClick={() => void change(true)}
              type="button"
            >
              <Archive />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
