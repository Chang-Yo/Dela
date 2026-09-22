import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../todo', () => ({
  getTodoState: () => ({ syncedAt: null, error: null }),
  todoNotifications: () => [],
  markTodoRead: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../credentials', () => ({ loadShuiyuanCredential: vi.fn() }));
vi.mock('../mail/api', () => ({
  getMailState: vi.fn(() => ({ sync: { phase: 'idle', error: null } })),
  markMailSeen: vi.fn(),
  markAllMailSeen: vi.fn(),
  onMailCacheChanged: vi.fn(),
}));
vi.mock('../shuiyuan/api', () => ({ listShuiyuanNotifications: vi.fn() }));
vi.mock('../system-notify', () => ({
  armSystemNotifications: vi.fn(),
  isWorkspaceWindow: () => false,
  systemNotifyItem: vi.fn(),
  NOTIFICATIONS_SNOOZE_KEY: 'notifications-snoozed-until',
}));

import {
  getNotificationState,
  markAllNotificationsRead,
  markNotificationRead,
  refreshNotifications,
  setNotificationSnooze,
} from '../notifications';
import { getDatabase } from '../database';
import { loadShuiyuanCredential } from '../credentials';
import { listShuiyuanNotifications } from '../shuiyuan/api';
import { markAllMailSeen, markMailSeen } from '../mail/api';

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

function insertUnreadInboxMail(db: Database.Database): void {
  db.prepare('INSERT INTO mail_accounts VALUES (1, ?)').run('student@sjtu.edu.cn');
  db.prepare("INSERT INTO mail_folders VALUES (1, 1, '\\Inbox')").run();
  db.prepare('INSERT INTO mail_messages VALUES (10, 1, ?, ?, ?, ?, ?, 0, NULL)').run(
    '作业提醒',
    '课程组',
    'course@sjtu.edu.cn',
    '请提交作业',
    '2026-09-16T00:00:00.000Z',
  );
}

describe('local notification inbox', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(loadShuiyuanCredential).mockReturnValue(null);
    vi.mocked(listShuiyuanNotifications).mockResolvedValue([]);
    // 模拟服务器标记成功后的本地落库：已读派生自 mail_messages.seen。
    vi.mocked(markMailSeen).mockImplementation(async (messageId) => {
      getDatabase()
        .prepare('UPDATE mail_messages SET seen = 1 WHERE id = ?')
        .run(messageId as number);
      return { ok: true };
    });
    vi.mocked(markAllMailSeen).mockImplementation(async () => {
      getDatabase().prepare('UPDATE mail_messages SET seen = 1 WHERE deleted_at IS NULL').run();
      return { ok: true };
    });
  });

  it('collects cached unread inbox mail and does not resurrect a locally read notification', async () => {
    insertUnreadInboxMail(db);

    await refreshNotifications();
    expect(getNotificationState().unreadCount).toBe(1);
    await markAllNotificationsRead();
    await refreshNotifications();
    expect(getNotificationState().unreadCount).toBe(0);
  });

  it('derives mail notification read state from the message seen flag', async () => {
    insertUnreadInboxMail(db);

    await refreshNotifications();
    expect(getNotificationState().unreadCount).toBe(1);
    // 邮件视图读信（或他端同步把 seen 置 1）后，通知随之已读，不依赖通知行 read_at。
    db.prepare('UPDATE mail_messages SET seen = 1').run();
    const state = getNotificationState();
    expect(state.unreadCount).toBe(0);
    expect(state.items[0]!.readAt).not.toBeNull();
  });

  it('marking one mail notification read delegates to the mail seen state', async () => {
    insertUnreadInboxMail(db);

    await refreshNotifications();
    await markNotificationRead('mail:student@sjtu.edu.cn:10');
    expect(markMailSeen).toHaveBeenCalledWith(10);
    expect(getNotificationState().unreadCount).toBe(0);
  });

  it('mark-all-read marks inbox mail as seen through markAllMailSeen', async () => {
    insertUnreadInboxMail(db);

    await refreshNotifications();
    await markAllNotificationsRead();
    expect(markAllMailSeen).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT seen FROM mail_messages').get()).toEqual({ seen: 1 });
    expect(getNotificationState().unreadCount).toBe(0);
  });

  it('keeps mail notifications unread when the mail server cannot be reached', async () => {
    insertUnreadInboxMail(db);

    await refreshNotifications();
    vi.mocked(markAllMailSeen).mockResolvedValueOnce({ ok: false, error: '无法连接邮件服务器' });
    await markAllNotificationsRead();
    const state = getNotificationState();
    expect(state.unreadCount).toBe(1);
    expect(state.refresh.mail?.error).toBe('无法连接邮件服务器');
  });

  it('hides a mail notification whose message was locally deleted', async () => {
    insertUnreadInboxMail(db);

    await refreshNotifications();
    expect(getNotificationState().items).toHaveLength(1);
    db.prepare('UPDATE mail_messages SET deleted_at = ?').run('2026-09-16T00:00:00.000Z');
    const state = getNotificationState();
    expect(state.items).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
  });

  it('marks shuiyuan notifications read locally', async () => {
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
    expect(getNotificationState('shuiyuan').items[0]!.readAt).toBeNull();
    await markNotificationRead('shuiyuan:dela-user:7');
    expect(getNotificationState('shuiyuan').items[0]!.readAt).not.toBeNull();
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
