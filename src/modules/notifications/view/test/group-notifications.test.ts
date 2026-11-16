import { describe, expect, it } from 'vitest';
import type { NotificationItem } from '../../contract';
import { groupNotifications } from '../group-notifications';

function like(
  id: string,
  topicId: number,
  readAt: string | null,
  body = 'alice',
  count = 1,
): NotificationItem {
  return {
    id,
    source: 'shuiyuan',
    category: 'like',
    count,
    title: '我的帖子',
    body,
    createdAt: '2026-09-17T00:00:00.000Z',
    readAt,
    target: { page: 'shuiyuan', topicId, postNumber: 1 },
    group: `topic:${topicId}`,
  };
}

function reply(id: string, topicId: number): NotificationItem {
  return { ...like(id, topicId, null), category: 'reply' };
}

function mail(id: string): NotificationItem {
  return {
    ...like(id, 0, null),
    source: 'mail',
    category: null,
    target: { page: 'mail', messageId: 5 },
    group: null,
  };
}

const READ = '2026-09-16T00:00:00.000Z';

describe('groupNotifications', () => {
  it('merges unread likes on one topic into a group placed at its newest member', () => {
    const entries = groupNotifications([
      mail('m'),
      like('a', 22, null, 'alice'),
      like('b', 22, null, 'bob'),
      like('c', 23, null, 'carol'),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['item', 'group', 'item']);
    const group = entries[1];
    expect(group?.kind === 'group' && group.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('never merges read likes into an unread group on the same topic', () => {
    const entries = groupNotifications([
      like('a', 22, null),
      like('b', 22, READ),
      like('c', 22, null),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['group', 'item']);
    const group = entries[0];
    expect(group?.kind === 'group' && group.items.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('groups read likes among themselves and leaves unread ones alone', () => {
    const entries = groupNotifications([
      like('a', 22, READ),
      like('b', 22, READ),
      like('c', 22, null),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['group', 'item']);
  });

  it('does not group replies, mentions, or mail even when they share a topic', () => {
    const entries = groupNotifications([reply('a', 22), reply('b', 22), mail('m')]);
    expect(entries.every((entry) => entry.kind === 'item')).toBe(true);
    expect(entries).toHaveLength(3);
  });
});
