import { CheckCheck, Heart } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useShuiyuan } from './store';
import { describeNotification, formatListDate } from './shuiyuan-format';

/** 收藏列表：点击进入帖子阅读。 */
export function BookmarkList() {
  const bookmarks = useShuiyuan((state) => state.bookmarks);
  const loading = useShuiyuan((state) => state.listLoading);
  const error = useShuiyuan((state) => state.listError);
  const refreshList = useShuiyuan((state) => state.refreshList);
  const openTopic = useShuiyuan((state) => state.openTopic);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 max-md:px-3">
      {bookmarks.map((bookmark) => (
        <button
          className="flex w-full flex-col gap-1.5 border-b border-border/60 px-1 py-3 text-left transition-colors hover:bg-muted/40"
          key={bookmark.id}
          onClick={() => void openTopic(bookmark.topicId, bookmark.linkedPostNumber ?? undefined)}
          type="button"
        >
          <div className="flex items-start gap-1.5">
            <Heart
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 fill-current text-primary"
            />
            <span className="line-clamp-2 text-sm font-medium leading-snug">{bookmark.title}</span>
          </div>
          {bookmark.excerpt ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {bookmark.excerpt}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            收藏于 {formatListDate(bookmark.createdAt)}
          </p>
        </button>
      ))}
      {loading ? <p className="p-4 text-xs text-muted-foreground">加载中…</p> : null}
      {!loading && !error && bookmarks.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">还没有收藏</p>
      ) : null}
      {error ? (
        <div
          className="mx-1 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
          <button
            className="ml-2 underline underline-offset-2"
            onClick={() => void refreshList()}
            type="button"
          >
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 通知列表：语义化行 + 未读点；点击带楼层深链打开帖子。 */
export function NotificationList() {
  const notifications = useShuiyuan((state) => state.notifications);
  const loading = useShuiyuan((state) => state.listLoading);
  const error = useShuiyuan((state) => state.listError);
  const refreshList = useShuiyuan((state) => state.refreshList);
  const openTopic = useShuiyuan((state) => state.openTopic);
  const markRead = useShuiyuan((state) => state.markNotificationsRead);
  const hasUnread = notifications.some((item) => !item.read);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 max-md:px-3">
      <div className="flex min-h-9 items-center justify-between gap-2 py-1">
        <p className="text-xs text-muted-foreground">最近 30 天通知</p>
        {hasUnread ? (
          <Button disabled={loading} onClick={() => void markRead()} size="sm" variant="ghost">
            <CheckCheck className="size-3.5" />
            全部标为已读
          </Button>
        ) : null}
      </div>
      {notifications.map((item) => {
        const meta = describeNotification(item);
        const Icon = meta.icon;
        return (
          <button
            className="flex w-full items-start gap-2.5 border-b border-border/60 px-1 py-3 text-left transition-colors hover:bg-muted/40"
            key={item.id}
            onClick={() =>
              item.topicId !== null && void openTopic(item.topicId, item.postNumber ?? undefined)
            }
            type="button"
          >
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="grid min-w-0 flex-1 gap-1">
              <span
                className={
                  item.read
                    ? 'text-sm leading-snug text-foreground/75'
                    : 'text-sm font-medium leading-snug'
                }
              >
                {meta.text}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatListDate(item.createdAt)}
              </span>
            </span>
            {!item.read ? (
              <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
            ) : null}
          </button>
        );
      })}
      {loading ? <p className="p-4 text-xs text-muted-foreground">加载中…</p> : null}
      {!loading && !error && notifications.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">暂无通知</p>
      ) : null}
      {error ? (
        <div
          className="mx-1 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
          <button
            className="ml-2 underline underline-offset-2"
            onClick={() => void refreshList()}
            type="button"
          >
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}
