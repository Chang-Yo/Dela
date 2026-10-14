// 邮件缓存与账号的共享底座：行类型、IMAP 连接、账号与设置读写、回收站保留期、
// 摘要投影与文件夹排序。同步（sync.ts）与查询/操作（api.ts）都从这里取。
import { ImapFlow } from 'imapflow';
import type { ListResponse } from 'imapflow';
import { z } from 'zod';
import type { MailMessageSummary, MailServerConfig, MailTrashRetention } from '../../shared/api';
import { getDatabase } from '../database';
import { storedMailServer } from './server';

export const SPECIAL_USE_LABELS: Record<string, string> = {
  '\\Inbox': '收件箱',
  '\\Flagged': '重要',
  '\\Drafts': '草稿箱',
  '\\Sent': '已发送',
  '\\Junk': '垃圾邮件',
  '\\Trash': '已删除',
  '\\Archive': '归档',
};

const SPECIAL_USE_ORDER: Record<string, number> = {
  '\\Inbox': 0,
  '\\Drafts': 1,
  '\\Sent': 2,
  '\\Junk': 3,
  '\\Trash': 4,
  '\\Archive': 5,
};

export interface AccountRow {
  id: number;
  address: string;
  imap_host: string;
  imap_port: number;
  last_synced_at: string | null;
}

export interface FolderRow {
  id: number;
  path: string;
  name: string;
  special_use: string | null;
  uid_validity: string | null;
}

export interface MessageRow {
  id: number;
  folder_id: number;
  uid: number;
  message_id: string | null;
  subject: string | null;
  sender_name: string | null;
  sender_address: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  date: string | null;
  seen: number;
  flagged: number;
  has_attachments: number;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  body_version: number;
  attachments: string | null;
  size: number | null;
  deleted_at: string | null;
}

export function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    if (/auth|login|password|credential|invalid/i.test(message)) {
      return '登录被拒绝：请检查邮箱地址与密码';
    }
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|certificate|TLS|SSL/i.test(message)) {
      return `无法连接邮件服务器：${message}`;
    }
    return message;
  }
  return String(error);
}

export function connectImap(
  address: string,
  password: string,
  server: MailServerConfig = storedMailServer(),
): ImapFlow {
  const client = new ImapFlow({
    host: server.imapHost,
    port: server.imapPort,
    secure: true,
    auth: { user: address, pass: password },
    logger: false,
  });
  client.on('error', () => {
    // 连接错误通过调用方 Promise 传递；此处仅避免未处理事件导致进程退出。
  });
  return client;
}

export function getAccountRow(): AccountRow | null {
  return (
    (getDatabase()
      .prepare(
        'SELECT id, address, imap_host, imap_port, last_synced_at FROM mail_accounts ORDER BY id LIMIT 1',
      )
      .get() as AccountRow | undefined) ?? null
  );
}

export function readMailSetting(key: string): string | undefined {
  const row = getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

export function writeMailSetting(key: string, value: string): void {
  getDatabase().prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(key, value);
}

const trashRetentionSchema = z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]);

export function getMailTrashRetention(): MailTrashRetention {
  return trashRetentionSchema.catch(30).parse(Number(readMailSetting('mail-trash-retention')));
}

export function setMailTrashRetention(retention: unknown): MailTrashRetention {
  const parsed = trashRetentionSchema.safeParse(retention);
  if (!parsed.success) throw new Error('参数无效');
  writeMailSetting('mail-trash-retention', String(parsed.data));
  return parsed.data;
}

export function applyTrashRetention(db: ReturnType<typeof getDatabase>): void {
  const retention = getMailTrashRetention();
  if (retention === 0) return;
  const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM mail_messages WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(
    cutoff,
  );
}

// 本地删除只改缓存：置 deleted_at 的行从列表/未读数中排除，但保留正文供回收站查看与恢复。
export function toSummary(row: MessageRow): MailMessageSummary {
  return {
    id: row.id,
    uid: row.uid,
    subject: row.subject,
    sender:
      row.sender_address || row.sender_name
        ? { name: row.sender_name, address: row.sender_address }
        : null,
    date: row.date,
    seen: row.seen === 1,
    flagged: row.flagged === 1,
    hasAttachments: row.has_attachments === 1,
    snippet: row.snippet,
    size: row.size,
  };
}

/** 特殊用途文件夹的排序档位；未知或普通文件夹固定 90。 */
export function specialUseRank(specialUse: string | false | null | undefined): number {
  return specialUse ? (SPECIAL_USE_ORDER[specialUse] ?? 90) : 90;
}

export function orderFolders(folders: ListResponse[]): ListResponse[] {
  return [...folders].sort((a, b) => {
    const rankA = specialUseRank(a.specialUse);
    const rankB = specialUseRank(b.specialUse);
    if (rankA !== rankB) return rankA - rankB;
    return a.path.localeCompare(b.path);
  });
}
