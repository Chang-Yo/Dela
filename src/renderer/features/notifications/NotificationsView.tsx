import { useEffect, useState } from 'react';
import {
  CircleCheckBig,
  BellOff,
  Check,
  CheckCheck,
  Mail,
  Megaphone,
  Plus,
  RefreshCw,
  Rss,
  SlidersHorizontal,
  GraduationCap,
} from 'lucide-react';
import { notificationSources } from '../../../shared/api';
import type {
  NoticePreview,
  NotificationItem,
  NotificationSource,
  NotificationState,
  NotificationSubscriptions,
} from '../../../shared/api';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { ShuiyuanIcon } from '../../components/ui/shuiyuan-icon';
import { useExperimental, useExperimentEnabled } from '../settings/experimental';
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
  notice: '公告订阅',
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

function formatItemTime(item: NotificationItem): string {
  if (item.href.kind === 'notice') {
    if (item.href.publishedAt === null) return '日期未知';
    if (/^\d{4}-\d{2}-\d{2}$/.test(item.href.publishedAt)) return item.href.publishedAt;
    return formatTime(item.href.publishedAt);
  }
  return formatTime(item.createdAt);
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
            : source === 'notice'
              ? Rss
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

function SubscriptionsPanel({
  noticeEnabled,
  notificationState,
  onViewNotices,
}: {
  noticeEnabled: boolean;
  notificationState: NotificationState | null;
  onViewNotices: () => void;
}) {
  const [subscriptions, setSubscriptions] = useState<NotificationSubscriptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<NoticePreview | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [expandedCandidates, setExpandedCandidates] = useState<number[]>([]);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const loadSubscriptions = async () => {
    if (!window.dela?.notifications) return;
    try {
      setSubscriptions(await window.dela.notifications.getSubscriptions());
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    void loadSubscriptions();
  }, [noticeEnabled, notificationState]);

  const toggleJwc = async (next: boolean) => {
    if (!window.dela?.notifications || busy) return;
    setBusy(true);
    setPanelError(null);
    try {
      await window.dela.notifications.setJwcSubscribed(next);
      await loadSubscriptions();
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const keywords = keyword.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const candidates = (preview?.candidates ?? [])
    .map((candidate, index) => ({
      candidate,
      index,
      entries: candidate.entries.filter((entry) =>
        keywords.every((word) =>
          `${candidate.label} ${entry.title}`.toLocaleLowerCase().includes(word),
        ),
      ),
    }))
    .filter(({ entries }) => entries.length > 0);
  const selectedIndex = candidates.some(({ index }) => index === selectedCandidate)
    ? selectedCandidate
    : candidates[0]?.index;
  const sectionLinks = (preview?.sectionLinks ?? []).filter((link) =>
    keywords.every((word) => link.title.toLocaleLowerCase().includes(word)),
  );

  const handlePreview = async (targetUrl = url, render = false) => {
    if (!window.dela?.notifications || !targetUrl.trim() || busy) return;
    setBusy(true);
    setPanelError(null);
    setPreview(null);
    setSuccessMessage(null);
    try {
      const result = await window.dela.notifications.previewNoticeSubscription(
        targetUrl.trim(),
        undefined,
        render,
      );
      setPreview(result);
      setSelectedCandidate(0);
      setExpandedCandidates([]);
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!window.dela?.notifications || !preview || selectedIndex === undefined || busy) return;
    setBusy(true);
    setPanelError(null);
    try {
      await window.dela.notifications.addNoticeSubscription(preview.token, selectedIndex);
      const candidate = preview.candidates[selectedIndex]!;
      const label = candidate.label.replace(/\s*查看更多\s*$/, '');
      setSuccessMessage(`已订阅「${label}」；${candidate.entries.length} 条公告已加入通知列表。`);
      setPreview(null);
      setUrl('');
      setKeyword('');
      await loadSubscriptions();
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.dela?.notifications || busy) return;
    setBusy(true);
    setPanelError(null);
    try {
      await window.dela.notifications.removeNoticeSubscription(id);
      setSuccessMessage(null);
      setConfirmingRemoveId(null);
      await loadSubscriptions();
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="订阅管理"
      className="mt-4 flex flex-col gap-3 rounded-card bg-inset px-4 py-3"
    >
      {noticeEnabled ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-13 font-medium text-ink">已订阅</h2>
            <p className="mt-1 text-xs text-ink-3">
              自动检查更新，新公告显示为未读，已有公告标为已读。
            </p>
          </div>
          {subscriptions?.notices.length || successMessage ? (
            <Button onClick={onViewNotices} size="sm" variant="outline">
              查看订阅公告
            </Button>
          ) : null}
        </div>
      ) : null}
      {successMessage ? (
        <p className="text-13 text-ink-2" role="status">
          {successMessage}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-13 font-medium text-ink">教务处</div>
          <div className="truncate text-xs text-ink-3">
            https://jwc.sjtu.edu.cn/index/mxxsdtz.htm
          </div>
        </div>
        <Switch
          checked={subscriptions?.jwc ?? true}
          disabled={subscriptions === null || busy}
          label="订阅教务处通知"
          onChange={(next) => void toggleJwc(next)}
        />
      </div>

      {noticeEnabled ? (
        <>
          {subscriptions && subscriptions.notices.length > 0 ? (
            <div className="flex flex-col gap-2 pt-1">
              {subscriptions.notices.map((item) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface px-3 py-2"
                  key={item.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-13 font-medium text-ink">{item.label}</div>
                    <div className="truncate text-xs text-ink-3">
                      {item.pageUrl}
                      {item.acquisition === 'rendered' ? ' · 页面渲染' : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
                      <span>
                        已收集 {item.entryCount} 条 · {item.unreadCount} 条未读
                      </span>
                      <span>
                        {item.error ? '更新失败' : '自动更新中'}
                        {item.lastSuccessAt ? ` · 最近检查 ${formatTime(item.lastSuccessAt)}` : ''}
                      </span>
                    </div>
                    {item.error ? <div className="mt-1 text-xs text-red">{item.error}</div> : null}
                  </div>
                  {confirmingRemoveId === item.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        disabled={busy}
                        onClick={() => void handleRemove(item.id)}
                        size="sm"
                        variant="destructive"
                      >
                        确认移除
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => setConfirmingRemoveId(null)}
                        size="sm"
                        variant="ghost"
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() => setConfirmingRemoveId(item.id)}
                      size="sm"
                      variant="ghost"
                    >
                      移除
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 pt-1">
            <h3 className="text-13 font-medium text-ink">添加订阅</h3>
            <div className="flex gap-2 max-md:flex-col">
              <Input
                aria-label="公告列表页网址"
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setPreview(null);
                }}
                placeholder="官网或公告列表页网址"
                value={url}
              />
              <Input
                aria-label="查找栏目或公告"
                className="md:max-w-64"
                disabled={busy}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="关键词：栏目或公告标题"
                value={keyword}
              />
              <Button
                className="shrink-0"
                disabled={busy || !url.trim()}
                onClick={() => void handlePreview()}
                size="sm"
                variant="outline"
              >
                <Plus className="size-4" />
                预览栏目
              </Button>
            </div>

            {preview ? (
              <div className="flex flex-col gap-2 rounded-control bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-13 font-medium text-ink-2">
                    {preview.title || '页面预览'}
                  </span>
                  {preview.acquisition === 'http' ? (
                    <Button
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => void handlePreview(preview.pageUrl, true)}
                      size="sm"
                      variant="ghost"
                    >
                      使用页面渲染重试
                    </Button>
                  ) : null}
                </div>
                {preview.feeds.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <span>发现 Feed：</span>
                    {preview.feeds.map((feed) => (
                      <Button
                        disabled={busy}
                        key={feed.url}
                        onClick={() => {
                          setUrl(feed.url);
                          void handlePreview(feed.url, false);
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {feed.title || feed.url}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {preview.candidates.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-13 text-ink-3">
                      {preview.sectionLinks?.length
                        ? '当前页面未识别出公告列表，请选择栏目继续。'
                        : '未识别到可订阅的公告列表。请尝试公告列表页网址。'}
                    </p>
                    {sectionLinks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {sectionLinks.map((link) => (
                          <Button
                            disabled={busy}
                            key={link.url}
                            onClick={() => {
                              setUrl(link.url);
                              setKeyword('');
                              void handlePreview(link.url);
                            }}
                            size="sm"
                            title={link.url}
                            variant="outline"
                          >
                            {link.title}
                          </Button>
                        ))}
                      </div>
                    ) : preview.sectionLinks?.length ? (
                      <p className="text-xs text-ink-3">没有匹配的栏目或公告，请更换关键词。</p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      {candidates.length === 0 ? (
                        <p className="px-3 py-2 text-13 text-ink-3">
                          没有匹配的栏目或公告，请更换关键词。
                        </p>
                      ) : null}
                      {candidates.map(({ candidate, index, entries }) => {
                        const expanded = expandedCandidates.includes(index);
                        const label = candidate.label.replace(/\s*查看更多\s*$/, '');
                        return (
                          <div
                            className={cn(
                              'rounded-control transition-colors duration-150',
                              selectedIndex === index ? 'bg-inset' : 'hover:bg-hover',
                            )}
                            key={`${candidate.label}-${index}`}
                          >
                            <button
                              aria-label={`选择栏目：${label}`}
                              aria-pressed={selectedIndex === index}
                              className="flex w-full flex-col gap-1 rounded-control px-3 py-2 text-left"
                              onClick={() => setSelectedCandidate(index)}
                              type="button"
                            >
                              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-2 text-13 font-medium text-ink">
                                  <Check
                                    aria-hidden="true"
                                    className={cn(
                                      'size-4 shrink-0',
                                      selectedIndex !== index && 'invisible',
                                    )}
                                  />
                                  {label}
                                </span>
                                <span
                                  className="text-xs tabular-nums text-ink-3"
                                  title={candidate.reasons.join('、')}
                                >
                                  {keywords.length > 0
                                    ? `匹配 ${entries.length} / 共 ${candidate.entries.length} 条`
                                    : `${candidate.entries.length} 条`}
                                </span>
                              </div>
                              {(expanded ? entries : entries.slice(0, 3)).map((entry) => (
                                <div
                                  className="flex w-full items-baseline justify-between gap-2 text-xs text-ink-3"
                                  key={entry.url}
                                >
                                  <span className="min-w-0 truncate" title={entry.title}>
                                    {entry.title}
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                    {entry.publishedAt ?? '日期未知'}
                                  </span>
                                </div>
                              ))}
                            </button>
                            {entries.length > 3 ? (
                              <div className="flex justify-end px-3 pb-2">
                                <Button
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? '收起' : '查看更多'}：${label}`}
                                  onClick={() =>
                                    setExpandedCandidates((current) =>
                                      current.includes(index)
                                        ? current.filter((value) => value !== index)
                                        : [...current, index],
                                    )
                                  }
                                  size="sm"
                                  variant="ghost"
                                >
                                  {expanded ? '收起' : '查看更多'}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        disabled={busy}
                        onClick={() => setPreview(null)}
                        size="sm"
                        variant="ghost"
                      >
                        取消
                      </Button>
                      <Button
                        disabled={busy || selectedIndex === undefined}
                        onClick={() => void handleConfirm()}
                        size="sm"
                      >
                        订阅所选栏目
                      </Button>
                    </div>
                  </>
                )}
                {preview.diagnostics.length > 0 ? (
                  <details className="text-xs text-ink-3">
                    <summary className="cursor-pointer">识别详情</summary>
                    <p className="mt-2 break-words">{preview.diagnostics.join('；')}</p>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {panelError ? (
        <p className="text-xs text-red" role="alert">
          {panelError}
        </p>
      ) : null}
    </section>
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
  const noticeEnabled = useExperimentEnabled('noticeSubscriptions');
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  useEffect(() => {
    void useExperimental.getState().load();
  }, []);
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
          <Button
            aria-expanded={subscriptionsOpen}
            onClick={() => setSubscriptionsOpen((value) => !value)}
            size="sm"
            variant="ghost"
          >
            <Rss className="size-4" />
            订阅管理
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

      {subscriptionsOpen ? (
        <SubscriptionsPanel
          noticeEnabled={noticeEnabled}
          notificationState={allState}
          onViewNotices={() => {
            useNotificationSourceFilter.setState({ sources: ['notice'] });
            setSubscriptionsOpen(false);
          }}
        />
      ) : null}

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
                    {filterLabels[item.source]} · {formatItemTime(item)}
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
