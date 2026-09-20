import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../credentials', () => ({ loadShuiyuanCredential: vi.fn() }));
vi.mock('../mail/api', () => ({
  getMailState: vi.fn(() => ({ sync: { phase: 'idle', error: null } })),
}));
vi.mock('../shuiyuan/api', () => ({ listShuiyuanNotifications: vi.fn() }));

import {
  getNotificationState,
  markAllNotificationsRead,
  refreshNotifications,
  setNotificationSnooze,
} from '../notifications';
import { getDatabase } from '../database';
import { loadShuiyuanCredential } from '../credentials';
import { listShuiyuanNotifications } from '../shuiyuan/api';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE mail_accounts (id INTEGER PRIMARY KEY, address TEXT NOT NULL);
    CREATE TABLE mail_folders (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, special_use TEXT);
    CREATE TABLE mail_messages (id INTEGER PRIMARY KEY, folder_id INTEGER NOT NULL, subject TEXT, sender_name TEXT, sender_address TEXT, snippet TEXT, date TEXT, seen INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, source TEXT NOT NULL, account_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, source_unread INTEGER NOT NULL DEFAULT 1, href TEXT NOT NULL);
    CREATE TABLE notification_refreshes (source TEXT NOT NULL, account_key TEXT NOT NULL, last_success_at TEXT, error TEXT, PRIMARY KEY(source, account_key));
  `);
  return db;
}

describe('local notification inbox', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(loadShuiyuanCredential).mockReturnValue(null);
    vi.mocked(listShuiyuanNotifications).mockResolvedValue([]);
  });

  it('collects cached unread inbox mail and does not resurrect a locally read notification', async () => {
    db.prepare('INSERT INTO mail_accounts VALUES (1, ?)').run('student@sjtu.edu.cn');
    db.prepare("INSERT INTO mail_folders VALUES (1, 1, '\\Inbox')").run();
    db.prepare('INSERT INTO mail_messages VALUES (10, 1, ?, ?, ?, ?, ?, 0, NULL)').run(
      '作业提醒',
      '课程组',
      'course@sjtu.edu.cn',
      '请提交作业',
      '2026-09-16T00:00:00.000Z',
    );

    await refreshNotifications();
    expect(getNotificationState().unreadCount).toBe(1);
    markAllNotificationsRead();
    await refreshNotifications();
    expect(getNotificationState().unreadCount).toBe(0);
  });

  it('keeps Shuiyuan errors and cached notifications without writing the remote read state', async () => {
    vi.mocked(loadShuiyuanCredential).mockReturnValue({
      username: 'dela-user',
      key: 'test-key',
      clientId: 'test-client',
      boundAt: '2026-09-16T00:00:00.000Z',
    });
    vi.mocked(listShuiyuanNotifications).mockResolvedValueOnce([
      {
        id: 7,
        type: 1,
        read: false,
        highPriority: false,
        createdAt: '2026-09-16T00:00:00.000Z',
        topicId: 22,
        postNumber: 3,
        fancyTitle: '回复了你的帖子',
        displayUsername: 'alice',
      },
    ]);
    await refreshNotifications();
    expect(getNotificationState('shuiyuan').items).toHaveLength(1);
    vi.mocked(listShuiyuanNotifications).mockRejectedValueOnce(new Error('network unavailable'));
    await refreshNotifications();
    const state = getNotificationState();
    expect(state.items).toHaveLength(1);
    expect(state.refresh.shuiyuan?.error).toBe('network unavailable');
  });

  it('persists a global snooze timestamp without changing the unread count', async () => {
    setNotificationSnooze('2026-09-16T01:00:00.000Z');
    expect(getNotificationState().snoozedUntil).toBe('2026-09-16T01:00:00.000Z');
  });
});
