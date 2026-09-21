import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Search, Trash2, X } from 'lucide-react';
import type { ChatSessionSummary } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { errorText } from '../projects/workspace';

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

function SessionList({
  sessions,
  query,
  currentSessionId,
  onOpenSession,
  onDeleteSession,
  onClose,
}: {
  sessions: ChatSessionSummary[];
  query: string;
  currentSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onClose: () => void;
}) {
  // 删除二次确认：点垃圾桶先在原位变成「确认删除」，点它才真删；点到别处即还原。
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  useEffect(() => {
    if (confirmingId === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-delete-confirm]')))
        setConfirmingId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [confirmingId]);
  return (
    <>
      {sessions.length === 0 && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {query ? '没有匹配的对话' : '还没有历史对话'}
        </p>
      )}
      {sessions.map((session) => (
        <div
          className="group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-accent/60"
          key={session.id}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            onClick={() => {
              onOpenSession(session.id);
              onClose();
            }}
            type="button"
          >
            <MessageSquare
              className={cn(
                'size-4 shrink-0',
                session.id === currentSessionId ? 'text-foreground' : 'text-muted-foreground',
              )}
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                session.id === currentSessionId && 'font-medium',
              )}
            >
              {session.title || '新对话'}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatTime(session.updatedAt)}
            </span>
          </button>
          {confirmingId === session.id ? (
            <Button
              className="h-7 px-2 text-xs"
              data-delete-confirm=""
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirmingId(null);
                onDeleteSession(session.id);
              }}
            >
              确认删除
            </Button>
          ) : (
            <button
              aria-label={`删除对话 ${session.title}`}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => setConfirmingId(session.id)}
              type="button"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      ))}
    </>
  );
}

/** 历史对话：按标题或消息原文搜索，可打开或删除会话。
 *  悬浮面板锚定内容区（main），side 决定从左/右缘滑出。 */
export function ChatSessions({
  scope,
  currentSessionId,
  open,
  onOpenChange,
  onOpenSession,
  onDeleteSession,
  listSessions,
  side = 'left',
}: {
  scope: string;
  currentSessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  listSessions: (query: string) => Promise<ChatSessionSummary[]>;
  side?: 'left' | 'right';
}) {
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [listVersion, setListVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    // cleanup 只能清 timer，无法取消在途 IPC：active 标志丢弃过期响应（含删除后到达的旧列表）。
    let active = true;
    const timer = setTimeout(() => {
      void listSessions(query.trim())
        .then((result) => {
          if (active) setSessions(result);
        })
        .catch((e) => {
          if (active) {
            setSessions([]);
            console.error(errorText(e));
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [listSessions, listVersion, open, query]);

  // 悬浮面板自行响应 Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange, open]);

  const deleteSession = (sessionId: string) => {
    onDeleteSession(sessionId);
    // 面板保持打开时列表仍可见：先乐观移除，再重取列表覆盖在途旧请求，
    // 也让删除失败（IPC 报错）时该行按服务端事实恢复。
    setSessions((current) => current.filter((item) => item.id !== sessionId));
    setListVersion((version) => version + 1);
  };

  if (!open) return null;
  // 面板锚定内容区（main）而非视口：侧栏展开时不遮挡导航，滚动状态也与之无关。
  const container = document.getElementById('app-main');
  if (!container) return null;
  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 z-30 animate-in bg-black/30 duration-150 fade-in"
        onMouseDown={() => onOpenChange(false)}
      />
      <aside
        aria-label="历史对话"
        className={cn(
          'absolute inset-y-0 z-40 flex w-72 max-w-[85vw] animate-in flex-col bg-popover shadow-xl duration-150 fade-in',
          side === 'left'
            ? 'left-0 border-r slide-in-from-left-6'
            : 'right-0 border-l slide-in-from-right-6',
        )}
        role="dialog"
      >
        <h2 className="sr-only">历史对话</h2>
        <p className="sr-only">搜索并打开此作用域内的历史会话</p>
        <div className="flex shrink-0 items-center gap-1 p-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索历史对话"
              autoFocus
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索对话内容…"
              value={query}
            />
          </div>
          <button
            aria-label="关闭"
            className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t p-2">
          <SessionList
            currentSessionId={currentSessionId}
            onClose={() => onOpenChange(false)}
            onDeleteSession={deleteSession}
            onOpenSession={onOpenSession}
            query={query}
            sessions={sessions}
          />
        </div>
        <p className="sr-only">{scope}</p>
      </aside>
    </>,
    container,
  );
}
