import { useEffect, useState } from 'react';
import {
  CircleCheckBig,
  BellOff,
  Check,
  CheckCheck,
  Mail,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import type { NotificationFilter, NotificationItem, NotificationState } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { ShuiyuanIcon } from '../../components/ui/shuiyuan-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

type NotificationsViewProps = {
  state: NotificationState | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onSnooze: (until: string | null) => void;
  onOpen: (item: NotificationItem) => void;
};

const filterLabels: Record<NotificationFilter, string> = {
  all: '全部来源',
  mail: '邮件',
  shuiyuan: '水源',
  todo: 'TODO',
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
  const Icon = source === 'mail' ? Mail : source === 'todo' ? CircleCheckBig : ShuiyuanIcon;
  return <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-3" />;
}

export function NotificationsView({
  state,
  loading,
  error,
  onRefresh,
  onMarkRead,
  onMarkAllRead,
  onSnooze,
  onOpen,
}: NotificationsViewProps) {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [state]);
  const items = state?.items.filter((item) => filter === 'all' || item.source === filter) ?? [];
  const sourceErrors = state
    ? (Object.entries(state.refresh).flatMap(([source, value]) =>
        value?.error ? [`${filterLabels[source as NotificationFilter]}：${value.error}`] : [],
      ) as string[])
    : [];
  const snoozed = state?.snoozedUntil && new Date(state.snoozedUntil).getTime() > now;
  // 初始抓取在途（有通知 API、尚无状态且无错误）时按加载态展示，避免闪现“暂不可用”。
  const initialLoading = !state && !error && Boolean(window.dela?.notifications);

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
            onClick={onMarkAllRead}
            size="sm"
            title="全部标为已读"
            variant="ghost"
          >
            <CheckCheck className="size-4" />
            全部已读
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="筛选通知类型" size="icon-sm" title="筛选通知类型" variant="ghost">
                <SlidersHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>通知类型</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                onValueChange={(value) => setFilter(value as NotificationFilter)}
                value={filter}
              >
                {(Object.keys(filterLabels) as NotificationFilter[]).map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {filterLabels[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
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

      {error ? (
        <div
          className="mt-4 rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-xs text-red"
          role="alert"
        >
          <p>{error}</p>
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
          {filter === 'all' ? '暂时没有通知。' : `没有${filterLabels[filter]}通知。`}
        </p>
      ) : null}

      <section aria-label="通知列表" className="mt-4 flex flex-col gap-1 pb-6">
        {state && state.totalCount > state.items.length && (
          <p className="text-xs text-ink-3">
            显示最近 {state.items.length} 条，共 {state.totalCount} 条通知。
          </p>
        )}
        {items.map((item) => (
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
        ))}
      </section>
    </div>
  );
}
