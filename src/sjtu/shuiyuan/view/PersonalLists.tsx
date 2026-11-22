import { ArrowLeft, Bookmark, CheckCheck } from 'lucide-react';
import type * as React from 'react';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { EmptyState } from '../../../ui/empty-state';
import { cn } from '../../../ui/lib/cn';
import { FeedCard, FeedCardSkeleton, FeedColumn, FeedIcon } from './FeedCard';
import { ShuiyuanTitle } from './shuiyuan-emoji';
import { openTopic } from './store';
import {
  openPost,
  useBookmarks,
  useMarkNotificationsRead,
  useNotifications,
  useSelectList,
} from './use-shuiyuan';
import { describeNotification, formatListDate } from './shuiyuan-format';
import { Alert } from '../../../ui/alert';
import { InlineButton } from '../../../ui/inline-button';

export function ListHeader({ children }: { children?: React.ReactNode }) {
  const selectList = useSelectList();
  return (
    <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 px-4 pb-1 pt-3 max-md:px-3">
      <Button
        className="-ml-2 text-ink-3"
        onClick={() => selectList({ kind: 'latest' })}
        size="sm"
        variant="ghost"
      >
        <ArrowLeft strokeWidth={1.8} />
        返回最新
      </Button>
      {children}
    </div>
  );
}

export function BookmarkList() {
  const query = useBookmarks();
  const bookmarks = query.data ?? [];
  const loading = query.isFetching;
  const error = query.error ? errorMessage(query.error) : null;

  return (
    <>
      <ListHeader />
      <FeedColumn>
        {bookmarks.map((bookmark) => (
          <FeedCard
            key={bookmark.id}
            leading={<FeedIcon icon={Bookmark} />}
            onClick={() => openTopic(bookmark.topicId, bookmark.linkedPostNumber ?? undefined)}
          >
            <span className="line-clamp-2 text-base font-medium leading-snug text-ink">
              <ShuiyuanTitle text={bookmark.title} />
            </span>
            {bookmark.excerpt ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-ink-3">{bookmark.excerpt}</p>
            ) : null}
            <p className="text-xs tabular-nums text-ink-3">
              收藏于 {formatListDate(bookmark.createdAt)}
            </p>
          </FeedCard>
        ))}
        {loading && bookmarks.length === 0
          ? Array.from({ length: 5 }, (_, index) => <FeedCardSkeleton key={index} />)
          : null}
        {!loading && !error && bookmarks.length === 0 ? <EmptyState title="还没有收藏" /> : null}
        {error ? (
          <Alert
            action={<InlineButton onClick={() => void query.refetch()}>重试</InlineButton>}
            className="mt-3"
            role="alert"
          >
            {error}
          </Alert>
        ) : null}
      </FeedColumn>
    </>
  );
}

export function NotificationList() {
  const query = useNotifications();
  const notifications = query.data ?? [];
  const loading = query.isFetching;
  const error = query.error ? errorMessage(query.error) : null;
  const markRead = useMarkNotificationsRead();
  const hasUnread = notifications.some((item) => !item.read);

  return (
    <>
      <ListHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-xs text-ink-3">最近 30 天</span>
          {hasUnread ? (
            <Button disabled={loading} onClick={() => void markRead()} size="sm" variant="outline">
              <CheckCheck className="size-3.5" />
              全部标为已读
            </Button>
          ) : null}
        </div>
      </ListHeader>
      <FeedColumn>
        {notifications.map((item) => {
          const meta = describeNotification(item);
          return (
            <FeedCard
              key={item.id}
              leading={<FeedIcon icon={meta.icon} />}
              onClick={() => {
                if (item.topicId !== null) openTopic(item.topicId, item.postNumber ?? undefined);
                else if (item.originalPostId !== null) openPost(item.originalPostId);
              }}
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    'line-clamp-2 flex-1 text-base leading-snug',
                    item.read ? 'font-medium text-ink-2' : 'font-semibold text-ink',
                  )}
                >
                  {meta.text}
                </span>
                {!item.read ? (
                  <span aria-label="未读" className="mt-2 size-2 shrink-0 rounded-full bg-accent" />
                ) : null}
              </div>
              <p className="text-xs tabular-nums text-ink-3">{formatListDate(item.createdAt)}</p>
            </FeedCard>
          );
        })}
        {loading && notifications.length === 0
          ? Array.from({ length: 5 }, (_, index) => <FeedCardSkeleton key={index} />)
          : null}
        {!loading && !error && notifications.length === 0 ? <EmptyState title="暂无通知" /> : null}
        {error ? (
          <Alert
            action={<InlineButton onClick={() => void query.refetch()}>重试</InlineButton>}
            className="mt-3"
            role="alert"
          >
            {error}
          </Alert>
        ) : null}
      </FeedColumn>
    </>
  );
}
