// 邮件同步：同步状态广播、按文件夹拉取最近窗口的头信息与预取正文、服务器草稿箱一次性清理，
// 以及账号配置/断开（二者都会使进行中的同步失效）。
import { BrowserWindow } from 'electron';
import type { ImapFlow, ListResponse } from 'imapflow';
import { z } from 'zod';
import type { MailAddress, MailConfigureInput, MailResult, MailSyncStatus } from '../../shared/api';
import { SJTU_MAIL_SERVER } from '../../shared/mail';
import { getDatabase } from '../database';
import { clearMailCredentials, loadMailCredentials, saveMailCredentials } from '../credentials';
import {
  addressJson,
  collectAttachments,
  downloadMessageBody,
  makeSnippet,
  pickTextPart,
  toIso,
  type TextPart,
} from './parse';
import {
  applyTrashRetention,
  connectImap,
  friendlyError,
  getAccountRow,
  orderFolders,
  readMailSetting,
  writeMailSetting,
  type AccountRow,
  type FolderRow,
} from './store';

export const SYNC_WINDOW = 300;
const BODY_PRELOAD = 30;

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

export function emitMailCacheChanged(): void {
  for (const listener of mailCacheListeners) listener();
}

function pushSyncStatus(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mail:sync-status', syncStatus);
  }
}

export function updateSync(patch: Partial<MailSyncStatus>): void {
  syncStatus = { ...syncStatus, ...patch };
  pushSyncStatus();
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
