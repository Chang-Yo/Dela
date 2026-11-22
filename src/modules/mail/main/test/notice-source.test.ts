import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTestHostPorts } from '../../../../core/test/host-mock';

vi.mock('../../../todo', () => ({
  getTodoState: () => ({ items: [], sources: [], syncing: false }),
  todoSyncedAt: () => null,
  todoSyncError: () => null,
  todoNotifications: () => [],
  onTaskNotice: vi.fn(),
  onTodoChange: vi.fn(),
  markTodoRead: vi.fn(),
}));
vi.mock('../api', () => ({
  getMailState: vi.fn(() => ({ sync: { phase: 'idle', error: null } })),
  markMailSeen: vi.fn(),
  markAllMailSeen: vi.fn(),
  onMailCacheChanged: vi.fn(),
}));
vi.mock('../../../notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../notifications')>()),
  systemNotifyItem: vi.fn(),
}));

import { notificationsModule, systemNotifyItem } from '../../../notifications';
import { mailSchema } from '../../data/schema';
import { onMailCacheChanged } from '../api';
import { registerMailNotices } from '../notice-source';

let db: Database.Database;

function unreadIds(): string[] {
  return (
    db.prepare('SELECT id FROM notifications WHERE read_at IS NULL ORDER BY id').all() as {
      id: string;
    }[]
  ).map((row) => row.id);
}

function insertMail(id: number, date: string, seen = 0): void {
  db.prepare(
    'INSERT INTO mail_messages (id, folder_id, uid, subject, sender_name, sender_address, snippet, date, seen) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, id, `邮件 ${id}`, '课程组', 'course@sjtu.edu.cn', '请提交作业', date, seen);
}

/** 模拟邮件缓存变化后的重播：读信、删除与同步完成都会触发。 */
function cacheChanged(): void {
  vi.mocked(onMailCacheChanged).mock.calls.at(-1)![0]();
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const table of [...mailSchema.tables, ...notificationsModule.schema!.tables]) db.exec(table);
  db.prepare(
    "INSERT INTO mail_accounts (id, address, imap_host, imap_port, created_at) VALUES (1, ?, 'imap.sjtu.edu.cn', 993, ?)",
  ).run('student@sjtu.edu.cn', '2026-09-10T00:00:00.000Z');
  db.prepare(
    "INSERT INTO mail_folders (id, account_id, path, name, special_use) VALUES (1, 1, 'INBOX', 'INBOX', '\\Inbox')",
  ).run();
  provideTestHostPorts({ database: () => db as never });
});

describe('mail notice source', () => {
  it('lists unread mail predating signup silently and toasts later arrivals', () => {
    insertMail(10, '2026-09-03T00:00:00.000Z');
    registerMailNotices();
    insertMail(11, '2026-09-11T00:00:00.000Z');
    cacheChanged();

    expect(unreadIds()).toEqual(['mail:student@sjtu.edu.cn:10', 'mail:student@sjtu.edu.cn:11']);
    expect(vi.mocked(systemNotifyItem).mock.calls.map(([item]) => item.id)).toEqual([
      'mail:student@sjtu.edu.cn:11',
    ]);
  });

  it('follows the message seen flag and hides locally deleted mail', () => {
    insertMail(10, '2026-09-11T00:00:00.000Z');
    insertMail(11, '2026-09-11T00:00:00.000Z');
    registerMailNotices();
    db.prepare('UPDATE mail_messages SET seen = 1 WHERE id = 10').run();
    db.prepare("UPDATE mail_messages SET deleted_at = '2026-09-12' WHERE id = 11").run();
    cacheChanged();

    expect(db.prepare('SELECT id, read_at IS NOT NULL AS read FROM notifications').all()).toEqual([
      { id: 'mail:student@sjtu.edu.cn:10', read: 1 },
    ]);
  });
});
