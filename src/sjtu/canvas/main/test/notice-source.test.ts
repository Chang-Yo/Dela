import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../modules/todo', () => ({
  getTodoState: () => ({ syncedAt: null, error: null }),
  todoNotifications: () => [],
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../../../../main/database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../../../main/ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../../../main/mail/api', () => ({
  getMailState: vi.fn(() => ({ sync: { phase: 'idle', error: null } })),
  onMailCacheChanged: vi.fn(),
}));
vi.mock('../../../../main/notifications/system', () => ({
  armSystemNotifications: vi.fn(),
  isWorkspaceWindow: () => false,
  systemNotifyItem: vi.fn(),
  NOTIFICATIONS_SNOOZE_KEY: 'notifications-snoozed-until',
}));
vi.mock('../todo-source', () => ({ canvasOwner: () => 'owner' }));
vi.mock('../api', () => ({ listTodoCanvasCourses: vi.fn(), listCanvasAnnouncements: vi.fn() }));

import {
  getNotificationState,
  refreshNotifications,
  registerNoticeSource,
} from '../../../../main/notifications';
import { getDatabase } from '../../../../main/database';
import { systemNotifyItem } from '../../../../main/notifications/system';
import { listCanvasAnnouncements, listTodoCanvasCourses } from '../api';
import { canvasNoticeSource } from '../notice-source';

registerNoticeSource(canvasNoticeSource);

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE mail_accounts (id INTEGER PRIMARY KEY, address TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE mail_messages (id INTEGER PRIMARY KEY, seen INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, source TEXT NOT NULL, account_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, source_unread INTEGER NOT NULL DEFAULT 1, href TEXT NOT NULL, category TEXT, count INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE notification_refreshes (source TEXT NOT NULL, account_key TEXT NOT NULL, last_success_at TEXT, error TEXT, PRIMARY KEY(source, account_key));
  `);
  return db;
}

describe('Canvas notice source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDatabase).mockReturnValue(createDb());
  });

  it('lists existing announcements silently on first sync and toasts later unread ones', async () => {
    vi.mocked(listTodoCanvasCourses).mockResolvedValue([
      { id: 1, name: '操作系统', code: 'CS260' },
    ]);
    const announcement = (id: number, read: boolean) => ({
      sourceId: `discussion:1:${id}`,
      title: `公告 ${id}`,
      postedAt: `2026-09-1${id}T00:00:00.000Z`,
      read,
    });
    vi.mocked(listCanvasAnnouncements).mockResolvedValueOnce([
      announcement(1, true),
      announcement(2, false),
    ]);

    await refreshNotifications(true);
    expect(getNotificationState(['canvas'])).toMatchObject({ totalCount: 2, unreadCount: 1 });
    expect(systemNotifyItem).not.toHaveBeenCalled();

    vi.mocked(listCanvasAnnouncements).mockResolvedValueOnce([
      announcement(3, false),
      announcement(2, false),
      announcement(1, true),
    ]);
    await refreshNotifications(true);
    expect(systemNotifyItem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(systemNotifyItem).mock.calls[0]![0]).toMatchObject({
      id: 'canvas:owner:discussion:1:3',
      body: '操作系统',
      href: { kind: 'canvas', sourceId: 'discussion:1:3' },
    });
  });

  it('baselines courses one by one and keeps syncing past a failing course', async () => {
    const course = (id: number) => ({ id, name: `课程 ${id}`, code: '' });
    const announcement = (courseId: number, id: number) => ({
      sourceId: `discussion:${courseId}:${id}`,
      title: `公告 ${id}`,
      postedAt: '2026-09-10T00:00:00.000Z',
      read: false,
    });
    vi.mocked(listTodoCanvasCourses).mockResolvedValueOnce([course(1)]);
    vi.mocked(listCanvasAnnouncements).mockResolvedValueOnce([announcement(1, 1)]);
    await refreshNotifications(true);

    // 新学期加入课程 2（存量公告）与课程 3（请求失败），课程 1 有新公告。
    vi.mocked(listTodoCanvasCourses).mockResolvedValueOnce([course(3), course(2), course(1)]);
    vi.mocked(listCanvasAnnouncements)
      .mockRejectedValueOnce(new Error('令牌失效或无权访问此内容'))
      .mockResolvedValueOnce([announcement(2, 5)])
      .mockResolvedValueOnce([announcement(1, 2), announcement(1, 1)]);
    await refreshNotifications(true);

    expect(vi.mocked(systemNotifyItem).mock.calls.map(([item]) => item.id)).toEqual([
      'canvas:owner:discussion:1:2',
    ]);
    expect(getNotificationState(['canvas'])).toMatchObject({
      totalCount: 3,
      refresh: { canvas: { error: '课程 3：令牌失效或无权访问此内容' } },
    });
  });
});
