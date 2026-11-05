import { useEffect, useState } from 'react';
import {
  CircleCheckBig,
  BellOff,
  Check,
  CheckCheck,
  Mail,
  Megaphone,
  RefreshCw,
  SlidersHorizontal,
  GraduationCap,
} from 'lucide-react';
import { notificationSources } from '../../../shared/api';
import type { NotificationItem, NotificationSource, NotificationState } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { ShuiyuanIcon } from '../../components/ui/shuiyuan-icon';
import { JwcNoticeView } from './JwcNoticeView';
import { groupNotifications, likeGroupSummary } from './group-notifications';
import { useNotificationSourceFilter } from './source-filter';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

type NotificationsViewProps = {
  jwcNotice: NotificationItem | null;
  onCloseJwcNotice: () => void;
  state: NotificationState | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: (sources: readonly NotificationSource[]) => void;
  onSnooze: (until: string | null) => void;
  onOpen: (item: NotificationItem) => void;
};

const filterLabels: Record<NotificationSource, string> = {
  mail: '邮件',
  shuiyuan: '水源',
  todo: 'TODO',
  jwc: '教务处',
  canvas: 'Canvas',
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
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

function SourceIcon({ source }: { source: NotificationItem['source'] }) {
  const Icon =
    source === 'mail'
      ? Mail
      : source === 'todo'
        ? CircleCheckBig
        : source === 'jwc'
          ? GraduationCap
          : source === 'canvas'
            ? Megaphone
            : ShuiyuanIcon;
  return <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-3" />;
}

function LikeGroupRow({
  items,
  loading,
  onMarkRead,
  onOpen,
}: {
  items: NotificationItem[];
  loading: boolean;
  onMarkRead: (id: string) => void;
  onOpen: (item: NotificationItem) => void;
}) {
  const latest = items[0]!;
  const unreadCount = items.filter((item) => !item.readAt).length;
  const unread = unreadCount > 0;
  return (
    <article className="relative rounded-card transition-colors duration-150 hover:bg-hover">
      <button
        className={cn(
          'flex w-full items-start gap-3 rounded-card px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bui-accent',
          unread && 'pr-14',
        )}
        onClick={() => onOpen(latest)}
        type="button"
      >
        <SourceIcon source="shuiyuan" />
        <span className="min-w-0 flex-1">
          <span
            className={
              unread
                ? 'block break-words text-13 font-semibold'
                : 'block break-words text-13 font-normal'
            }
          >
            {latest.title}
          </span>
          <span className="mt-1 block break-words text-13 leading-relaxed text-ink-3">
            {likeGroupSummary(items)}
          </span>
          <span className="mt-2 block text-xs tabular-nums text-ink-3">
            水源 · {formatTime(latest.createdAt)}
          </span>
        </span>
        {unread ? (
          <span className="mt-1 shrink-0 rounded-full bg-inset px-2 text-xs tabular-nums text-ink">
            {unreadCount} 未读
          </span>
        ) : null}
      </button>
      {unread ? (
        <Button
          aria-label={`将“${latest.title}”的 ${unreadCount} 条点赞标为已读`}
          className="absolute top-2.5 right-2.5"
          disabled={loading}
          onClick={() => onMarkRead(latest.id)}
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

export function NotificationsView({
  jwcNotice,
  onCloseJwcNotice,
  state: allState,
  loading,
  error,
  onRefresh,
  onMarkRead,
  onMarkAllRead,
  onSnooze,
  onOpen,
}: NotificationsViewProps) {
  const sources = useNotificationSourceFilter((store) => store.sources);
  const toggleSource = useNotificationSourceFilter((store) => store.toggleSource);
  const allSelected = sources.length === notificationSources.length;
  const [filteredState, setFilteredState] = useState<{
    sources: readonly NotificationSource[];
    state: NotificationState;
  } | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setFilterError(null);
    if (sources.length < notificationSources.length && window.dela) {
      void window.dela.notifications.getState(sources).then(
        (value) => {
          if (active) setFilteredState({ sources, state: value });
        },
        (reason) => {
          if (active) setFilterError(String(reason));
        },
      );
    }
    return () => {
      active = false;
    };
  }, [sources, allState]);
  const state = !allSelected && filteredState?.sources === sources ? filteredState.state : allState;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [state]);
  const items = state?.items.filter((item) => sources.includes(item.source)) ?? [];
  const entries = groupNotifications(items);
  const sourceErrors = state
    ? (Object.entries(state.refresh).flatMap(([source, value]) =>
        value?.error ? [`${filterLabels[source as NotificationSource]}：${value.error}`] : [],
      ) as string[])
    : [];
  const snoozed = state?.snoozedUntil && new Date(state.snoozedUntil).getTime() > now;
  // 初始抓取在途（有通知 API、尚无状态且无错误）时按加载态展示，避免闪现“暂不可用”。
  const initialLoading = !state && !error && Boolean(window.dela?.notifications);

  if (jwcNotice)
    return <JwcNoticeView key={jwcNotice.id} item={jwcNotice} onBack={onCloseJwcNotice} />;

  // 隐藏滑块但保留 overflow-y:scroll 的常驻槽位，条目增减不引起内容横向位移。
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-6 py-6 [scrollbar-width:none] max-md:px-4">
      <header className="flex items-center justify-between gap-3 border-b pb-4 max-md:items-start max-md:flex-col">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-tight">通知</h1>
          {state?.unreadCount ? (
            <span className="text-13 tabular-nums text-ink-3">{state.unreadCount} 未读</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            aria-label="刷新通知"
            disabled={loading}
            onClick={onRefresh}
            size="icon-sm"
            title="刷新通知"
            variant="ghost"
          >
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
          <Button
            aria-label="全部标为已读"
            disabled={loading || !state?.unreadCount}
            onClick={() => onMarkAllRead(sources)}
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
              {notificationSources.map((source) => (
                <DropdownMenuCheckboxItem
                  checked={sources.includes(source)}
                  key={source}
                  onCheckedChange={() => toggleSource(source)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {filterLabels[source]}
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
              <DropdownMenuItem onSelect={() => onSnooze(snoozeUntil('30m'))}>
                30 分钟
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSnooze(snoozeUntil('1h'))}>
                1 小时
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSnooze(snoozeUntil('tomorrow'))}>
                明天早上 9 点
              </DropdownMenuItem>
              {state?.snoozedUntil ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onSnooze(null)}>恢复通知</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {snoozed ? (
        <div className="mt-4 flex items-start gap-2 rounded-card border border-line bg-inset px-4 py-3 text-13 text-ink-3">
          <BellOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>已暂停至 {new Date(state!.snoozedUntil!).toLocaleString('zh-CN')}；仍会收集新通知。</p>
        </div>
      ) : null}

      {error || filterError ? (
        <div
          className="mt-4 rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-xs text-red"
          role="alert"
        >
          <p>{error || filterError}</p>
          <Button className="mt-2" onClick={onRefresh} size="sm" variant="outline">
            重试
          </Button>
        </div>
      ) : null}
      {sourceErrors.map((message) => (
        <p
          className="mt-3 rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-xs text-red"
          key={message}
          role="status"
        >
          {message}
        </p>
      ))}

      {(loading || initialLoading) && !state ? (
        <p className="py-12 text-center text-13 text-ink-3">正在获取通知…</p>
      ) : null}
      {!loading && !state && !error && !initialLoading ? (
        <div className="py-12 text-center text-13 text-ink-3">
          <p>通知服务暂不可用。</p>
          <Button className="mt-3" onClick={onRefresh} size="sm" variant="outline">
            重新连接
          </Button>
        </div>
      ) : null}
      {state && !loading && items.length === 0 ? (
        <p className="py-12 text-center text-13 text-ink-3">
          {allSelected
            ? '暂时没有通知。'
            : `没有${sources.map((source) => filterLabels[source]).join('、')}通知。`}
        </p>
      ) : null}

      <section aria-label="通知列表" className="mt-4 flex flex-col gap-1 pb-6">
        {state && state.totalCount > state.items.length && (
          <p className="text-xs text-ink-3">
            显示最近 {state.items.length} 条，共 {state.totalCount} 条通知。
          </p>
        )}
        {entries.map((entry) => {
          if (entry.kind === 'group')
            return (
              <LikeGroupRow
                items={entry.items}
                key={entry.key}
                loading={loading}
                onMarkRead={onMarkRead}
                onOpen={onOpen}
              />
            );
          const item = entry.item;
          return (
            <article
              className="relative rounded-card transition-colors duration-150 hover:bg-hover"
              key={item.id}
            >
              <button
                className={cn(
                  'flex w-full items-start gap-3 rounded-card px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bui-accent',
                  !item.readAt && 'pr-14',
                )}
                onClick={() => onOpen(item)}
                type="button"
              >
                <SourceIcon source={item.source} />
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      item.readAt
                        ? 'block break-words text-13 font-normal'
                        : 'block break-words text-13 font-semibold'
                    }
                  >
                    {item.title}
                  </span>
                  <span className="mt-1 block break-words text-13 leading-relaxed text-ink-3 line-clamp-3">
                    {item.body}
                  </span>
                  <span className="mt-2 block text-xs tabular-nums text-ink-3">
                    {filterLabels[item.source]} · {formatTime(item.createdAt)}
                  </span>
                </span>
                {!item.readAt ? (
                  <span
                    aria-label="未读"
                    className="mt-1 size-2 shrink-0 rounded-full bg-ink"
                    role="status"
                  />
                ) : null}
              </button>
              {!item.readAt ? (
                <Button
                  aria-label={`将“${item.title}”标为已读`}
                  className="absolute top-2.5 right-2.5"
                  disabled={loading}
                  onClick={() => onMarkRead(item.id)}
                  size="icon-sm"
                  title="标为已读"
                  variant="ghost"
                >
                  <Check className="size-4" />
                </Button>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
