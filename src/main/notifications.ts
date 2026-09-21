import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import type {
  NotificationFilter,
  NotificationItem,
  NotificationSource,
  NotificationState,
  ShuiyuanNotificationItem,
} from '../shared/api';
import { getTodoState, markTodoRead, todoNotifications } from './todo';
import { getDatabase } from './database';
import { loadShuiyuanCredential } from './credentials';
import { checkWorkspaceSender } from './ipc';
import { getMailState } from './mail/api';
import { listShuiyuanNotifications } from './shuiyuan/api';

const filterSchema = z.union([
  z.literal('all'),
  z.literal('mail'),
  z.literal('shuiyuan'),
  z.literal('todo'),
]);
const snoozeSchema = z.string().datetime().nullable();
let activeRefresh: Promise<NotificationState> | null = null;

type ActiveAccount = { source: NotificationSource; key: string };

interface NotificationRow {
  id: string;
  source: NotificationSource;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  source_unread: number;
  href: string;
}

function currentAccounts(): ActiveAccount[] {
  const db = getDatabase();
  const mail = db.prepare('SELECT address FROM mail_accounts ORDER BY id LIMIT 1').get() as
    { address: string } | undefined;
  const accounts: ActiveAccount[] = mail ? [{ source: 'mail', key: mail.address }] : [];
  try {
    const credential = loadShuiyuanCredential();
    if (credential) accounts.push({ source: 'shuiyuan', key: credential.username });
  } catch {
    // A broken encrypted Shuiyuan credential must not hide local mail notifications.
  }
  return accounts;
}

function accountFor(source: NotificationSource): string | null {
  return currentAccounts().find((account) => account.source === source)?.key ?? null;
}

function notificationState(filter: NotificationFilter = 'all'): NotificationState {
  refreshMail(false);
  const db = getDatabase();
  const accounts = currentAccounts();
  const active = accounts.filter((account) => filter === 'all' || account.source === filter);
  const clauses = active.map(() => '(source = ? AND account_key = ?)');
  const bindings = active.flatMap((account) => [account.source, account.key]);
  const where = clauses.length
    ? `(${clauses.join(' OR ')}) AND (source != 'mail' OR EXISTS (SELECT 1 FROM mail_messages m WHERE m.id = json_extract(notifications.href, '$.messageId') AND m.deleted_at IS NULL))`
    : '0';
  const rows =
    clauses.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, source, title, body, created_at, read_at, source_unread, href FROM notifications
             WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 200`,
          )
          .all(...bindings) as NotificationRow[]);
  const items = rows.flatMap((row): NotificationItem[] => {
    try {
      const href = JSON.parse(row.href) as NotificationItem['href'];
      const readAt = row.read_at;
      if (href.kind === 'mail' && typeof href.messageId === 'number') {
        return [
          {
            id: row.id,
            source: row.source,
            title: row.title,
            body: row.body,
            createdAt: row.created_at,
            readAt,
            href,
          },
        ];
      }
      if (href.kind === 'shuiyuan' && typeof href.topicId === 'number') {
        return [
          {
            id: row.id,
            source: row.source,
            title: row.title,
            body: row.body,
            createdAt: row.created_at,
            readAt,
            href,
          },
        ];
      }
    } catch {
      // A corrupt legacy row must not make the notifications workspace unusable.
    }
    return [];
  });
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS totalCount, COALESCE(SUM(read_at IS NULL), 0) AS unreadCount FROM notifications WHERE ${where}`,
    )
    .get(...bindings) as { totalCount: number; unreadCount: number };
  const { totalCount, unreadCount } = counts;
  const snoozedUntil = z
    .string()
    .datetime()
    .nullable()
    .catch(null)
    .parse(
      (
        db
          .prepare("SELECT value FROM workspace_settings WHERE key = 'notifications-snoozed-until'")
          .get() as { value?: string } | undefined
      )?.value ?? null,
    );
  const refresh = Object.fromEntries(
    (['mail', 'shuiyuan'] as const).map((source) => {
      const key = accountFor(source);
      if (!key) return [source, null];
      const row = db
        .prepare(
          'SELECT last_success_at, error FROM notification_refreshes WHERE source = ? AND account_key = ?',
        )
        .get(source, key) as { last_success_at: string | null; error: string | null } | undefined;
      return [
        source,
        row
          ? { lastSuccessAt: row.last_success_at, error: row.error }
          : { lastSuccessAt: null, error: null },
      ];
    }),
  ) as NotificationState['refresh'];
  const todos = filter === 'all' || filter === 'todo' ? todoNotifications() : [];
  const todoState = getTodoState();
  refresh.todo = { lastSuccessAt: todoState.syncedAt, error: todoState.error };
  return {
    items: [...items, ...todos]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200),
    totalCount: totalCount + todos.length,
    unreadCount: unreadCount + todos.filter((item) => !item.readAt).length,
    snoozedUntil,
    refresh,
  };
}

function broadcast(): NotificationState {
  const state = notificationState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && isWorkspaceWindow(window.webContents.getURL()))
      window.webContents.send('notifications:state', state);
  }
  return state;
}

function isWorkspaceWindow(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html')) ||
      url.origin === 'http://127.0.0.1:5173'
    );
  } catch {
    return false;
  }
}

function saveRefresh(source: NotificationSource, key: string, error: string | null): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO notification_refreshes (source, account_key, last_success_at, error) VALUES (?, ?, ?, ?)
       ON CONFLICT(source, account_key) DO UPDATE SET
         last_success_at = CASE WHEN excluded.error IS NULL THEN excluded.last_success_at ELSE notification_refreshes.last_success_at END,
         error = excluded.error`,
    )
    .run(source, key, error === null ? now : null, error);
}

function upsert(
  source: NotificationSource,
  accountKey: string,
  id: string,
  title: string,
  body: string,
  createdAt: string,
  href: NotificationItem['href'],
): void {
  getDatabase()
    .prepare(
      `INSERT INTO notifications (id, source, account_key, title, body, created_at, read_at, source_unread, href)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, created_at = excluded.created_at,
         source_unread = 1, href = excluded.href`,
    )
    .run(id, source, accountKey, title, body, createdAt, JSON.stringify(href));
}

function refreshMail(recordSuccess = true): void {
  const key = accountFor('mail');
  if (!key) return;
  const db = getDatabase();
  const unread = db
    .prepare(
      `SELECT m.id, m.subject, m.sender_name, m.sender_address, m.snippet, m.date
       FROM mail_messages m JOIN mail_folders f ON f.id = m.folder_id
       JOIN mail_accounts a ON a.id = f.account_id
       WHERE a.address = ? AND f.special_use = '\\Inbox' AND m.deleted_at IS NULL AND m.seen = 0`,
    )
    .all(key) as Array<{
    id: number;
    subject: string | null;
    sender_name: string | null;
    sender_address: string | null;
    snippet: string | null;
    date: string | null;
  }>;
  for (const message of unread) {
    const sender = message.sender_name || message.sender_address || '新邮件';
    upsert(
      'mail',
      key,
      `mail:${key}:${message.id}`,
      message.subject || '无主题邮件',
      message.snippet || sender,
      message.date || new Date().toISOString(),
      { kind: 'mail', messageId: message.id },
    );
  }
  const sync = getMailState().sync;
  if (sync.phase === 'error') saveRefresh('mail', key, sync.error ?? '邮箱同步失败');
  else if (recordSuccess) saveRefresh('mail', key, null);
}

function shuiyuanTitle(item: ShuiyuanNotificationItem): string {
  if (item.fancyTitle) return item.fancyTitle;
  return item.displayUsername ? `${item.displayUsername} 有新的互动` : '水源有新的动态';
}

async function refreshShuiyuan(): Promise<void> {
  const key = accountFor('shuiyuan');
  if (!key) return;
  try {
    const remote = await listShuiyuanNotifications();
    if (accountFor('shuiyuan') !== key) return;
    for (const item of remote) {
      if (item.read || item.topicId === null) continue;
      upsert(
        'shuiyuan',
        key,
        `shuiyuan:${key}:${item.id}`,
        shuiyuanTitle(item),
        item.displayUsername ?? '',
        item.createdAt || new Date().toISOString(),
        { kind: 'shuiyuan', topicId: item.topicId, postNumber: item.postNumber },
      );
    }
    // `/notifications.json?recent=true` is a bounded page. Absence from it does not mean a
    // persisted notification was read, so source_unread/read_at are never changed here.
    saveRefresh('shuiyuan', key, null);
  } catch (error) {
    saveRefresh('shuiyuan', key, error instanceof Error ? error.message : String(error));
  }
}

export function initializeNotifications(): void {
  // Database initialization creates the schema. Existing unread mail is intentionally included as passive local inbox state.
  refreshMail(false);
  broadcast();
}

export function getNotificationState(filter?: unknown): NotificationState {
  return notificationState(filterSchema.catch('all').parse(filter ?? 'all'));
}

export function refreshNotifications(): Promise<NotificationState> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = (async () => {
    try {
      refreshMail();
    } catch (error) {
      const key = accountFor('mail');
      if (key) saveRefresh('mail', key, error instanceof Error ? error.message : String(error));
    }
    await refreshShuiyuan();
    return broadcast();
  })().finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}

export function markNotificationRead(idInput: unknown): NotificationState {
  const id = z.string().min(1).max(1000).parse(idInput);
  if (id.startsWith('todo:')) {
    markTodoRead(id.slice(5));
    return broadcast();
  }
  const accounts = currentAccounts();
  const clauses = accounts.map(() => '(source = ? AND account_key = ?)');
  if (clauses.length)
    getDatabase()
      .prepare(
        `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND (${clauses.join(' OR ')})`,
      )
      .run(
        new Date().toISOString(),
        id,
        ...accounts.flatMap((account) => [account.source, account.key]),
      );
  return broadcast();
}

export function markAllNotificationsRead(): NotificationState {
  markTodoRead();
  const accounts = currentAccounts();
  const clauses = accounts.map(() => '(source = ? AND account_key = ?)');
  if (clauses.length)
    getDatabase()
      .prepare(
        `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE ${clauses.join(' OR ')}`,
      )
      .run(
        new Date().toISOString(),
        ...accounts.flatMap((account) => [account.source, account.key]),
      );
  return broadcast();
}

export function setNotificationSnooze(untilInput: unknown): NotificationState {
  const until = snoozeSchema.parse(untilInput);
  const db = getDatabase();
  if (until === null)
    db.prepare("DELETE FROM workspace_settings WHERE key = 'notifications-snoozed-until'").run();
  else
    db.prepare(
      "INSERT OR REPLACE INTO workspace_settings VALUES ('notifications-snoozed-until', ?)",
    ).run(until);
  return broadcast();
}

export function registerNotificationsIpc(): void {
  ipcMain.handle('notifications:get-state', (event, filter) => {
    checkWorkspaceSender(event);
    return getNotificationState(filter);
  });
  ipcMain.handle('notifications:refresh', async (event) => {
    checkWorkspaceSender(event);
    return refreshNotifications();
  });
  ipcMain.handle('notifications:mark-read', (event, id) => {
    checkWorkspaceSender(event);
    return markNotificationRead(id);
  });
  ipcMain.handle('notifications:mark-all-read', (event) => {
    checkWorkspaceSender(event);
    return markAllNotificationsRead();
  });
  ipcMain.handle('notifications:set-snooze', (event, until) => {
    checkWorkspaceSender(event);
    return setNotificationSnooze(until);
  });
}
