import { sendMailMessage } from './send';
import { BrowserWindow } from 'electron';
import { ImapFlow } from 'imapflow';
import type { ListResponse, MessageStructureObject } from 'imapflow';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type {
  MailAddress,
  MailConfigureInput,
  MailMessageDetail,
  MailMessageSummary,
  MailResult,
  MailServerConfig,
  MailSyncStatus,
  MailTrashItem,
  MailTrashRetention,
} from '../../shared/api';
import { SJTU_MAIL_SERVER } from '../../shared/mail';
import { getDatabase } from '../database';
import { clearMailCredentials, loadMailCredentials, saveMailCredentials } from '../credentials';
import { storedMailServer } from './server';

const SYNC_WINDOW = 300;
const BODY_PRELOAD = 30;
const BODY_MAX_BYTES = 2_000_000;
const SNIPPET_MAX_LENGTH = 220;

const SPECIAL_USE_LABELS: Record<string, string> = {
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

interface AccountRow {
  id: number;
  address: string;
  imap_host: string;
  imap_port: number;
  last_synced_at: string | null;
}

interface FolderRow {
  id: number;
  path: string;
  name: string;
  special_use: string | null;
  uid_validity: string | null;
}

interface MessageRow {
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

export let syncStatus: MailSyncStatus = {
  phase: 'idle',
  folderPath: null,
  processed: 0,
  total: null,
  error: null,
  startedAt: null,
  finishedAt: null,
};

let syncGeneration = 0;
let activeSync: Promise<void> | null = null;

// 邮件缓存变化（读信、删除、恢复、同步完成）会改变派生的通知状态；
// notifications/index.ts 注册监听后重播通知状态，回调在数据库事务提交后触发。
const mailCacheListeners = new Set<() => void>();

export function onMailCacheChanged(listener: () => void): void {
  mailCacheListeners.add(listener);
}

function emitMailCacheChanged(): void {
  for (const listener of mailCacheListeners) listener();
}

function pushSyncStatus(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mail:sync-status', syncStatus);
  }
}

function updateSync(patch: Partial<MailSyncStatus>): void {
  syncStatus = { ...syncStatus, ...patch };
  pushSyncStatus();
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

function connectImap(
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

async function drainStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function makeSnippet(text: string): string | null {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > SNIPPET_MAX_LENGTH
    ? `${collapsed.slice(0, SNIPPET_MAX_LENGTH)}…`
    : collapsed || null;
}

interface TextPart {
  part: string;
  type: string;
}

export function pickTextPart(node: MessageStructureObject | undefined): TextPart | null {
  if (!node) return null;
  const stack = [node];
  let plain: TextPart | null = null;
  let html: TextPart | null = null;
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (current.disposition === 'attachment' || current.type === 'message/rfc822') continue;
    if (current.type === 'text/plain' && !plain) {
      plain = { part: current.part ?? '1', type: current.type };
    } else if (current.type === 'text/html' && !html) {
      html = { part: current.part ?? '1', type: current.type };
    }
    for (const child of current.childNodes ?? []) stack.push(child);
  }
  return html ?? plain;
}

export async function downloadHtmlImages(
  client: ImapFlow,
  uid: number,
  structure: MessageStructureObject | undefined,
  html: string,
): Promise<string> {
  const stack = structure ? [structure] : [];
  // Inline images share the existing body byte budget; oversized images stay as placeholders.
  let remaining = BODY_MAX_BYTES;
  while (stack.length) {
    const node = stack.shift()!;
    if (node.type === 'message/rfc822' || node.disposition === 'attachment') continue;
    stack.push(...(node.childNodes ?? []));
    const cid = node.id?.replace(/^<|>$/g, '');
    if (
      !cid ||
      !node.part ||
      !/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(node.type) ||
      !html.includes('cid:')
    )
      continue;
    if (remaining <= 0 || (node.size ?? 0) > remaining) continue;
    const pattern = /cid:([^\s"'<>)]+)/gi;
    const matches = (value: string) => {
      try {
        return decodeURIComponent(value) === cid;
      } catch {
        return value === cid;
      }
    };
    if (![...html.matchAll(pattern)].some((match) => matches(match[1]!))) continue;
    try {
      const download = await client.download(uid, node.part, {
        uid: true,
        maxBytes: remaining + 1,
      });
      const data = await drainStream(download.content);
      if (data.length > remaining) {
        remaining = 0;
        continue;
      }
      remaining -= data.length;
      const url = `data:${node.type};base64,${data.toString('base64')}`;
      html = html.replace(pattern, (full, value: string) => (matches(value) ? url : full));
    } catch {
      // A missing inline image must not prevent reading the message.
    }
  }
  return html;
}

interface AttachmentItem {
  filename: string;
  size: number | null;
  part: string | null;
}

/** 下载正文 part 并内联 CID 图片；返回纯文本与（HTML 邮件时的）原始 HTML。 */
async function downloadMessageBody(
  client: ImapFlow,
  uid: number,
  textPart: TextPart,
  structure: MessageStructureObject | undefined,
): Promise<{ text: string; html: string | null }> {
  const download = await client.download(uid, textPart.part, {
    uid: true,
    maxBytes: BODY_MAX_BYTES,
  });
  let content = (await drainStream(download.content)).toString('utf8');
  if (textPart.type !== 'text/html') return { text: content, html: null };
  content = await downloadHtmlImages(client, uid, structure, content);
  return { text: stripHtml(content), html: content };
}

function collectAttachments(node: MessageStructureObject | undefined): AttachmentItem[] {
  const result: AttachmentItem[] = [];
  if (!node) return result;
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (current.disposition === 'attachment' || current.type === 'message/rfc822') {
      const filename =
        current.dispositionParameters?.filename ??
        current.parameters?.name ??
        (current.type === 'message/rfc822' ? '附件邮件.eml' : null);
      if (filename) {
        result.push({ filename, size: current.size ?? null, part: current.part ?? null });
      }
    }
    for (const child of current.childNodes ?? []) stack.push(child);
  }
  return result;
}

function toIso(value: Date | string | undefined | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function addressJson(addresses: MailAddress[] | undefined): string | null {
  if (!addresses || addresses.length === 0) return null;
  return JSON.stringify(addresses.filter((a) => a.name || a.address));
}

function parseAddresses(json: string | null): MailAddress[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is MailAddress => typeof item === 'object' && item !== null && 'address' in item,
    );
  } catch {
    return [];
  }
}

function parseAttachments(json: string | null): MailMessageDetail['attachments'] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const record = item as { filename?: unknown; size?: unknown; part?: unknown };
      if (typeof record.filename !== 'string') return [];
      return [
        {
          filename: record.filename,
          size: typeof record.size === 'number' ? record.size : null,
          part: typeof record.part === 'string' ? record.part : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

function getAccountRow(): AccountRow | null {
  return (
    (getDatabase()
      .prepare(
        'SELECT id, address, imap_host, imap_port, last_synced_at FROM mail_accounts ORDER BY id LIMIT 1',
      )
      .get() as AccountRow | undefined) ?? null
  );
}

function readMailSetting(key: string): string | undefined {
  const row = getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

function writeMailSetting(key: string, value: string): void {
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

function applyTrashRetention(db: ReturnType<typeof getDatabase>): void {
  const retention = getMailTrashRetention();
  if (retention === 0) return;
  const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM mail_messages WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(
    cutoff,
  );
}

// 本地删除只改缓存：置 deleted_at 的行从列表/未读数中排除，但保留正文供回收站查看与恢复。
function toSummary(row: MessageRow): MailMessageSummary {
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
function specialUseRank(specialUse: string | false | null | undefined): number {
  return specialUse ? (SPECIAL_USE_ORDER[specialUse] ?? 90) : 90;
}

function orderFolders(folders: ListResponse[]): ListResponse[] {
  return [...folders].sort((a, b) => {
    const rankA = specialUseRank(a.specialUse);
    const rankB = specialUseRank(b.specialUse);
    if (rankA !== rankB) return rankA - rankB;
    return a.path.localeCompare(b.path);
  });
}

async function syncFolder(
  db: ReturnType<typeof getDatabase>,
  client: ImapFlow,
  folder: FolderRow,
  generation: number,
): Promise<void> {
  const isStale = () => generation !== syncGeneration;
  const status = await client.status(folder.path, {
    messages: true,
    uidValidity: true,
    uidNext: true,
  });
  if (isStale()) return;
  const uidValidity = status.uidValidity !== undefined ? String(status.uidValidity) : null;
  if (folder.uid_validity && uidValidity && folder.uid_validity !== uidValidity) {
    db.prepare('DELETE FROM mail_messages WHERE folder_id = ?').run(folder.id);
  }
  // 未读数从本地表统计（排除本地已删除行），不盲信服务器计数。
  db.prepare(
    `UPDATE mail_folders SET uid_validity = ?, total = ?,
      unread = (SELECT COUNT(*) FROM mail_messages
        WHERE folder_id = mail_folders.id AND deleted_at IS NULL AND seen = 0),
      synced_at = ?
     WHERE id = ?`,
  ).run(uidValidity, status.messages ?? null, new Date().toISOString(), folder.id);
  if (!status.messages || status.messages === 0) return;

  const uidNext = status.uidNext !== undefined ? Number(status.uidNext) : 1;
  const highest = Math.max(1, uidNext - 1);
  const start = Math.max(1, highest - SYNC_WINDOW + 1);

  const lock = await client.getMailboxLock(folder.path);
  try {
    const headers = await client.fetchAll(
      { uid: `${start}:*` },
      {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
      },
      { uid: true },
    );
    updateSync({ folderPath: folder.path, processed: 0, total: headers.length });
    const upsert = db.prepare(
      `INSERT INTO mail_messages
        (folder_id, uid, message_id, subject, sender_name, sender_address, to_addresses, cc_addresses,
         date, seen, flagged, has_attachments, attachments, size)
       VALUES
        (@folderId, @uid, @messageId, @subject, @senderName, @senderAddress, @toAddresses, @ccAddresses,
         @date, @seen, @flagged, @hasAttachments, @attachments, @size)
       ON CONFLICT(folder_id, uid) DO UPDATE SET
        message_id = excluded.message_id,
        subject = excluded.subject,
        sender_name = excluded.sender_name,
        sender_address = excluded.sender_address,
        to_addresses = excluded.to_addresses,
        cc_addresses = excluded.cc_addresses,
        date = excluded.date,
        seen = excluded.seen,
        flagged = excluded.flagged,
        has_attachments = excluded.has_attachments,
        attachments = excluded.attachments,
        size = excluded.size`,
    );
    const textParts: Array<TextPart | null> = [];
    let processed = 0;
    for (const message of headers) {
      if (isStale()) return;
      const envelope = message.envelope;
      const from = envelope?.from?.[0];
      const textPart = pickTextPart(message.bodyStructure);
      const attachments = collectAttachments(message.bodyStructure);
      upsert.run({
        folderId: folder.id,
        uid: message.uid,
        messageId: envelope?.messageId ?? null,
        subject: envelope?.subject ?? null,
        senderName: from?.name ?? null,
        senderAddress: from?.address ?? null,
        toAddresses: addressJson(envelope?.to as MailAddress[] | undefined),
        ccAddresses: addressJson(envelope?.cc as MailAddress[] | undefined),
        date: toIso(message.internalDate ?? envelope?.date),
        seen: message.flags?.has('\\Seen') ? 1 : 0,
        flagged: message.flags?.has('\\Flagged') ? 1 : 0,
        hasAttachments: attachments.length > 0 ? 1 : 0,
        attachments: attachments.length > 0 ? JSON.stringify(attachments) : null,
        size: message.size ?? null,
      });
      textParts.push(textPart);
      processed += 1;
      if (processed % 25 === 0) updateSync({ processed });
    }
    db.prepare('DELETE FROM mail_messages WHERE folder_id = ? AND uid < ?').run(folder.id, start);
    db.prepare(
      `UPDATE mail_folders SET unread =
        (SELECT COUNT(*) FROM mail_messages
         WHERE folder_id = mail_folders.id AND deleted_at IS NULL AND seen = 0)
       WHERE id = ?`,
    ).run(folder.id);

    // 从最新一封开始预取正文，保证打开页面即可阅读。
    const updateBody = db.prepare(
      `UPDATE mail_messages
       SET body_text = ?, body_html = ?, body_version = 1, snippet = COALESCE(?, snippet)
       WHERE folder_id = ? AND uid = ?`,
    );
    for (
      let index = headers.length - 1;
      index >= Math.max(0, headers.length - BODY_PRELOAD);
      index -= 1
    ) {
      if (isStale()) return;
      const uid = headers[index]?.uid;
      const textPart = textParts[index];
      if (uid === undefined || !textPart) continue;
      try {
        const body = await downloadMessageBody(
          client,
          uid,
          textPart,
          headers[index]?.bodyStructure,
        );
        updateBody.run(body.text, body.html, makeSnippet(body.text), folder.id, uid);
      } catch {
        // 单封正文获取失败不阻塞同步；打开邮件时会再次尝试。
      }
    }
    updateSync({ processed });
  } finally {
    lock.release();
  }
}

// 服务器草稿箱一次性清理（用户已授权真删）：仅在键值不匹配当前账号时执行，
// 成功（含服务器无草稿文件夹）后写入账号地址；失败抛错且不写键，下次同步重试。
// 只允许触碰 specialUse 为 \Drafts 的文件夹，绝不影响其他文件夹。
async function purgeServerDrafts(client: ImapFlow, listed: ListResponse[], address: string) {
  if (readMailSetting('mail-drafts-purged') === address) return;
  const drafts = listed.find((folder) => folder.specialUse === '\\Drafts');
  if (drafts) {
    const status = await client.status(drafts.path, { messages: true });
    if (status.messages) {
      const lock = await client.getMailboxLock(drafts.path);
      try {
        // ImapFlow 的 messageDelete 先标记 \Deleted 再 EXPUNGE，一次调用完成真删。
        if (!(await client.messageDelete({ all: true }))) {
          throw new Error(`服务器拒绝清空草稿箱 ${drafts.path}`);
        }
      } finally {
        lock.release();
      }
    }
  }
  writeMailSetting('mail-drafts-purged', address);
}

async function runSync(account: AccountRow, password: string): Promise<void> {
  const generation = syncGeneration;
  const db = getDatabase();
  const isStale = () => generation !== syncGeneration;
  const client = connectImap(account.address, password);
  updateSync({
    phase: 'connecting',
    folderPath: null,
    processed: 0,
    total: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  try {
    await client.connect();
    updateSync({ phase: 'syncing' });
    const listed = await client.list();
    try {
      await purgeServerDrafts(client, listed, account.address);
    } catch {
      // 服务器草稿箱清理失败不写键（下次同步重试），也不中断其余文件夹同步。
    }
    // 草稿箱与已删除改为本地功能，服务器 \Drafts / \Trash 不再同步。
    const folders = orderFolders(
      listed.filter(
        (folder) =>
          !folder.flags.has('\\Noselect') &&
          folder.specialUse !== '\\Drafts' &&
          folder.specialUse !== '\\Trash',
      ),
    );
    const upsertFolder = db.prepare(
      `INSERT INTO mail_folders (account_id, path, name, special_use)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, path) DO UPDATE SET
        name = excluded.name,
        special_use = excluded.special_use`,
    );
    const keptPaths = new Set<string>();
    const folderRows: FolderRow[] = [];
    for (const folder of folders) {
      upsertFolder.run(account.id, folder.path, folder.name, folder.specialUse ?? null);
      keptPaths.add(folder.path);
      const row = db
        .prepare(
          'SELECT id, path, name, special_use, uid_validity FROM mail_folders WHERE account_id = ? AND path = ?',
        )
        .get(account.id, folder.path) as FolderRow | undefined;
      if (row) folderRows.push(row);
    }
    // 过滤后 keptPaths 可能为空（服务器只有草稿箱/已删除时），NOT IN () 不是合法 SQL。
    if (keptPaths.size > 0) {
      const placeholders = [...keptPaths].map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM mail_folders WHERE account_id = ? AND path NOT IN (${placeholders})`,
      ).run(account.id, ...keptPaths);
    } else {
      db.prepare('DELETE FROM mail_folders WHERE account_id = ?').run(account.id);
    }

    for (const folderRow of folderRows) {
      if (isStale()) return;
      await syncFolder(db, client, folderRow, generation);
    }
    if (isStale()) return;
    applyTrashRetention(db);
    db.prepare('UPDATE mail_accounts SET last_synced_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      account.id,
    );
    updateSync({
      phase: 'idle',
      folderPath: null,
      processed: 0,
      total: null,
      error: null,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    updateSync({
      phase: 'error',
      folderPath: null,
      error: friendlyError(error),
      finishedAt: new Date().toISOString(),
    });
  } finally {
    client.close();
    // 同步会改写 seen 标志（含他端已读），通知面板的派生已读需随之刷新。
    emitMailCacheChanged();
  }
}

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

export async function configureMailAccount(input: MailConfigureInput): Promise<MailResult> {
  const address = input.address.trim().toLowerCase();
  const password = input.password;
  if (!z.email().safeParse(address).success || password.length === 0) {
    return { ok: false, error: '请输入完整的邮箱地址和密码' };
  }
  // 不带 server 就是交大邮箱：只接受校内地址。第三方账号服务器自填，地址不限。
  const server = input.server ?? SJTU_MAIL_SERVER;
  if (!input.server && !address.endsWith('@sjtu.edu.cn')) {
    return { ok: false, error: '交大邮箱地址需以 @sjtu.edu.cn 结尾，或改选第三方 IMAP' };
  }
  const db = getDatabase();
  const client = connectImap(address, password, server);
  try {
    await client.connect();
  } catch (error) {
    client.close();
    return { ok: false, error: friendlyError(error) };
  }
  client.close();
  const existing = getAccountRow();
  if (existing && existing.address !== address) {
    syncGeneration += 1;
    db.prepare('DELETE FROM mail_accounts').run();
    clearMailCredentials();
  }
  if (existing && existing.address === address) {
    db.prepare(
      'UPDATE mail_accounts SET imap_host = ?, imap_port = ?, smtp_host = ?, smtp_port = ? WHERE id = ?',
    ).run(server.imapHost, server.imapPort, server.smtpHost, server.smtpPort, existing.id);
  } else {
    db.prepare(
      'INSERT INTO mail_accounts (address, imap_host, imap_port, smtp_host, smtp_port, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      address,
      server.imapHost,
      server.imapPort,
      server.smtpHost,
      server.smtpPort,
      new Date().toISOString(),
    );
  }
  try {
    saveMailCredentials({ address, password });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  return { ok: true };
}

export function disconnectMailAccount(): MailResult {
  syncGeneration += 1;
  const db = getDatabase();
  db.prepare('DELETE FROM mail_accounts').run();
  try {
    clearMailCredentials();
  } catch {
    // 凭据文件已不存在时忽略。
  }
  updateSync({
    phase: 'idle',
    folderPath: null,
    processed: 0,
    total: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  });
  return { ok: true };
}

export function startMailSync(): void {
  if (activeSync) return;
  const account = getAccountRow();
  if (!account) throw new Error('未配置邮箱账号');
  let credential;
  try {
    credential = loadMailCredentials();
    if (!credential) throw new Error('未找到邮箱凭据，请在设置中重新登录邮箱');
  } catch (cause) {
    updateSync({
      phase: 'error',
      error: friendlyError(cause),
      finishedAt: new Date().toISOString(),
    });
    return;
  }
  syncGeneration += 1;
  activeSync = runSync(account, credential.password).finally(() => {
    activeSync = null;
  });
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
