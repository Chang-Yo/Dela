import type { ShuiyuanNotificationItem } from '../../../shared/api';
import { loadShuiyuanCredential } from './credentials';
import { getDatabase } from '../../../main/database';
import type { NotificationCategory } from '../../../modules/notifications/contract';
import {
  existingNotifications,
  saveNotificationRefresh,
  systemNotifyItem,
  upsertNotification,
  type NoticeSource,
  type StoredNotice,
} from '../../../modules/notifications';
import { listShuiyuanNotifications } from './api';

function shuiyuanTitle(item: ShuiyuanNotificationItem): string {
  if (item.fancyTitle) return item.fancyTitle;
  return item.displayUsername ? `${item.displayUsername} 有新的互动` : '水源有新的动态';
}

function shuiyuanCategory(type: number): NotificationCategory {
  if (type === 5 || type === 19) return 'like';
  if (type === 2 || type === 3) return 'reply';
  if (type === 1 || type === 15) return 'mention';
  if (type === 6 || type === 7) return 'message';
  return 'other';
}

function unreadLikes(key: string): Map<string, number> {
  return new Map(
    (
      getDatabase()
        .prepare(
          `SELECT id, json_extract(href, '$.topicId') AS topicId FROM notifications
           WHERE source = 'shuiyuan' AND account_key = ? AND category = 'like' AND read_at IS NULL`,
        )
        .all(key) as { id: string; topicId: number }[]
    ).map((row) => [row.id, row.topicId]),
  );
}

type ShuiyuanHref =
  | { kind: 'shuiyuan'; topicId: number; postNumber: number | null }
  | { kind: 'shuiyuan-post'; postId: number };

interface Like extends StoredNotice {
  body: string;
  count: number;
}

function likeSummary(likes: Like[]): string {
  const total = likes.reduce((sum, like) => sum + like.count, 0);
  const names = [...new Set(likes.map((like) => like.body).filter(Boolean))].slice(0, 2);
  const shown = names.join('、');
  return names.length === total ? `${shown} 赞了你的帖子` : `${shown} 等 ${total} 人赞了你的帖子`;
}

export const shuiyuanNoticeSource: NoticeSource = {
  id: 'shuiyuan',
  account: () => loadShuiyuanCredential()?.username ?? null,
  async refresh(key) {
    // boundAt 是账号绑定时刻：早于它的存量未读只进通知列表，不弹系统通知。
    const credential = loadShuiyuanCredential();
    if (credential?.username !== key) return;
    const remote = await listShuiyuanNotifications();
    if (loadShuiyuanCredential()?.username !== key) return;
    const existing = existingNotifications('shuiyuan', key);
    const previouslyUnreadLikes = unreadLikes(key);
    const likeBursts = new Map<number, Like[]>();
    for (const item of remote) {
      // 合并点赞（type 19）是同一人连赞多层：没有 topic_id，count 是楼层数，单独成条不进主题分组。
      const href: ShuiyuanHref | null =
        item.topicId !== null
          ? { kind: 'shuiyuan', topicId: item.topicId, postNumber: item.postNumber }
          : item.type === 19 && item.originalPostId !== null
            ? { kind: 'shuiyuan-post', postId: item.originalPostId }
            : null;
      if (href === null) continue;
      const id = `shuiyuan:${key}:${item.id}`;
      const title = shuiyuanTitle(item);
      const createdAt = item.createdAt || new Date().toISOString();
      const body =
        href.kind === 'shuiyuan-post'
          ? `${item.displayUsername ?? '有人'} 赞了你的 ${item.count} 个帖子`
          : (item.displayUsername ?? '');
      const category = shuiyuanCategory(item.type);
      const syncedAt = new Date().toISOString();
      upsertNotification(
        'shuiyuan',
        key,
        id,
        title,
        body,
        createdAt,
        href,
        category,
        item.count,
        item.read ? syncedAt : null,
      );
      if (item.read) previouslyUnreadLikes.delete(id);
      const previousCount = existing.get(id);
      // 新 id，或服务端原地合并使 count 增长（同一条重新变为未读）都算一次新到达。
      const arrived = previousCount === undefined || item.count > previousCount;
      // 服务端已读的条目只同步状态，不弹系统通知；绑定后发生的未读互动首次到达才弹。
      if (item.read || !arrived || item.createdAt <= credential.boundAt) continue;
      const notification: Like = { id, source: 'shuiyuan', title, body, count: item.count, href };
      if (href.kind === 'shuiyuan-post') systemNotifyItem(notification, body);
      else if (category === 'like')
        likeBursts.set(href.topicId, [...(likeBursts.get(href.topicId) ?? []), notification]);
      else systemNotifyItem(notification);
    }
    const unreadLikeTopics = new Set(previouslyUnreadLikes.values());
    for (const [topicId, likes] of likeBursts) {
      if (unreadLikeTopics.has(topicId)) continue;
      systemNotifyItem(likes[0]!, likeSummary(likes));
    }
    // `/notifications.json?recent=true` 是有界分页：不在其中不代表已读，只有服务端明确已读才标记。
    saveNotificationRefresh('shuiyuan', key, null);
  },
  link: (href) =>
    href.kind === 'shuiyuan-post' && typeof href.postId === 'number'
      ? { target: { page: 'shuiyuan', postId: href.postId } }
      : typeof href.topicId === 'number'
        ? {
            target: {
              page: 'shuiyuan',
              topicId: href.topicId,
              ...(typeof href.postNumber === 'number' ? { postNumber: href.postNumber } : {}),
            },
            group: `topic:${href.topicId}`,
          }
        : null,
  // 点赞按主题成组展示与弹窗，打开或标记其中一条即视为读完该主题的全部点赞。
  markRead(id, key) {
    getDatabase()
      .prepare(
        `UPDATE notifications SET read_at = COALESCE(read_at, ?)
         WHERE source = 'shuiyuan' AND account_key = ? AND category = 'like'
           AND json_extract(href, '$.topicId') = (
             SELECT json_extract(href, '$.topicId') FROM notifications WHERE id = ? AND category = 'like'
           )`,
      )
      .run(new Date().toISOString(), key, id);
  },
};
