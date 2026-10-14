import { ArrowLeft, CheckCheck, Heart } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ShuiyuanTitle } from './shuiyuan-emoji';
import { useShuiyuan } from './store';
import { describeNotification, formatListDate } from './shuiyuan-format';

/** 个人列表（收藏/通知/私信）返回信息流首页，三处共用。 */
export function ListBackButton() {
  const selectList = useShuiyuan((state) => state.selectList);
  return (
    <button
      className="flex items-center gap-1 self-start text-xs text-ink-3 transition-colors hover:text-ink"
      onClick={() => void selectList({ kind: 'latest' })}
      type="button"
    >
      <ArrowLeft className="size-4" strokeWidth={1.8} />
      返回最新
    </button>
  );
}

/** 收藏列表：点击进入帖子阅读。 */
export function BookmarkList() {
  const bookmarks = useShuiyuan((state) => state.bookmarks);
  const loading = useShuiyuan((state) => state.listLoading);
  const error = useShuiyuan((state) => state.listError);
  const refreshList = useShuiyuan((state) => state.refreshList);
  const openTopic = useShuiyuan((state) => state.openTopic);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-8 max-md:px-3">
      <ListBackButton />
      {bookmarks.map((bookmark) => (
        <button
          className="flex w-full flex-col gap-1.5 border-b border-line px-1 py-3.5 text-left transition-colors last:border-0 hover:bg-hover"
          key={bookmark.id}
          onClick={() => void openTopic(bookmark.topicId, bookmark.linkedPostNumber ?? undefined)}
          type="button"
        >
          <div className="flex items-start gap-1.5">
            <Heart aria-hidden="true" className="mt-1 size-3.5 shrink-0 fill-current text-ink" />
            <span className="line-clamp-2 text-15 font-medium leading-snug">
              <ShuiyuanTitle text={bookmark.title} />
            </span>
          </div>
          {bookmark.excerpt ? (
            <p className="line-clamp-2 text-13 leading-relaxed text-ink-3">{bookmark.excerpt}</p>
          ) : null}
          <p className="pl-5 text-2xs tabular-nums text-ink-3">
            收藏于 {formatListDate(bookmark.createdAt)}
          </p>
        </button>
      ))}
      {loading ? <p className="p-4 text-xs text-ink-3">加载中…</p> : null}
      {!loading && !error && bookmarks.length === 0 ? (
        <p className="px-1 py-8 text-center text-13 text-ink-3">还没有收藏</p>
      ) : null}
      {error ? (
        <div
          className="mx-1 mt-3 rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-xs text-red"
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
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-8 max-md:px-3">
      <ListBackButton />
      <div className="flex min-h-9 items-center justify-between gap-2 py-1">
        <p className="text-xs text-ink-3">最近 30 天通知</p>
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
            className="flex w-full items-start gap-2.5 border-b border-line px-1 py-3.5 text-left transition-colors last:border-0 hover:bg-hover"
            key={item.id}
            onClick={() =>
              item.topicId !== null && void openTopic(item.topicId, item.postNumber ?? undefined)
            }
            type="button"
          >
            <Icon aria-hidden="true" className="mt-1 size-4 shrink-0 text-ink-3" />
            <span className="grid min-w-0 flex-1 gap-1">
              <span
                className={
                  item.read ? 'text-13 leading-snug text-ink-2' : 'text-13 font-medium leading-snug'
                }
              >
                {meta.text}
              </span>
              <span className="text-2xs tabular-nums text-ink-3">
                {formatListDate(item.createdAt)}
              </span>
            </span>
            {!item.read ? (
              <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-ink" />
            ) : null}
          </button>
        );
      })}
      {loading ? <p className="p-4 text-xs text-ink-3">加载中…</p> : null}
      {!loading && !error && notifications.length === 0 ? (
        <p className="px-1 py-8 text-center text-13 text-ink-3">暂无通知</p>
      ) : null}
      {error ? (
        <div
          className="mx-1 mt-3 rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-xs text-red"
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
