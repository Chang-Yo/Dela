// 邮件作为通知来源：收件箱未读进通知中心，通知的已读与可见跟随邮件缓存（seen、本地删除）。
import {
  existingNotifications,
  publishNotificationState,
  registerNoticeSource,
  saveNotificationRefresh,
  systemNotifyItem,
  upsertNotification,
  type NoticeSource,
} from '../../notifications';
import { hostPorts } from '../../../core/ports';
import { getMailState, markAllMailSeen, markMailSeen, onMailCacheChanged } from './api';

function mailAccount() {
  return hostPorts()
    .database()
    .prepare('SELECT address, created_at FROM mail_accounts ORDER BY id LIMIT 1')
    .get() as { address: string; created_at: string } | undefined;
}

function syncMailNotices(recordSuccess: boolean): void {
  // created_at 是账号注册时刻：早于它的存量未读只进通知列表，不弹系统通知。
  const account = mailAccount();
  if (!account) return;
  const key = account.address;
  const db = hostPorts().database();
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
    const href = { messageId: message.id };
    upsertNotification(
      'mail',
      key,
      id,
      title,
      message.snippet || sender,
      message.date || new Date().toISOString(),
      href,
    );
    // date 缺失时无法证明晚于注册时刻，保守起见不弹（通知列表仍可见）。
    if (!existing.has(id) && (message.date ?? '') > account.created_at)
      systemNotifyItem({ id, source: 'mail', title, href });
  }
  // 本地删除的邮件不再显示通知；已读取自邮件本身，邮件不记录已读时刻，用通知时间占位。
  db.prepare(
    `DELETE FROM notifications WHERE source = 'mail' AND account_key = ? AND NOT EXISTS (
       SELECT 1 FROM mail_messages m WHERE m.id = json_extract(notifications.href, '$.messageId') AND m.deleted_at IS NULL)`,
  ).run(key);
  db.prepare(
    `UPDATE notifications SET read_at = CASE WHEN (
       SELECT m.seen FROM mail_messages m WHERE m.id = json_extract(notifications.href, '$.messageId')
     ) = 1 THEN COALESCE(read_at, created_at) ELSE NULL END
     WHERE source = 'mail' AND account_key = ?`,
  ).run(key);
  const sync = getMailState().sync;
  if (sync.phase === 'error') saveNotificationRefresh('mail', key, sync.error ?? '邮箱同步失败');
  else if (recordSuccess) saveNotificationRefresh('mail', key, null);
}

const mailNoticeSource: NoticeSource = {
  id: 'mail',
  account: () => mailAccount()?.address ?? null,
  refresh: async () => syncMailNotices(true),
  link: ({ messageId }) =>
    typeof messageId === 'number' ? { target: { page: 'mail', messageId } } : null,
  // 已读以邮件为准：在服务器标记 \Seen 并更新本地缓存，失败时保留未读。
  async markRead(id) {
    const result = await markMailSeen(Number(id.slice(id.lastIndexOf(':') + 1)));
    if (!result.ok) throw new Error(result.error);
  },
  async markAllRead() {
    const result = await markAllMailSeen();
    if (!result.ok) throw new Error(result.error);
  },
};

export function registerMailNotices(): void {
  registerNoticeSource(mailNoticeSource);
  syncMailNotices(false);
  // 读信、删除、恢复与同步完成都会改变通知的已读与可见，需立即重播。
  onMailCacheChanged(() => {
    syncMailNotices(false);
    publishNotificationState();
  });
}
