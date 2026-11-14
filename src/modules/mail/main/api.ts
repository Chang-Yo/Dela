import { sendMailMessage } from './send';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type {
  MailMessageDetail,
  MailMessageSummary,
  MailResult,
  MailTrashItem,
} from '../../shared/api';
import { getDatabase } from '../database';
import { loadMailCredentials } from '../credentials';
import {
  downloadMessageBody,
  makeSnippet,
  parseAddresses,
  parseAttachments,
  pickTextPart,
} from './parse';
import {
  applyTrashRetention,
  connectImap,
  friendlyError,
  getAccountRow,
  SPECIAL_USE_LABELS,
  specialUseRank,
  toSummary,
  type FolderRow,
  type MessageRow,
} from './store';
import { emitMailCacheChanged, SYNC_WINDOW, syncStatus } from './sync';

// 邮件域入口：查询、读信、附件、已读、本地回收站与发送。同步与账号配置在 sync.ts，
// 解析在 parse.ts，共享底座在 store.ts；此处一并 re-export，调用方只认 mail/api。
export { downloadHtmlImages, pickTextPart } from './parse';
export { friendlyError, getMailTrashRetention, setMailTrashRetention } from './store';
export {
  configureMailAccount,
  disconnectMailAccount,
  onMailCacheChanged,
  startMailSync,
  syncStatus,
} from './sync';

function getMessageRow(
  db: ReturnType<typeof getDatabase>,
  id: number,
): (MessageRow & { folder_path: string }) | undefined {
  return db
    .prepare(
      `SELECT m.*, f.path AS folder_path FROM mail_messages m
       JOIN mail_folders f ON f.id = m.folder_id WHERE m.id = ?`,
    )
    .get(id) as (MessageRow & { folder_path: string }) | undefined;
}

async function fetchMissingBody(row: MessageRow, folderPath: string): Promise<void> {
  const account = getAccountRow();
  const credential = account ? loadMailCredentials() : null;
  if (!account || !credential) throw new Error('邮箱未配置');
  const client = connectImap(account.address, credential.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folderPath);
    try {
      const message = await client.fetchOne(
        String(row.uid),
        { uid: true, bodyStructure: true },
        { uid: true },
      );
      const textPart = message ? pickTextPart(message.bodyStructure) : null;
      if (!message || !textPart) throw new Error('邮件没有可显示的正文');
      const body = await downloadMessageBody(client, row.uid, textPart, message.bodyStructure);
      getDatabase()
        .prepare(
          `UPDATE mail_messages
           SET body_text = ?, body_html = ?, body_version = 1, snippet = COALESCE(?, snippet)
           WHERE id = ?`,
        )
        .run(body.text, body.html, makeSnippet(body.text), row.id);
      row.body_html = body.html;
      row.body_text = body.text;
    } finally {
      lock.release();
    }
  } finally {
    client.close();
  }
}

export const mailSearchSchema = z
  .object({
    query: z.string().max(500).default(''),
    from: z.string().max(320).optional(),
    folderId: z.number().int().positive().optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();

export function searchMail(input: unknown) {
  const args = mailSearchSchema.parse(input);
  const conditions = [
    'deleted_at IS NULL',
    "(instr(lower(coalesce(subject, '')), lower(?)) > 0 OR instr(lower(coalesce(snippet, '')), lower(?)) > 0)",
  ];
  const values: (string | number)[] = [args.query, args.query];
  if (args.from !== undefined) {
    conditions.push(
      "instr(lower(coalesce(sender_address, '') || ' ' || coalesce(sender_name, '')), lower(?)) > 0",
    );
    values.push(args.from);
  }
  if (args.folderId !== undefined) {
    conditions.push('folder_id = ?');
    values.push(args.folderId);
  }
  if (args.startAt !== undefined) {
    conditions.push('julianday(date) >= julianday(?)');
    values.push(args.startAt);
  }
  if (args.endAt !== undefined) {
    conditions.push('julianday(date) < julianday(?)');
    values.push(args.endAt);
  }
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, subject, sender_name AS senderName, sender_address AS senderAddress,
    date, snippet, folder_id AS folderId FROM mail_messages WHERE ${conditions.join(' AND ')}
    ORDER BY (date IS NULL), date DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...values, args.limit + 1, args.offset) as {
    id: number;
    subject: string | null;
    senderName: string | null;
    senderAddress: string | null;
    date: string | null;
    snippet: string | null;
    folderId: number;
  }[];
  const folders = db
    .prepare(
      `SELECT id, name, synced_at AS syncedAt FROM mail_folders
    ${args.folderId === undefined ? '' : 'WHERE id = ?'}`,
    )
    .all(...(args.folderId === undefined ? [] : [args.folderId]));
  return {
    items: rows
      .slice(0, args.limit)
      .map((row) => ({ ...row, ref: { type: 'mail' as const, id: row.id } })),
    nextOffset: rows.length > args.limit ? args.offset + args.limit : null,
    coverage: {
      scope: 'cached_subjects_and_snippets',
      uidWindowPerFolder: SYNC_WINDOW,
      completeMailbox: false,
      folders,
    },
  };
}

export function listMailMessages(folderId: unknown, limit: unknown = 100): MailMessageSummary[] {
  const parsedFolderId = z.number().int().positive().safeParse(folderId);
  const parsedLimit = z
    .number()
    .int()
    .positive()
    .max(500)
    .safeParse(limit ?? 100);
  if (!parsedFolderId.success || !parsedLimit.success) throw new Error('参数无效');
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM mail_messages WHERE folder_id = ? AND deleted_at IS NULL
       ORDER BY (date IS NULL), date DESC, uid DESC LIMIT ?`,
    )
    .all(parsedFolderId.data, parsedLimit.data) as MessageRow[];
  return rows.map(toSummary);
}

export async function readMailMessage(messageId: unknown): Promise<MailMessageDetail> {
  const parsed = z.number().int().positive().safeParse(messageId);
  if (!parsed.success) throw new Error('参数无效');
  const db = getDatabase();
  const row = getMessageRow(db, parsed.data);
  if (!row) throw new Error('邮件不存在');
  const mutableRow: MessageRow & { folder_path: string } = { ...row };
  if (mutableRow.body_text === null && mutableRow.body_html === null) {
    await fetchMissingBody(mutableRow, mutableRow.folder_path);
  } else if (mutableRow.body_version < 1) {
    try {
      await fetchMissingBody(mutableRow, mutableRow.folder_path);
    } catch {
      // Keep old cached mail readable offline; retry upgrading on the next open.
    }
  }
  return {
    ...toSummary(mutableRow),
    folderId: mutableRow.folder_id,
    to: parseAddresses(mutableRow.to_addresses),
    cc: parseAddresses(mutableRow.cc_addresses),
    bodyText: mutableRow.body_text,
    bodyHtml: mutableRow.body_html,
    attachments: parseAttachments(mutableRow.attachments),
  };
}

export function mailAttachment(messageId: unknown, part: unknown) {
  const parsedMessageId = z.number().int().positive().safeParse(messageId);
  const parsedPart = z
    .string()
    .regex(/^\d+(?:\.\d+)*$/)
    .safeParse(part);
  if (!parsedMessageId.success || !parsedPart.success) throw new Error('参数无效');
  const row = getMessageRow(getDatabase(), parsedMessageId.data);
  const attachment = row
    ? parseAttachments(row.attachments).find((item) => item.part === parsedPart.data)
    : null;
  if (!row || !attachment) throw new Error('附件不存在，请先同步邮件');
  return { row, attachment, part: parsedPart.data };
}

export async function saveMailAttachment(
  messageId: unknown,
  part: unknown,
  targetPath: string,
): Promise<void> {
  const { row, part: attachmentPart } = mailAttachment(messageId, part);
  const account = getAccountRow();
  const credential = account ? loadMailCredentials() : null;
  if (!account || !credential) throw new Error('邮箱未配置');
  const temporaryPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${randomUUID()}.download`,
  );
  const client = connectImap(account.address, credential.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(row.folder_path);
    try {
      const download = await client.download(row.uid, attachmentPart, { uid: true });
      await pipeline(download.content, createWriteStream(temporaryPath, { flags: 'wx' }));
      await rename(temporaryPath, targetPath);
    } finally {
      lock.release();
    }
  } finally {
    client.close();
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export function getMailState() {
  const db = getDatabase();
  const account = getAccountRow();
  let configured = false;
  let credentialError: string | null = null;
  if (account) {
    try {
      configured = loadMailCredentials() !== null;
    } catch (cause) {
      credentialError = friendlyError(cause);
    }
  }
  if (account) {
    // 读取路径顺带做本地清理：升级后不等下次同步，服务器草稿箱/已删除立即从侧栏消失。
    db.prepare(
      "DELETE FROM mail_folders WHERE account_id = ? AND special_use IN ('\\Drafts', '\\Trash')",
    ).run(account.id);
    applyTrashRetention(db);
  }
  return {
    account:
      account && configured
        ? { address: account.address, lastSyncedAt: account.last_synced_at }
        : null,
    sync: credentialError
      ? { ...syncStatus, phase: 'error' as const, error: credentialError }
      : syncStatus,
  };
}

export function listMailFolders() {
  const account = getAccountRow();
  if (!account) return [];
  const rows = getDatabase()
    .prepare(
      `SELECT id, path, name, special_use, uid_validity, total, unread, synced_at
       FROM mail_folders WHERE account_id = ?`,
    )
    .all(account.id) as Array<
    FolderRow & { total: number | null; unread: number | null; synced_at: string | null }
  >;
  return rows
    .map((row) => ({
      id: row.id,
      path: row.path,
      name: row.special_use ? (SPECIAL_USE_LABELS[row.special_use] ?? row.name) : row.name,
      specialUse: row.special_use,
      total: row.total,
      unread: row.unread,
      lastSyncedAt: row.synced_at,
    }))
    .sort((a, b) => {
      const rankA = specialUseRank(a.specialUse);
      const rankB = specialUseRank(b.specialUse);
      if (rankA !== rankB) return rankA - rankB;
      return a.path.localeCompare(b.path);
    });
}

export async function markMailSeen(messageId: unknown): Promise<MailResult> {
  const parsed = z.number().int().positive().safeParse(messageId);
  if (!parsed.success) return { ok: false, error: '参数无效' };
  const db = getDatabase();
  const row = getMessageRow(db, parsed.data);
  if (!row) return { ok: false, error: '邮件不存在' };
  // 已读直接返回；通知跳转与邮件视图打开都会触发标记，避免重复建立 IMAP 连接。
  if (row.seen === 1) return { ok: true };
  const account = getAccountRow();
  const credential = account ? loadMailCredentials() : null;
  if (!account || !credential) return { ok: false, error: '邮箱未配置' };
  const client = connectImap(account.address, credential.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(row.folder_path);
    try {
      await client.messageFlagsAdd({ uid: row.uid }, ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }
    client.close();
  } catch (error) {
    client.close();
    return { ok: false, error: friendlyError(error) };
  }
  db.transaction(() => {
    db.prepare('UPDATE mail_messages SET seen = 1 WHERE id = ?').run(row.id);
    db.prepare(
      `UPDATE mail_folders
       SET unread = CASE WHEN unread IS NULL THEN NULL ELSE MAX(unread - 1, 0) END
       WHERE id = ?`,
    ).run(row.folder_id);
  })();
  emitMailCacheChanged();
  return { ok: true };
}

/** 通知中心「全部已读」：收件箱全部未读（未本地删除）在服务器标记 \\Seen，一次连接完成。 */
export async function markAllMailSeen(): Promise<MailResult> {
  const account = getAccountRow();
  const credential = account ? loadMailCredentials() : null;
  if (!account || !credential) return { ok: false, error: '邮箱未配置' };
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT m.id, m.uid, m.folder_id FROM mail_messages m
       JOIN mail_folders f ON f.id = m.folder_id
       WHERE f.account_id = ? AND f.special_use = '\\Inbox'
         AND m.deleted_at IS NULL AND m.seen = 0`,
    )
    .all(account.id) as { id: number; uid: number; folder_id: number }[];
  if (rows.length === 0) return { ok: true };
  const byFolder = new Map<number, { uids: number[]; ids: number[]; path: string }>();
  for (const row of rows) {
    let group = byFolder.get(row.folder_id);
    if (!group) {
      const folder = db.prepare('SELECT path FROM mail_folders WHERE id = ?').get(row.folder_id) as
        { path: string } | undefined;
      if (!folder) continue;
      group = { uids: [], ids: [], path: folder.path };
      byFolder.set(row.folder_id, group);
    }
    group.uids.push(row.uid);
    group.ids.push(row.id);
  }
  const client = connectImap(account.address, credential.password);
  try {
    await client.connect();
    for (const group of byFolder.values()) {
      const lock = await client.getMailboxLock(group.path);
      try {
        await client.messageFlagsAdd({ uid: group.uids.join(',') }, ['\\Seen'], { uid: true });
      } finally {
        lock.release();
      }
    }
    client.close();
  } catch (error) {
    client.close();
    return { ok: false, error: friendlyError(error) };
  }
  db.transaction(() => {
    for (const [folderId, group] of byFolder) {
      const placeholders = group.ids.map(() => '?').join(', ');
      db.prepare(`UPDATE mail_messages SET seen = 1 WHERE id IN (${placeholders})`).run(
        ...group.ids,
      );
      db.prepare(
        `UPDATE mail_folders SET unread =
          (SELECT COUNT(*) FROM mail_messages
           WHERE folder_id = mail_folders.id AND deleted_at IS NULL AND seen = 0)
         WHERE id = ?`,
      ).run(folderId);
    }
  })();
  emitMailCacheChanged();
  return { ok: true };
}

/** 本地删除：只把缓存行标记进回收站，绝不改动服务器。 */
export function deleteMailMessage(messageId: unknown): MailResult {
  const parsed = z.number().int().positive().safeParse(messageId);
  if (!parsed.success) return { ok: false, error: '参数无效' };
  const db = getDatabase();
  const row = db
    .prepare('SELECT id, folder_id, seen, deleted_at FROM mail_messages WHERE id = ?')
    .get(parsed.data) as
    { id: number; folder_id: number; seen: number; deleted_at: string | null } | undefined;
  if (!row || row.deleted_at !== null) return { ok: false, error: '邮件不存在' };
  db.transaction(() => {
    db.prepare('UPDATE mail_messages SET deleted_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      row.id,
    );
    if (row.seen === 0) {
      db.prepare(
        `UPDATE mail_folders
         SET unread = CASE WHEN unread IS NULL THEN NULL ELSE MAX(unread - 1, 0) END
         WHERE id = ?`,
      ).run(row.folder_id);
    }
  })();
  // 删除会让对应邮件通知从列表消失（派生查询按未删除过滤）。
  emitMailCacheChanged();
  return { ok: true };
}

export function restoreMailMessage(messageId: unknown): MailResult {
  const parsed = z.number().int().positive().safeParse(messageId);
  if (!parsed.success) return { ok: false, error: '参数无效' };
  const db = getDatabase();
  const row = db
    .prepare('SELECT id, folder_id, seen, deleted_at FROM mail_messages WHERE id = ?')
    .get(parsed.data) as
    { id: number; folder_id: number; seen: number; deleted_at: string | null } | undefined;
  if (!row) return { ok: false, error: '邮件不存在' };
  const folder = db.prepare('SELECT id FROM mail_folders WHERE id = ?').get(row.folder_id);
  if (!folder) return { ok: false, error: '原文件夹已不存在，无法恢复' };
  if (row.deleted_at === null) return { ok: true };
  db.transaction(() => {
    db.prepare('UPDATE mail_messages SET deleted_at = NULL WHERE id = ?').run(row.id);
    if (row.seen === 0) {
      db.prepare(
        `UPDATE mail_folders
         SET unread = CASE WHEN unread IS NULL THEN NULL ELSE unread + 1 END
         WHERE id = ?`,
      ).run(row.folder_id);
    }
  })();
  emitMailCacheChanged();
  return { ok: true };
}

export function purgeMailMessage(messageId: unknown): MailResult {
  const parsed = z.number().int().positive().safeParse(messageId);
  if (!parsed.success) return { ok: false, error: '参数无效' };
  const result = getDatabase().prepare('DELETE FROM mail_messages WHERE id = ?').run(parsed.data);
  if (result.changes === 0) return { ok: false, error: '邮件不存在' };
  return { ok: true };
}

export function emptyMailTrash(): MailResult {
  getDatabase().prepare('DELETE FROM mail_messages WHERE deleted_at IS NOT NULL').run();
  return { ok: true };
}

export function listMailTrash(): MailTrashItem[] {
  const rows = getDatabase()
    .prepare(
      `SELECT m.*, f.name AS folder_name FROM mail_messages m
       LEFT JOIN mail_folders f ON f.id = m.folder_id
       WHERE m.deleted_at IS NOT NULL
       ORDER BY m.deleted_at DESC`,
    )
    .all() as (MessageRow & { folder_name: string | null })[];
  return rows.map((row) => ({
    ...toSummary(row),
    folderName: row.folder_name,
    deletedAt: row.deleted_at!,
  }));
}

export async function sendMessage(input: unknown): Promise<MailResult> {
  let credential;
  try {
    credential = loadMailCredentials();
  } catch {
    return { ok: false, error: '邮箱凭据无法解密，请退出后重新登录' };
  }
  if (!credential) return { ok: false, error: '邮箱未配置' };
  const account = getAccountRow();
  let sentPath: string | null = null;
  if (account) {
    const sent = getDatabase()
      .prepare(
        "SELECT path FROM mail_folders WHERE account_id = ? AND special_use = '\\Sent' LIMIT 1",
      )
      .get(account.id) as { path: string } | undefined;
    sentPath = sent?.path ?? null;
  }
  return sendMailMessage(credential, input, async (message) => {
    const client = connectImap(credential.address, credential.password);
    try {
      await client.connect();
      const destination =
        sentPath ?? (await client.list()).find((folder) => folder.specialUse === '\\Sent')?.path;
      if (!destination) return '邮件已发送，但未找到“已发送”文件夹';
      await client.append(destination, message, ['\\Seen']);
      return null;
    } catch {
      return '邮件已发送，但未能保存到“已发送”文件夹';
    } finally {
      client.close();
    }
  });
}
