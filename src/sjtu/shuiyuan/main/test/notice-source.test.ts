import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../modules/todo', () => ({
  getTodoState: () => ({ items: [], sources: [], syncing: false }),
  todoSyncedAt: () => null,
  todoSyncError: () => null,
  todoNotifications: () => [],
  markTodoRead: vi.fn(),
}));
vi.mock('../credentials', () => ({ loadShuiyuanCredential: vi.fn() }));
vi.mock('../../../../modules/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../modules/notifications')>()),
  systemNotifyItem: vi.fn(),
}));
vi.mock('../api', () => ({ listShuiyuanNotifications: vi.fn() }));

import { provideTestHostPorts } from '../../../../core/test/host-mock';
import {
  notificationsModule,
  registerNoticeSource,
  systemNotifyItem,
} from '../../../../modules/notifications';
import type { NotificationState } from '../../../../modules/notifications/contract';
import { loadShuiyuanCredential } from '../credentials';
import { listShuiyuanNotifications } from '../api';
import { shuiyuanNoticeSource } from '../notice-source';

registerNoticeSource(shuiyuanNoticeSource);
const ipc = notificationsModule.ipc!;
const getNotificationState = (sources?: string[]) =>
  ipc.call('state', sources) as NotificationState;
const refreshNotifications = () => ipc.call('refresh', undefined) as Promise<NotificationState>;
const markNotificationRead = (id: string) => ipc.call('markRead', id);
const markAllNotificationsRead = () => ipc.call('markAllRead', undefined);

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const table of notificationsModule.schema!.tables) db.exec(table);
  return db;
}

function bindShuiyuan(boundAt = '2026-09-16T00:00:00.000Z'): void {
  vi.mocked(loadShuiyuanCredential).mockReturnValue({
    username: 'dela-user',
    key: 'test-key',
    clientId: 'test-client',
    boundAt,
  });
}

function shuiyuanLike(id: number, topicId: number, displayUsername: string, count = 1) {
  return {
    id,
    type: 5,
    read: false,
    highPriority: false,
    count,
    createdAt: '2026-09-17T00:00:00.000Z',
    topicId,
    postNumber: 1,
    fancyTitle: '我的帖子',
    displayUsername,
    originalPostId: null,
  };
}

function shuiyuanMention(id: number, topicId: number, createdAt: string) {
  return { ...shuiyuanLike(id, topicId, 'alice'), type: 1, createdAt };
}

function shuiyuanConsolidatedLike(id: number, displayUsername: string, count: number) {
  return {
    ...shuiyuanLike(id, 0, displayUsername, count),
    type: 19,
    topicId: null,
    postNumber: null,
    fancyTitle: '如何忘掉在高考中的成功与失败',
    originalPostId: 4926962,
  };
}

describe('Shuiyuan notice source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const db = createDb();
    provideTestHostPorts({ database: () => db as never });
    bindShuiyuan();
  });

  it('skips system toasts for notifications predating the binding but toasts later ones', async () => {
    bindShuiyuan('2026-09-10T00:00:00.000Z');
    vi.mocked(listShuiyuanNotifications).mockResolvedValueOnce([
      shuiyuanMention(7, 22, '2026-09-03T00:00:00.000Z'),
      shuiyuanMention(8, 23, '2026-09-11T00:00:00.000Z'),
    ]);

    await refreshNotifications();
    expect(getNotificationState(['shuiyuan']).items).toHaveLength(2);
    expect(systemNotifyItem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(systemNotifyItem).mock.calls[0]![0].id).toBe('shuiyuan:dela-user:8');
  });

  it('keeps errors and cached notifications without writing the remote read state', async () => {
    vi.mocked(listShuiyuanNotifications).mockResolvedValueOnce([
      shuiyuanMention(7, 22, '2026-09-17T00:00:00.000Z'),
    ]);
    await refreshNotifications();
    vi.mocked(listShuiyuanNotifications).mockRejectedValueOnce(new Error('network unavailable'));
    await refreshNotifications();
    const state = getNotificationState();
    expect(state.items).toHaveLength(1);
    expect(state.refresh.shuiyuan?.error).toBe('network unavailable');
  });

  it('merges a burst of likes on one topic into a single system toast', async () => {
    vi.mocked(listShuiyuanNotifications).mockResolvedValueOnce([
      shuiyuanLike(1, 22, 'alice'),
      shuiyuanLike(2, 22, 'bob'),
      shuiyuanLike(3, 22, 'carol'),
    ]);

    await refreshNotifications();
    expect(getNotificationState(['shuiyuan']).items).toHaveLength(3);
    expect(systemNotifyItem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(systemNotifyItem).mock.calls[0]![1]).toBe('alice、bob 等 3 人赞了你的帖子');
  });

  it('alerts again for a topic once all of its likes have been read', async () => {
    vi.mocked(listShuiyuanNotifications)
      .mockResolvedValueOnce([shuiyuanLike(1, 22, 'alice')])
      .mockResolvedValueOnce([shuiyuanLike(1, 22, 'alice'), shuiyuanLike(2, 22, 'bob')]);

    await refreshNotifications();
    await markAllNotificationsRead();
    await refreshNotifications();
    expect(systemNotifyItem).toHaveBeenCalledTimes(2);
    expect(vi.mocked(systemNotifyItem).mock.calls[1]![1]).toBe('bob 赞了你的帖子');
  });

  it('syncs server read state without alerting and keeps local reads', async () => {
    vi.mocked(listShuiyuanNotifications)
      .mockResolvedValueOnce([
        { ...shuiyuanLike(1, 22, 'alice'), read: true },
        shuiyuanLike(2, 23, 'bob'),
      ])
      .mockResolvedValueOnce([
        { ...shuiyuanLike(1, 22, 'alice'), read: true },
        shuiyuanLike(2, 23, 'bob'),
      ]);

    await refreshNotifications();
    expect(getNotificationState(['shuiyuan']).unreadCount).toBe(1);
    expect(vi.mocked(systemNotifyItem).mock.calls.map(([item]) => item.id)).toEqual([
      'shuiyuan:dela-user:2',
    ]);
    await markAllNotificationsRead();
    await refreshNotifications();
    expect(getNotificationState(['shuiyuan']).unreadCount).toBe(0);
    expect(systemNotifyItem).toHaveBeenCalledTimes(1);
  });

  it('shows a consolidated like as its own item and alerts again when its post count grows', async () => {
    vi.mocked(listShuiyuanNotifications)
      .mockResolvedValueOnce([shuiyuanConsolidatedLike(9, 'alice', 3), shuiyuanLike(1, 22, 'bob')])
      .mockResolvedValueOnce([shuiyuanConsolidatedLike(9, 'alice', 5), shuiyuanLike(1, 22, 'bob')]);

    await refreshNotifications();
    const consolidated = getNotificationState(['shuiyuan']).items.find(
      (item) => item.id === 'shuiyuan:dela-user:9',
    )!;
    expect(consolidated.target).toEqual({ page: 'shuiyuan', postId: 4926962 });
    expect(consolidated.body).toBe('alice 赞了你的 3 个帖子');
    expect(systemNotifyItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: consolidated.id }),
      'alice 赞了你的 3 个帖子',
    );

    await markNotificationRead('shuiyuan:dela-user:9');
    expect(getNotificationState(['shuiyuan']).unreadCount).toBe(1);
    await refreshNotifications();
    expect(vi.mocked(systemNotifyItem).mock.calls.at(-1)![1]).toBe('alice 赞了你的 5 个帖子');
  });
});
