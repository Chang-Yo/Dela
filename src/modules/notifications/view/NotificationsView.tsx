import type { ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, BellOff, Check, CheckCheck, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { Navigate, NoticeKind } from '../../../app/module';
import { errorMessage } from '../../../core/protocol/contract';
import { Alert } from '../../../ui/alert';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/lib/cn';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { EmptyState } from '../../../ui/empty-state';
import { Badge } from '../../../ui/badge';
import type { NotificationItem } from '../contract';
import { groupNotifications, likeGroupSummary } from './group-notifications';
import { useNotificationSourceFilter } from './source-filter';
import {
  notificationsClient,
  notifyFailure,
  openNotification,
  useNotificationState,
} from './use-notifications';

type Kinds = Record<string, NoticeKind>;

function formatTime(value: string, now: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.round((date.getTime() - now) / 60_000);
  if (minutes > -1) return '刚刚';
  if (minutes > -60) return `${Math.abs(minutes)} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours > -24) return `${Math.abs(hours)} 小时前`;
  const days = Math.round(hours / 24);
  if (days > -7) return `${Math.abs(days)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date);
}

function snoozeUntil(kind: '30m' | '1h' | 'tomorrow'): string {
  const until = new Date();
  if (kind === '30m') until.setMinutes(until.getMinutes() + 30);
  else if (kind === '1h') until.setHours(until.getHours() + 1);
  else {
    until.setDate(until.getDate() + 1);
    until.setHours(9, 0, 0, 0);
  }
  return until.toISOString();
}

function SourceIcon({ kind }: { kind: NoticeKind | undefined }) {
  const Icon = kind?.icon ?? Bell;
  return <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-3" />;
}

function NotificationRow({
  item,
  kinds,
  now,
  unread,
  summary,
  badge,
  markLabel,
  loading,
  onOpen,
  onMarkRead,
}: {
  item: NotificationItem;
  kinds: Kinds;
  now: number;
  unread: boolean;
  summary: string;
  badge: ReactNode;
  markLabel: string;
  loading: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  return (
    <article className="relative rounded-card transition-colors duration-base hover:bg-hover">
      <button
        className={cn(
          'flex w-full items-start gap-3 rounded-card px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          unread && 'pr-14',
        )}
        onClick={onOpen}
        type="button"
      >
        <SourceIcon kind={kinds[item.source]} />
        <span className="min-w-0 flex-1">
          <span
            className={cn('block break-words text-sm', unread ? 'font-semibold' : 'font-normal')}
          >
            {item.title}
          </span>
          <span className="mt-1 block break-words text-sm leading-relaxed text-ink-3 line-clamp-3">
            {summary}
          </span>
          <span className="mt-2 block text-xs tabular-nums text-ink-3">
            {kinds[item.source]?.label ?? item.source} · {formatTime(item.createdAt, now)}
          </span>
        </span>
        {unread ? badge : null}
      </button>
      {unread ? (
        <Button
          aria-label={markLabel}
          className="absolute top-2.5 right-2.5"
          disabled={loading}
          onClick={onMarkRead}
          size="icon-sm"
          title="标为已读"
          variant="ghost"
        >
          <Check className="size-4" />
        </Button>
      ) : null}
    </article>
  );
}

export function notificationsPage(kinds: Kinds) {
  return function NotificationsPage({ navigate }: { navigate: Navigate }) {
    return <NotificationsView kinds={kinds} navigate={navigate} />;
  };
}

function NotificationsView({ navigate, kinds }: { navigate: Navigate; kinds: Kinds }) {
  const all = Object.keys(kinds);
  const hidden = useNotificationSourceFilter((store) => store.hidden);
  const toggleSource = useNotificationSourceFilter((store) => store.toggleSource);
  const sources = all.filter((source) => !hidden.includes(source));
  const filtered = sources.length < all.length;
  const allState = useNotificationState();
  // 筛选在主进程完成，否则最近 200 条可能都被其他来源占满。
  const filteredState = useQuery({
    queryKey: ['notifications', 'state', sources],
    queryFn: () => notificationsClient.state(sources),
    enabled: filtered,
  });
  const query = filtered ? filteredState : allState;
  const state = query.data;
  const now = allState.dataUpdatedAt;
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onError: notifyFailure,
  });
  const loading = action.isPending;
  const refresh = () => action.mutate(() => notificationsClient.refresh());
  const markRead = (id: string) => action.mutate(() => notificationsClient.markRead(id));
  const snooze = (until: string | null) =>
    action.mutate(() => notificationsClient.setSnooze(until));
  const items = state?.items.filter((item) => sources.includes(item.source)) ?? [];
  const label = (source: string) => kinds[source]?.label ?? source;
  const sourceErrors = state
    ? Object.entries(state.refresh).flatMap(([source, value]) =>
        value.error ? [`${label(source)}：${value.error}`] : [],
      )
    : [];

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-6 py-6 [scrollbar-width:none] max-md:px-4">
      <header className="flex items-center justify-between gap-3 border-b pb-4 max-md:items-start max-md:flex-col">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-tight">通知</h1>
          {state?.unreadCount ? (
            <span className="text-sm tabular-nums text-ink-3">{state.unreadCount} 未读</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            aria-label="刷新通知"
            disabled={loading}
            onClick={refresh}
            size="icon-sm"
            title="刷新通知"
            variant="ghost"
          >
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
          <Button
            aria-label="全部标为已读"
            disabled={loading || !state?.unreadCount}
            onClick={() =>
              action.mutate(() => notificationsClient.markAllRead(filtered ? sources : undefined))
            }
            size="sm"
            title="全部标为已读"
            variant="ghost"
          >
            <CheckCheck className="size-4" />
            全部已读
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="筛选消息来源" size="icon-sm" title="筛选消息来源" variant="ghost">
                <SlidersHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>消息来源</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {all.map((source) => (
                <DropdownMenuCheckboxItem
                  checked={!hidden.includes(source)}
                  key={source}
                  onCheckedChange={() => toggleSource(source, all)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {label(source)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="暂停通知"
                disabled={loading}
                size="icon-sm"
                title="暂停通知"
                variant="ghost"
              >
                <BellOff className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>暂停通知</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => snooze(snoozeUntil('30m'))}>
                30 分钟
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => snooze(snoozeUntil('1h'))}>1 小时</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => snooze(snoozeUntil('tomorrow'))}>
                明天早上 9 点
              </DropdownMenuItem>
              {state?.snoozedUntil ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => snooze(null)}>恢复通知</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {state?.snoozedUntil ? (
        <div className="mt-4 flex items-start gap-2 rounded-card border border-line bg-inset px-4 py-3 text-sm text-ink-3">
          <BellOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>已暂停至 {new Date(state.snoozedUntil).toLocaleString('zh-CN')}；仍会收集新通知。</p>
        </div>
      ) : null}

      {query.error ? (
        <Alert
          action={
            <Button
              className="mt-2"
              onClick={() => void query.refetch()}
              size="sm"
              variant="outline"
            >
              重试
            </Button>
          }
          className="mt-4"
          role="alert"
        >
          {errorMessage(query.error)}
        </Alert>
      ) : null}
      {sourceErrors.map((message) => (
        <Alert className="mt-3" key={message} role="status">
          {message}
        </Alert>
      ))}

      {query.isPending && !query.error ? (
        <p className="py-12 text-center text-sm text-ink-3">正在获取通知…</p>
      ) : null}
      {state && items.length === 0 ? (
        <EmptyState
          className="py-12"
          title={filtered ? `没有${sources.map(label).join('、')}通知。` : '暂时没有通知。'}
        />
      ) : null}

      <section aria-label="通知列表" className="mt-4 flex flex-col gap-1 pb-6">
        {state && state.totalCount > state.items.length && (
          <p className="text-xs text-ink-3">
            显示最近 {state.items.length} 条，共 {state.totalCount} 条通知。
          </p>
        )}
        {groupNotifications(items).map((entry) => {
          if (entry.kind === 'group') {
            const latest = entry.items[0]!;
            const unreadCount = entry.items.filter((item) => !item.readAt).length;
            return (
              <NotificationRow
                badge={
                  <Badge className="mt-1 shrink-0 tabular-nums" dot={false} size="2xs">
                    {unreadCount} 未读
                  </Badge>
                }
                item={latest}
                key={entry.key}
                kinds={kinds}
                loading={loading}
                markLabel={`将“${latest.title}”的 ${unreadCount} 条点赞标为已读`}
                now={now}
                onMarkRead={() => markRead(latest.id)}
                onOpen={() => openNotification(latest, navigate)}
                summary={likeGroupSummary(entry.items)}
                unread={unreadCount > 0}
              />
            );
          }
          const item = entry.item;
          return (
            <NotificationRow
              badge={
                <span
                  aria-label="未读"
                  className="mt-1 size-2 shrink-0 rounded-full bg-ink"
                  role="status"
                />
              }
              item={item}
              key={item.id}
              kinds={kinds}
              loading={loading}
              markLabel={`将“${item.title}”标为已读`}
              now={now}
              onMarkRead={() => markRead(item.id)}
              onOpen={() => openNotification(item, navigate)}
              summary={item.body}
              unread={!item.readAt}
            />
          );
        })}
      </section>
    </div>
  );
}
