import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { Archive, MessageSquare, Search, X } from 'lucide-react';
import type { ChatSessionSummary } from '../../../core/protocol/agent';
import { Button } from '../../../ui/button';
import { IconButton } from '../../../ui/icon-button';
import { cn } from '../../../ui/cn';
import { poolKey, querySessions } from './sessions';
import { drawerFromRight } from '../../../ui/motion';
import { errorMessage } from '../../../core/protocol/contract';

function SessionList({
  sessions,
  currentSessionId,
  onOpenSession,
  onDeleteSession,
  onClose,
}: {
  sessions: ChatSessionSummary[];
  currentSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onClose: () => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  useEffect(() => {
    if (confirmingId === null) return;
    const cancel = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-archive-confirm]')))
        setConfirmingId(null);
    };
    document.addEventListener('pointerdown', cancel);
    return () => document.removeEventListener('pointerdown', cancel);
  }, [confirmingId]);
  return (
    <>
      {sessions.map((session) => (
        <div
          className="group flex items-center gap-2 rounded-chip px-2 py-1.5 transition-colors hover:bg-hover"
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
                session.id === currentSessionId ? 'text-ink' : 'text-ink-3',
              )}
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm text-ink',
                session.id === currentSessionId && 'font-medium',
              )}
            >
              {session.title || '新对话'}
            </span>
          </button>
          {confirmingId === session.id ? (
            <Button
              data-archive-confirm=""
              onClick={() => {
                setConfirmingId(null);
                onDeleteSession(session.id);
              }}
              size="sm"
              variant="destructive"
            >
              确认归档
            </Button>
          ) : (
            <IconButton
              aria-label={`归档对话 ${session.title}`}
              className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
              onClick={() => setConfirmingId(session.id)}
              title="归档对话"
            >
              <Archive />
            </IconButton>
          )}
        </div>
      ))}
    </>
  );
}

/** 历史对话面板：项目会话在前、通用对话在后（通用池只列自己），锚定内容区从右缘滑出。 */
export function ChatSessions({
  projectId,
  currentSessionId,
  open,
  onOpenChange,
  onOpenSession,
  onDeleteSession,
}: {
  /** 当前会话所属项目；非 null 时面板同时列出项目会话与通用对话入口。 */
  projectId: string | null;
  currentSessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [searchTerm] = useDebounce(query.trim(), 200);
  const pools = projectId === null ? [null] : [projectId, null];
  const sessionLists = useQuery({
    queryKey: ['chat', 'session-search', projectId, searchTerm],
    queryFn: () =>
      Promise.all(pools.map((pool) => querySessions(pool, searchTerm))).catch((cause) => {
        console.error(errorMessage(cause));
        throw cause;
      }),
    enabled: open,
    // 新结果到达前保留旧列表，面板打开与查询期间不闪空态文案。
    placeholderData: keepPreviousData,
  });
  // 查询失败不静默呈现为空态：给一行错误与重试；新查询成功即复位。
  const loadError = sessionLists.isError;
  const lists = loadError ? undefined : sessionLists.data;

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
    queryClient.setQueriesData<ChatSessionSummary[][]>(
      { queryKey: ['chat', 'session-search'] },
      (current) => current?.map((list) => list.filter((item) => item.id !== sessionId)),
    );
    void queryClient.invalidateQueries({ queryKey: ['chat', 'session-search'] });
    void queryClient.invalidateQueries({ queryKey: ['chat', 'archived'] });
  };

  if (!open) return null;
  // 面板锚定内容区（app-main）而非视口：侧栏展开时不遮挡导航，滚动状态也与之无关；
  // 找不到锚点时退回 body（整窗覆盖）。
  const container = document.getElementById('app-main') ?? document.body;

  const sections = pools.map((pool, index) => ({
    pool,
    key: poolKey(pool),
    label: pool === null && projectId !== null ? '通用对话' : null,
    list: lists?.[index] ?? null,
  }));
  const allLoaded = sections.every((section) => section.list !== null);
  const totalCount = sections.reduce((count, section) => count + (section.list?.length ?? 0), 0);

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 z-scrim"
        onMouseDown={() => onOpenChange(false)}
      />
      <aside
        aria-label="历史对话"
        className={cn(
          drawerFromRight,
          'absolute inset-y-0 right-0 z-overlay flex w-72 max-w-[85vw] flex-col border-l border-line bg-surface shadow-raised',
        )}
        role="dialog"
      >
        <h2 className="sr-only">历史对话</h2>
        <p className="sr-only">搜索并打开当前项目的会话，或进入通用对话</p>
        <div className="flex shrink-0 items-center gap-1 p-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              aria-label="搜索历史对话"
              autoFocus
              className="h-8 w-full rounded-control bg-field pl-8 pr-2 text-sm text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:shadow-btn"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索对话内容…"
              value={query}
            />
          </div>
          <IconButton aria-label="关闭" onClick={() => onOpenChange(false)}>
            <X strokeWidth={1.8} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-2">
          {loadError && (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-ink-3">
              <span role="alert">历史对话加载失败</span>
              <Button onClick={() => void sessionLists.refetch()} size="sm" variant="outline">
                重试
              </Button>
            </div>
          )}
          {allLoaded && totalCount === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-3">
              {query ? '没有匹配的对话' : '还没有历史对话'}
            </p>
          )}
          {sections.map((section) =>
            section.list && section.list.length > 0 ? (
              <section key={section.key} aria-label={section.label ?? '项目会话'}>
                {section.label && (
                  <h3 className="px-2 pb-1 pt-2 text-xs font-medium text-ink-3">{section.label}</h3>
                )}
                <SessionList
                  currentSessionId={currentSessionId}
                  onClose={() => onOpenChange(false)}
                  onDeleteSession={deleteSession}
                  onOpenSession={onOpenSession}
                  sessions={section.list}
                />
              </section>
            ) : null,
          )}
        </div>
      </aside>
    </>,
    container,
  );
}
