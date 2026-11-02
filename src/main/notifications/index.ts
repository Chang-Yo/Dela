import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { notificationSources } from '../../shared/api';
import type {
  NotificationCategory,
  NotificationItem,
  NotificationSource,
  NotificationState,
  ShuiyuanNotificationItem,
} from '../../shared/api';
import { getTodoState, markTodoRead, todoNotifications } from '../todo';
import { getDatabase } from '../database';
import { loadShuiyuanCredential, type ShuiyuanCredential } from '../credentials';
import { checkWorkspaceSender } from '../ipc';
import { getMailState, markAllMailSeen, markMailSeen, onMailCacheChanged } from '../mail/api';
import { listShuiyuanNotifications } from '../shuiyuan/api';
import { experimentEnabled } from '../settings/prefs';
import { refreshJwc, getJwcNotice, getJwcCaptcha, downloadJwcAttachment } from './jwc';
import {
  armSystemNotifications,
  isWorkspaceWindow,
  systemNotifyItem,
  NOTIFICATIONS_SNOOZE_KEY,
} from './system';

const sourcesSchema = z.array(z.enum(notificationSources)).min(1);
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
  mail_seen: number | null;
  href: string;
  category: NotificationCategory | null;
  count: number;
}

function currentAccounts(): ActiveAccount[] {
  const db = getDatabase();
  const mail = db.prepare('SELECT address FROM mail_accounts ORDER BY id LIMIT 1').get() as
    { address: string } | undefined;
  const accounts: ActiveAccount[] = mail ? [{ source: 'mail', key: mail.address }] : [];
  accounts.push({ source: 'jwc', key: 'students' });
  // 水源关闭：不轮询、不展示已有通知，凭据保留。
  if (!experimentEnabled('shuiyuan')) return accounts;
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

function notificationState(
  sources: readonly NotificationSource[] = notificationSources,
): NotificationState {
  refreshMail(false);
  const db = getDatabase();
  const accounts = currentAccounts();
  const active = accounts.filter((account) => sources.includes(account.source));
  const clauses = active.map(() => '(n.source = ? AND n.account_key = ?)');
  const bindings = active.flatMap((account) => [account.source, account.key]);
  // 邮件通知的已读派生自邮件本身的 seen 标志（本地删除的邮件不显示通知）；
  // 水源通知继续使用通知行的 read_at。
  const mailJoin =
    "LEFT JOIN mail_messages m ON n.source = 'mail' AND m.id = json_extract(n.href, '$.messageId') AND m.deleted_at IS NULL";
  const where = clauses.length
    ? `(${clauses.join(' OR ')}) AND (n.source != 'mail' OR m.id IS NOT NULL)`
    : '0';
  const rows =
    clauses.length === 0
      ? []
      : (db
          .prepare(
            `SELECT n.id, n.source, n.title, n.body, n.created_at, n.read_at, n.href, n.category, n.count, m.seen AS mail_seen
             FROM notifications n ${mailJoin}
             WHERE ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT 200`,
          )
          .all(...bindings) as NotificationRow[]);
  const items = rows.flatMap((row): NotificationItem[] => {
    try {
      const href = JSON.parse(row.href) as NotificationItem['href'];
      const knownHref =
        (href.kind === 'jwc' && typeof href.url === 'string') ||
        (href.kind === 'mail' && typeof href.messageId === 'number') ||
        (href.kind === 'shuiyuan' && typeof href.topicId === 'number');
      if (!knownHref) return [];
      const readAt =
        row.source === 'mail'
          ? row.mail_seen === 1
            ? // readAt 只区分已读/未读；邮件本身不记录已读时刻，用通知行时间占位。
              (row.read_at ?? row.created_at)
            : null
          : row.read_at;
      return [
        {
          id: row.id,
          source: row.source,
          category: row.category,
          count: row.count,
          title: row.title,
          body: row.body,
          createdAt: row.created_at,
          readAt,
          href,
        },
      ];
    } catch {
      // A corrupt stored row must not make the notifications workspace unusable.
      return [];
    }
  });
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS totalCount, COALESCE(SUM(
         CASE WHEN n.source = 'mail' THEN m.seen = 0 ELSE n.read_at IS NULL END
       ), 0) AS unreadCount
       FROM notifications n ${mailJoin} WHERE ${where}`,
    )
    .get(...bindings) as { totalCount: number; unreadCount: number };
  const { totalCount, unreadCount } = counts;
  const snoozedUntil = snoozeSchema
    .catch(null)
    .parse(
      (
        db
          .prepare('SELECT value FROM workspace_settings WHERE key = ?')
          .get(NOTIFICATIONS_SNOOZE_KEY) as { value?: string } | undefined
      )?.value ?? null,
    );
  const refresh = Object.fromEntries(
    (['mail', 'shuiyuan', 'jwc'] as const).map((source) => {
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
  const todos = sources.includes('todo') ? todoNotifications() : [];
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
  category: NotificationCategory | null = null,
  count = 1,
): void {
  getDatabase()
    .prepare(
      `INSERT INTO notifications (id, source, account_key, title, body, created_at, read_at, source_unread, href, category, count)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, created_at = excluded.created_at,
         source_unread = 1, href = excluded.href, category = excluded.category, count = excluded.count,
         read_at = CASE WHEN excluded.count > notifications.count THEN NULL ELSE notifications.read_at END`,
    )
    .run(id, source, accountKey, title, body, createdAt, JSON.stringify(href), category, count);
}

function existingNotifications(source: NotificationSource, key: string): Map<string, number> {
  return new Map(
    (
      getDatabase()
        .prepare('SELECT id, count FROM notifications WHERE source = ? AND account_key = ?')
        .all(source, key) as { id: string; count: number }[]
    ).map((row) => [row.id, row.count]),
  );
}

function refreshMail(recordSuccess = true): void {
  // created_at 是账号注册时刻：早于它的存量未读只进通知列表，不弹系统通知。
  const account = getDatabase()
    .prepare('SELECT address, created_at FROM mail_accounts ORDER BY id LIMIT 1')
    .get() as { address: string; created_at: string } | undefined;
  if (!account) return;
  const key = account.address;
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
  const existing = existingNotifications('mail', key);
  for (const message of unread) {
    const sender = message.sender_name || message.sender_address || '新邮件';
    const id = `mail:${key}:${message.id}`;
    const title = message.subject || '无主题邮件';
    const body = message.snippet || sender;
    const createdAt = message.date || new Date().toISOString();
    const href: NotificationItem['href'] = { kind: 'mail', messageId: message.id };
    upsert('mail', key, id, title, body, createdAt, href);
    // 注册后到达的未读首次入库才弹系统通知；启动基线等其余守卫由 notifications/system.ts 判断。
    // date 缺失时无法证明晚于注册时刻，保守起见不弹（通知列表仍可见）。
    if (!existing.has(id) && (message.date ?? '') > account.created_at)
      systemNotifyItem({
        id,
        source: 'mail',
        category: null,
        count: 1,
        title,
        body,
        createdAt,
        readAt: null,
        href,
      });
  }
  const sync = getMailState().sync;
  if (sync.phase === 'error') saveRefresh('mail', key, sync.error ?? '邮箱同步失败');
  else if (recordSuccess) saveRefresh('mail', key, null);
}

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

function unreadLikeTopicIds(key: string): Set<number> {
  return new Set(
    (
      getDatabase()
        .prepare(
          `SELECT DISTINCT json_extract(href, '$.topicId') AS topicId FROM notifications
           WHERE source = 'shuiyuan' AND account_key = ? AND category = 'like' AND read_at IS NULL`,
        )
        .all(key) as { topicId: number }[]
    ).map((row) => row.topicId),
  );
}

function likeSummary(likes: NotificationItem[]): string {
  const total = likes.reduce((sum, like) => sum + like.count, 0);
  const names = [...new Set(likes.map((like) => like.body).filter(Boolean))].slice(0, 2);
  const shown = names.join('、');
  return names.length === total ? `${shown} 赞了你的帖子` : `${shown} 等 ${total} 人赞了你的帖子`;
}

async function refreshShuiyuan(): Promise<void> {
  if (!experimentEnabled('shuiyuan')) return;
  // boundAt 是账号绑定时刻：早于它的存量未读只进通知列表，不弹系统通知。
  let credential: ShuiyuanCredential | null = null;
  try {
    credential = loadShuiyuanCredential();
  } catch {
    // 损坏凭据视同未绑定，与 currentAccounts 的容忍口径一致。
  }
  if (!credential) return;
  const key = credential.username;
  try {
    const remote = await listShuiyuanNotifications();
    if (accountFor('shuiyuan') !== key) return;
    const existing = existingNotifications('shuiyuan', key);
    const unreadLikeTopics = unreadLikeTopicIds(key);
    const likeBursts = new Map<number, NotificationItem[]>();
    for (const item of remote) {
      if (item.read || item.topicId === null) continue;
      const id = `shuiyuan:${key}:${item.id}`;
      const title = shuiyuanTitle(item);
      const createdAt = item.createdAt || new Date().toISOString();
      const body = item.displayUsername ?? '';
      const category = shuiyuanCategory(item.type);
      const href: NotificationItem['href'] = {
        kind: 'shuiyuan',
        topicId: item.topicId,
        postNumber: item.postNumber,
      };
      upsert('shuiyuan', key, id, title, body, createdAt, href, category, item.count);
      const previousCount = existing.get(id);
      // 新 id，或服务端原地合并使 count 增长（同一条重新变为未读）都算一次新到达。
      const arrived = previousCount === undefined || item.count > previousCount;
      // 绑定后发生的互动首次到达才弹系统通知；启动基线等其余守卫由 notifications/system.ts 判断。
      if (!arrived || item.createdAt <= credential.boundAt) continue;
      const notification: NotificationItem = {
        id,
        source: 'shuiyuan',
        category,
        count: item.count,
        title,
        body,
        createdAt,
        readAt: null,
        href,
      };
      if (category === 'like')
        likeBursts.set(item.topicId, [...(likeBursts.get(item.topicId) ?? []), notification]);
      else systemNotifyItem(notification);
    }
    for (const [topicId, likes] of likeBursts) {
      if (unreadLikeTopics.has(topicId)) continue;
      systemNotifyItem(likes[0]!, likeSummary(likes));
    }
    // `/notifications.json?recent=true` is a bounded page. Absence from it does not mean a
    // persisted notification was read, so read_at is never changed here.
    saveRefresh('shuiyuan', key, null);
  } catch (error) {
    saveRefresh('shuiyuan', key, error instanceof Error ? error.message : String(error));
  }
}

export function initializeNotifications(): void {
  // Database initialization creates the schema. Existing unread mail is intentionally included as passive local inbox state.
  refreshMail(false);
  broadcast();
  // 邮件已读派生自邮件缓存：读信、删除、恢复与同步完成都会改变通知状态，需立即重播。
  onMailCacheChanged(() => broadcast());
}

export function getNotificationState(input?: unknown): NotificationState {
  return notificationState(sourcesSchema.catch([...notificationSources]).parse(input));
}

export function refreshNotifications(force = false): Promise<NotificationState> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = (async () => {
    try {
      refreshMail();
    } catch (error) {
      const key = accountFor('mail');
      if (key) saveRefresh('mail', key, error instanceof Error ? error.message : String(error));
    }
    await Promise.all([refreshShuiyuan(), refreshJwc(force)]);
    // 首轮刷新构成启动基线；此后新增的通知才弹系统桌面通知。
    armSystemNotifications();
    return broadcast();
  })().finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}

// 只更新当前账号名下的通知行；id 为 null 时更新全部，与 todo/index.ts 的 markTodoRead 同一模式。
function markNotificationRowsRead(id: string | null): void {
  const accounts = currentAccounts();
  const clauses = accounts.map(() => '(source = ? AND account_key = ?)');
  if (clauses.length === 0) return;
  getDatabase()
    .prepare(
      `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE (? IS NULL OR id = ?) AND (${clauses.join(' OR ')})`,
    )
    .run(
      new Date().toISOString(),
      id,
      id,
      ...accounts.flatMap((account) => [account.source, account.key]),
    );
}

export async function markNotificationRead(idInput: unknown): Promise<NotificationState> {
  const id = z.string().min(1).max(1000).parse(idInput);
  if (id.startsWith('todo:')) {
    markTodoRead(id.slice(5));
    return broadcast();
  }
  // 邮件通知的已读以邮件本身为准：委托 markMailSeen 在服务器标记 \Seen 并更新本地缓存；
  // 失败时保留未读，经来源错误行提示。
  const row = getDatabase()
    .prepare('SELECT source, href FROM notifications WHERE id = ?')
    .get(id) as { source: string; href: string } | undefined;
  if (row?.source === 'mail') {
    let messageId: number | null = null;
    try {
      const href = JSON.parse(row.href) as { kind?: unknown; messageId?: unknown };
      if (href.kind === 'mail' && typeof href.messageId === 'number') messageId = href.messageId;
    } catch {
      // 损坏的 href 行走普通通知已读标记；对邮件行该写入不影响派生已读，仅作保底。
    }
    if (messageId !== null) {
      const result = await markMailSeen(messageId);
      if (!result.ok) {
        const key = accountFor('mail');
        if (key) saveRefresh('mail', key, result.error);
      }
      return broadcast();
    }
  }
  markNotificationRowsRead(id);
  return broadcast();
}

export async function markAllNotificationsRead(): Promise<NotificationState> {
  markTodoRead();
  markNotificationRowsRead(null);
  const result = await markAllMailSeen();
  if (!result.ok) {
    const key = accountFor('mail');
    if (key) saveRefresh('mail', key, result.error);
  }
  return broadcast();
}

export function setNotificationSnooze(untilInput: unknown): NotificationState {
  const until = snoozeSchema.parse(untilInput);
  const db = getDatabase();
  if (until === null)
    db.prepare('DELETE FROM workspace_settings WHERE key = ?').run(NOTIFICATIONS_SNOOZE_KEY);
  else
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
      NOTIFICATIONS_SNOOZE_KEY,
      until,
    );
  return broadcast();
}

export function registerNotificationsIpc(): void {
  ipcMain.handle('notifications:jwc-notice', (event, id) => {
    checkWorkspaceSender(event);
    return getJwcNotice(id);
  });
  ipcMain.handle('notifications:jwc-captcha', (event, id, attachmentId) => {
    checkWorkspaceSender(event);
    return getJwcCaptcha(id, attachmentId);
  });
  ipcMain.handle('notifications:jwc-download', (event, token, code) => {
    checkWorkspaceSender(event);
    return downloadJwcAttachment(token, code);
  });
  ipcMain.handle('notifications:get-state', (event, sources) => {
    checkWorkspaceSender(event);
    return getNotificationState(sources);
  });
  ipcMain.handle('notifications:refresh', async (event) => {
    checkWorkspaceSender(event);
    return refreshNotifications(true);
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
