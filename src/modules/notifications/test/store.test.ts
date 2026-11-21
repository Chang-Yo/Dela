import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTestHostPorts } from '../../../core/test/host-mock';

vi.mock('../../todo', () => ({
  getTodoState: () => ({ items: [], sources: [], syncing: false }),
  todoSyncedAt: () => null,
  todoSyncError: () => null,
  todoNotifications: () => [],
  markTodoRead: vi.fn(),
}));
vi.mock('../main/system', () => ({
  armSystemNotifications: vi.fn(),
  showMessageNotice: vi.fn(),
  NOTIFICATIONS_SNOOZE_KEY: 'notifications-snoozed-until',
}));

import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationState,
  refreshNotifications,
  registerNoticeSource,
  saveNotificationRefresh,
  upsertNotification,
  type NoticeSource,
} from '../main/store';

function fakeSource(id: string) {
  return {
    id,
    account: vi.fn<() => string | null>(() => null),
    refresh: vi.fn(async (account: string) => {
      upsertNotification(
        id,
        account,
        `${id}:${account}:1`,
        '通知',
        '',
        '2026-09-17T00:00:00.000Z',
        {
          page: id,
        },
      );
      saveNotificationRefresh(id, account, null);
    }),
    link: (href: Record<string, unknown>) =>
      typeof href.page === 'string' ? { target: { page: 'todo' as const } } : null,
    markRead: vi.fn<NonNullable<NoticeSource['markRead']>>(),
    markAllRead: vi.fn<NonNullable<NoticeSource['markAllRead']>>(async () => {}),
  } satisfies NoticeSource;
}

const alpha = fakeSource('alpha');
const beta = fakeSource('beta');
registerNoticeSource(alpha);
registerNoticeSource(beta);

beforeEach(() => {
  vi.clearAllMocks();
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, source TEXT NOT NULL, account_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, source_unread INTEGER NOT NULL DEFAULT 1, href TEXT NOT NULL, category TEXT, count INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE notification_refreshes (source TEXT NOT NULL, account_key TEXT NOT NULL, last_success_at TEXT, error TEXT, PRIMARY KEY(source, account_key));
  `);
  provideTestHostPorts({ database: () => db as never });
  alpha.account.mockReturnValue('students');
  beta.account.mockReturnValue('owner');
});

describe('notification inbox', () => {
  it('shows a source only for its current account and hides unregistered sources', async () => {
    upsertNotification('canvas', 'owner', 'canvas:owner:1', '公告', '课程', '2026-09-17', {});
    beta.account.mockReturnValue(null);
    await refreshNotifications();
    expect(alpha.refresh).toHaveBeenCalledWith('students', false);
    expect(notificationState().items.map((item) => item.id)).toEqual(['alpha:students:1']);

    alpha.account.mockReturnValue('someone-else');
    expect(notificationState().items).toHaveLength(0);
  });

  it('records a failed refresh and keeps the cached notifications', async () => {
    await refreshNotifications();
    alpha.refresh.mockRejectedValueOnce(new Error('network unavailable'));
    await refreshNotifications();
    const state = notificationState();
    expect(state.items.filter((item) => item.source === 'alpha')).toHaveLength(1);
    expect(state.refresh.alpha?.error).toBe('network unavailable');
  });

  it('keeps other sources visible when one credential cannot be read', async () => {
    alpha.account.mockImplementation(() => {
      throw new Error('decrypt failed');
    });
    await refreshNotifications();
    expect(notificationState().items.map((item) => item.source)).toEqual(['beta']);
  });

  it('keeps a notification unread when the source fails to mark it', async () => {
    await refreshNotifications();
    alpha.markRead.mockRejectedValueOnce(new Error('无法连接服务器'));
    await markNotificationRead('alpha:students:1');
    expect(notificationState(['alpha']).unreadCount).toBe(1);
    await markNotificationRead('alpha:students:1');
    expect(alpha.markRead).toHaveBeenLastCalledWith('alpha:students:1', 'students');
    expect(notificationState(['alpha']).unreadCount).toBe(0);
  });

  it('limits listing and mark-all to the selected sources', async () => {
    await refreshNotifications();
    expect(notificationState(['alpha']).items.map((item) => item.source)).toEqual(['alpha']);
    await markAllNotificationsRead(['alpha']);
    expect(beta.markAllRead).not.toHaveBeenCalled();
    expect(notificationState(['alpha']).unreadCount).toBe(0);
    expect(notificationState(['beta']).unreadCount).toBe(1);
  });
});
