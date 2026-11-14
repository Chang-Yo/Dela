import type { NotificationItem } from '../../../shared/api';

export type NotificationEntry =
  | { kind: 'item'; item: NotificationItem }
  | { kind: 'group'; key: string; items: NotificationItem[] };

function likeTopicKey(item: NotificationItem): string | null {
  if (item.category !== 'like' || item.href.kind !== 'shuiyuan') return null;
  return `${item.readAt ? 'read' : 'unread'}:${item.href.topicId}`;
}

export function groupNotifications(items: readonly NotificationItem[]): NotificationEntry[] {
  const sizes = new Map<string, number>();
  for (const item of items) {
    const key = likeTopicKey(item);
    if (key) sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  const groups = new Map<string, Extract<NotificationEntry, { kind: 'group' }>>();
  const entries: NotificationEntry[] = [];
  for (const item of items) {
    const key = likeTopicKey(item);
    if (!key || (sizes.get(key) ?? 0) < 2) {
      entries.push({ kind: 'item', item });
      continue;
    }
    let group = groups.get(key);
    if (!group) {
      group = { kind: 'group', key, items: [] };
      groups.set(key, group);
      entries.push(group);
    }
    group.items.push(item);
  }
  return entries;
}

export function likeGroupSummary(likes: readonly NotificationItem[]): string {
  const total = likes.reduce((sum, like) => sum + like.count, 0);
  const names = [...new Set(likes.map((like) => like.body).filter(Boolean))].slice(0, 2);
  const shown = names.join('、');
  return names.length === total ? `${shown} 赞了你的帖子` : `${shown} 等 ${total} 人赞了你的帖子`;
}
