import { useEffect, useState } from 'react';
import { MessageSquare, Search, Trash2 } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ChatSessionSummary } from '../../../shared/api';
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

/** 历史对话弹窗：按标题或消息原文搜索，可打开或删除会话。 */
export function ChatSessions({
  scope,
  currentSessionId,
  open,
  onOpenChange,
  onOpenSession,
  onDeleteSession,
  listSessions,
}: {
  scope: string;
  currentSessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  listSessions: (query: string) => Promise<ChatSessionSummary[]>;
}) {
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void listSessions(query.trim())
        .then(setSessions)
        .catch((e) => {
          setSessions([]);
          console.error(errorText(e));
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [listSessions, open, query]);

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150 max-md:w-[calc(100%-2rem)]">
          <Dialog.Title className="px-4 pt-4 text-base font-semibold">历史对话</Dialog.Title>
          <Dialog.Description className="sr-only">
            搜索并打开此作用域内的历史会话
          </Dialog.Description>
          <div className="relative px-4 pb-3 pt-3">
            <Search className="absolute left-7 top-1/2 size-4 -translate-y-[calc(50%-6px)] text-muted-foreground" />
            <Input
              aria-label="搜索历史对话"
              autoFocus
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索对话内容…"
              value={query}
            />
          </div>
          <div className="max-h-80 overflow-y-auto border-t p-2">
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
                    onOpenChange(false);
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
                    {session.messageCount} 条 · {formatTime(session.updatedAt)}
                  </span>
                </button>
                <button
                  aria-label={`删除对话 ${session.title}`}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={() => onDeleteSession(session.id)}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <p className="sr-only">{scope}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
