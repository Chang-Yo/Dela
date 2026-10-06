import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImapFlow, ListResponse, MessageStructureObject } from 'imapflow';
import {
  deleteMailMessage,
  downloadHtmlImages,
  emptyMailTrash,
  getMailState,
  getMailTrashRetention,
  listMailMessages,
  listMailTrash,
  markAllMailSeen,
  markMailSeen,
  onMailCacheChanged,
  pickTextPart,
  purgeMailMessage,
  restoreMailMessage,
  setMailTrashRetention,
  startMailSync,
  syncStatus,
} from '../api';
import { getDatabase } from '../../database';
import { loadMailCredentials } from '../../credentials';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {},
  shell: {},
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../credentials', () => ({
  clearMailCredentials: vi.fn(),
  loadMailCredentials: vi.fn(),
  saveMailCredentials: vi.fn(),
}));

// ImapFlow 桩：行为由 imapHarness 驱动，只覆盖 runSync 走到的路径。
const imapHarness = vi.hoisted(() => {
  type StatusResult = {
    messages: number;
    unseen?: number;
    uidValidity?: string;
    uidNext?: number;
  };
  return {
    folders: [] as ListResponse[],
    status: (_path: string): StatusResult => ({
      messages: 0,
      unseen: 0,
      uidValidity: '1',
      uidNext: 1,
    }),
    fetchAllResult: [] as unknown[],
    messageDeleteResult: true,
    deletions: [] as unknown[],
    lockedPaths: [] as string[],
    flagAdds: [] as Array<{ range: unknown; flags: string[] }>,
  };
});

vi.mock('imapflow', () => ({
  ImapFlow: class {
    on() {}
    async connect() {}
    close() {}
    async list() {
      return imapHarness.folders;
    }
    async status(path: string) {
      return imapHarness.status(path);
    }
    async getMailboxLock(path: string) {
      imapHarness.lockedPaths.push(path);
      return { release: () => {} };
    }
    async messageDelete(range: unknown) {
      imapHarness.deletions.push(range);
      return imapHarness.messageDeleteResult;
    }
    async messageFlagsAdd(range: unknown, flags: string[]) {
      imapHarness.flagAdds.push({ range, flags });
      return true;
    }
    async fetchAll() {
      return imapHarness.fetchAllResult;
    }
  },
}));

describe('mail MIME rendering', () => {
  it('prefers HTML alternatives and ignores attached messages', () => {
    const structure: MessageStructureObject = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'message/rfc822', childNodes: [{ type: 'text/html', part: '1.1' }] },
        {
          type: 'multipart/alternative',
          childNodes: [
            { type: 'text/plain', part: '2.1' },
            { type: 'text/html', part: '2.2' },
          ],
        },
      ],
    };
    expect(pickTextPart(structure)).toEqual({ type: 'text/html', part: '2.2' });
    expect(pickTextPart({ type: 'text/plain', part: '1' })).toEqual({
      type: 'text/plain',
      part: '1',
    });
    expect(pickTextPart(undefined)).toBeNull();
  });

  it('resolves encoded CID references once, without downloading unrelated attachments', async () => {
    const download = vi.fn(async () => ({ content: Readable.from([Buffer.from('image')]) }));
    const client = { download } as unknown as ImapFlow;
    const structure: MessageStructureObject = {
      type: 'multipart/related',
      childNodes: [
        { type: 'image/png', id: '<logo@example>', part: '2', size: 5 },
        { type: 'image/png', id: '<other>', part: '3', size: 5 },
        { type: 'image/png', id: '<attachment>', part: '4', size: 5, disposition: 'attachment' },
      ],
    };
    const output = await downloadHtmlImages(
      client,
      1,
      structure,
      '<img src="cid:logo%40example"><div style="background:url(cid:logo@example)"></div>',
    );
    expect(output.match(/data:image\/png;base64,aW1hZ2U=/g)).toHaveLength(2);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('keeps text readable when inline images fail or exceed the size limit', async () => {
    const download = vi.fn(async () => {
      throw new Error('offline');
    });
    const client = { download } as unknown as ImapFlow;
    const structure: MessageStructureObject = {
      type: 'multipart/related',
      childNodes: [
        { type: 'image/png', id: '<large>', part: '2', size: 3_000_000 },
        { type: 'image/png', id: '<missing>', part: '3', size: 5 },
      ],
    };
    const html = '<p>正文</p><img src="cid:large"><img src="cid:missing">';
    expect(await downloadHtmlImages(client, 1, structure, html)).toBe(html);
    expect(download).toHaveBeenCalledTimes(1);
  });
});

// ---- 本地回收站 / 同步跳过 / 服务器草稿箱清理 ----

function createMailDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE mail_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL UNIQUE,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_synced_at TEXT
    );
    CREATE TABLE mail_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      special_use TEXT,
      uid_validity TEXT,
      total INTEGER,
      unread INTEGER,
      synced_at TEXT,
      UNIQUE(account_id, path)
    );
    CREATE TABLE mail_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL REFERENCES mail_folders(id) ON DELETE CASCADE,
      uid INTEGER NOT NULL,
      message_id TEXT,
      subject TEXT,
      sender_name TEXT,
      sender_address TEXT,
      to_addresses TEXT,
      cc_addresses TEXT,
      date TEXT,
      seen INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      snippet TEXT,
      body_text TEXT,
      body_html TEXT,
      attachments TEXT,
      size INTEGER,
      fetched_at TEXT,
      body_version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      UNIQUE(folder_id, uid)
    );
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.prepare(
    'INSERT INTO mail_accounts (address, imap_host, imap_port, created_at) VALUES (?, ?, ?, ?)',
  ).run('reader@example.com', 'mail.sjtu.edu.cn', 993, '2026-09-13T00:00:00.000Z');
  return db;
}

function insertFolder(
  db: Database.Database,
  path: string,
  specialUse: string | null,
  unread: number | null = null,
): number {
  return Number(
    db
      .prepare(
        'INSERT INTO mail_folders (account_id, path, name, special_use, unread) VALUES (1, ?, ?, ?, ?)',
      )
      .run(path, path, specialUse, unread).lastInsertRowid,
  );
}

function insertMessage(
  db: Database.Database,
  folderId: number,
  uid: number,
  seen = 1,
  deletedAt: string | null = null,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO mail_messages (folder_id, uid, subject, sender_address, date, seen, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        folderId,
        uid,
        `Subject ${uid}`,
        'sender@example.com',
        '2026-09-12T00:00:00Z',
        seen,
        deletedAt,
      ).lastInsertRowid,
  );
}

const asFolder = (path: string, specialUse: string | null) =>
  ({ path, name: path, specialUse, flags: new Set<string>() }) as unknown as ListResponse;

const folderPaths = (db: Database.Database) =>
  (db.prepare('SELECT path FROM mail_folders ORDER BY path').all() as { path: string }[]).map(
    (row) => row.path,
  );

const setting = (db: Database.Database, key: string) =>
  (
    db.prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
      { value: string } | undefined
  )?.value;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

describe('mail local trash and folder sync', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createMailDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(loadMailCredentials).mockReturnValue({
      address: 'reader@example.com',
      password: 'pw',
    });
    imapHarness.folders = [];
    imapHarness.fetchAllResult = [];
    imapHarness.deletions = [];
    imapHarness.lockedPaths = [];
    imapHarness.messageDeleteResult = true;
    imapHarness.flagAdds = [];
    imapHarness.status = () => ({ messages: 0, unseen: 0, uidValidity: '1', uidNext: 1 });
  });

  const waitForSync = () =>
    vi.waitFor(() => {
      if (syncStatus.phase !== 'idle' && syncStatus.phase !== 'error') {
        throw new Error(`sync phase: ${syncStatus.phase}`);
      }
    });

  it('reports credential failure as sync state without throwing or losing cached mail', () => {
    const folderId = insertFolder(db, 'INBOX', '\\Inbox');
    insertMessage(db, folderId, 10);
    vi.mocked(loadMailCredentials).mockImplementationOnce(() => {
      throw new Error('凭据无法解密');
    });
    expect(() => startMailSync()).not.toThrow();
    expect(syncStatus).toMatchObject({ phase: 'error', error: '凭据无法解密' });
    expect(listMailMessages(folderId)).toHaveLength(1);
  });

  it('shows the configure entry when credentials have been cleared, keeping the cached account', () => {
    vi.mocked(loadMailCredentials).mockReturnValueOnce(null);
    expect(getMailState().account).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get()).toEqual({ n: 1 });
    expect(getMailState().account?.address).toBe('reader@example.com');
  });

  it('runSync purges server drafts once, skips \\Drafts/\\Trash, and cascades stale local rows', async () => {
    imapHarness.folders = [
      asFolder('INBOX', '\\Inbox'),
      asFolder('Drafts', '\\Drafts'),
      asFolder('Trash', '\\Trash'),
    ];
    imapHarness.status = (path) =>
      path === 'Drafts'
        ? { messages: 4 }
        : { messages: 0, unseen: 0, uidValidity: '1', uidNext: 1 };
    // 旧版本同步留下的服务器草稿箱本地缓存。
    const draftsFolderId = insertFolder(db, 'Drafts', '\\Drafts');
    insertMessage(db, draftsFolderId, 10);

    startMailSync();
    await waitForSync();
    expect(syncStatus.phase).toBe('idle');

    expect(imapHarness.deletions).toEqual([{ all: true }]);
    expect(imapHarness.lockedPaths).toEqual(['Drafts']);
    expect(setting(db, 'mail-drafts-purged')).toBe('reader@example.com');
    expect(folderPaths(db)).toEqual(['INBOX']);
    expect(
      db.prepare('SELECT COUNT(*) AS c FROM mail_messages WHERE folder_id = ?').get(draftsFolderId),
    ).toEqual({ c: 0 });

    // 第二次同步不再触碰服务器草稿箱。
    startMailSync();
    await waitForSync();
    expect(imapHarness.deletions).toHaveLength(1);
  });

  it('failed draft purge leaves the key unset so the next sync retries', async () => {
    imapHarness.folders = [asFolder('INBOX', '\\Inbox'), asFolder('Drafts', '\\Drafts')];
    imapHarness.status = (path) =>
      path === 'Drafts'
        ? { messages: 2 }
        : { messages: 0, unseen: 0, uidValidity: '1', uidNext: 1 };
    imapHarness.messageDeleteResult = false;

    startMailSync();
    await waitForSync();
    expect(syncStatus.phase).toBe('idle');
    expect(imapHarness.deletions).toHaveLength(1);
    expect(setting(db, 'mail-drafts-purged')).toBeUndefined();
    expect(folderPaths(db)).toEqual(['INBOX']);
  });

  it('marks the account purged even when the server has no drafts folder', async () => {
    imapHarness.folders = [asFolder('INBOX', '\\Inbox')];

    startMailSync();
    await waitForSync();
    expect(imapHarness.deletions).toHaveLength(0);
    expect(setting(db, 'mail-drafts-purged')).toBe('reader@example.com');
  });

  it('keeps deleted_at on re-synced messages and counts unread from the local table', async () => {
    imapHarness.folders = [asFolder('INBOX', '\\Inbox')];
    imapHarness.status = () => ({ messages: 2, unseen: 99, uidValidity: '1', uidNext: 3 });
    imapHarness.fetchAllResult = [
      {
        uid: 1,
        flags: new Set<string>(),
        envelope: {
          messageId: '<1@example.com>',
          subject: 'Subject 1',
          from: [{ name: '发件人', address: 'sender@example.com' }],
          to: [],
          cc: [],
        },
        internalDate: new Date('2026-09-12T00:00:00Z'),
        size: 100,
      },
      {
        uid: 2,
        flags: new Set<string>(),
        envelope: {
          messageId: '<2@example.com>',
          subject: 'Subject 2',
          from: [{ name: '发件人', address: 'sender@example.com' }],
          to: [],
          cc: [],
        },
        internalDate: new Date('2026-09-12T01:00:00Z'),
        size: 100,
      },
    ];
    const folderId = insertFolder(db, 'INBOX', '\\Inbox', 7);
    // 本地已删除（回收站中）但服务器仍存在的邮件。
    insertMessage(db, folderId, 1, 1, daysAgo(1));

    startMailSync();
    await waitForSync();

    const deletedRow = db
      .prepare('SELECT deleted_at, seen FROM mail_messages WHERE folder_id = ? AND uid = 1')
      .get(folderId) as { deleted_at: string; seen: number };
    expect(deletedRow.deleted_at).not.toBeNull();
    // 服务器报 99 未读；本地统计 = 未删除且未读的 uid2 一封。
    expect(db.prepare('SELECT unread FROM mail_folders WHERE id = ?').get(folderId)).toEqual({
      unread: 1,
    });
    expect(listMailMessages(folderId, 100).map((item) => item.uid)).toEqual([2]);
  });

  it('getMailState removes local \\Drafts/\\Trash rows without waiting for a sync', () => {
    const inboxId = insertFolder(db, 'INBOX', '\\Inbox');
    insertMessage(db, inboxId, 1);
    const draftsId = insertFolder(db, 'Drafts', '\\Drafts');
    insertMessage(db, draftsId, 1);
    const trashId = insertFolder(db, 'Trash', '\\Trash');
    insertMessage(db, trashId, 1);

    getMailState();
    expect(folderPaths(db)).toEqual(['INBOX']);
    expect(db.prepare('SELECT COUNT(*) AS c FROM mail_messages').get()).toEqual({ c: 1 });
  });

  it('delete/restore/purge lifecycle updates unread counts and the message list', () => {
    const folderId = insertFolder(db, 'INBOX', '\\Inbox', 2);
    const unreadId = insertMessage(db, folderId, 1, 0);
    const readId = insertMessage(db, folderId, 2, 1);

    expect(deleteMailMessage(unreadId)).toEqual({ ok: true });
    expect(db.prepare('SELECT unread FROM mail_folders WHERE id = ?').get(folderId)).toEqual({
      unread: 1,
    });
    // 重复删除视为不存在，不重复扣减未读数。
    expect(deleteMailMessage(unreadId)).toEqual({ ok: false, error: '邮件不存在' });
    expect(deleteMailMessage(readId)).toEqual({ ok: true });
    expect(listMailMessages(folderId, 100)).toEqual([]);

    db.prepare('UPDATE mail_messages SET deleted_at = ? WHERE id = ?').run(daysAgo(2), readId);
    const trash = listMailTrash();
    expect(trash.map((item) => item.uid)).toEqual([1, 2]);
    expect(trash.map((item) => item.folderName)).toEqual(['INBOX', 'INBOX']);
    expect(trash[0]!.deletedAt >= trash[1]!.deletedAt).toBe(true);

    expect(restoreMailMessage(unreadId)).toEqual({ ok: true });
    expect(db.prepare('SELECT unread FROM mail_folders WHERE id = ?').get(folderId)).toEqual({
      unread: 2,
    });
    expect(restoreMailMessage(unreadId)).toEqual({ ok: true });
    expect(db.prepare('SELECT unread FROM mail_folders WHERE id = ?').get(folderId)).toEqual({
      unread: 2,
    });
    expect(listMailMessages(folderId, 100).map((item) => item.uid)).toEqual([1]);

    expect(purgeMailMessage(readId)).toEqual({ ok: true });
    expect(purgeMailMessage(readId)).toEqual({ ok: false, error: '邮件不存在' });
    expect(deleteMailMessage(unreadId)).toEqual({ ok: true });
    expect(emptyMailTrash()).toEqual({ ok: true });
    expect(db.prepare('SELECT COUNT(*) AS c FROM mail_messages').get()).toEqual({ c: 0 });
  });

  it('markMailSeen flags the server once and returns early for already-seen mail', async () => {
    const folderId = insertFolder(db, 'INBOX', '\\Inbox', 1);
    const unreadId = insertMessage(db, folderId, 5, 0);
    const readId = insertMessage(db, folderId, 6, 1);

    expect(await markMailSeen(unreadId)).toEqual({ ok: true });
    expect(imapHarness.flagAdds).toEqual([{ range: { uid: 5 }, flags: ['\\Seen'] }]);
    expect(db.prepare('SELECT seen FROM mail_messages WHERE id = ?').get(unreadId)).toEqual({
      seen: 1,
    });
    expect(db.prepare('SELECT unread FROM mail_folders WHERE id = ?').get(folderId)).toEqual({
      unread: 0,
    });

    // 已读邮件（通知跳转与阅读器都会触发标记）直接返回，不再建立 IMAP 连接。
    imapHarness.flagAdds = [];
    expect(await markMailSeen(readId)).toEqual({ ok: true });
    expect(await markMailSeen(unreadId)).toEqual({ ok: true });
    expect(imapHarness.flagAdds).toHaveLength(0);
  });

  it('markAllMailSeen flags only inbox unread rows and notifies cache listeners', async () => {
    const inboxId = insertFolder(db, 'INBOX', '\\Inbox', 2);
    const archiveId = insertFolder(db, 'Archive', '\\Archive', 1);
    const unreadInbox = insertMessage(db, inboxId, 1, 0);
    insertMessage(db, inboxId, 2, 1);
    const deletedInbox = insertMessage(db, inboxId, 3, 0, daysAgo(1));
    const unreadArchive = insertMessage(db, archiveId, 1, 0);
    let cacheChanges = 0;
    onMailCacheChanged(() => {
      cacheChanges += 1;
    });

    expect(await markAllMailSeen()).toEqual({ ok: true });
    expect(imapHarness.flagAdds).toEqual([{ range: { uid: '1' }, flags: ['\\Seen'] }]);
    expect(imapHarness.lockedPaths).toEqual(['INBOX']);
    expect(db.prepare('SELECT seen FROM mail_messages WHERE id = ?').get(unreadInbox)).toEqual({
      seen: 1,
    });
    expect(db.prepare('SELECT seen FROM mail_messages WHERE id = ?').get(deletedInbox)).toEqual({
      seen: 0,
    });
    expect(db.prepare('SELECT seen FROM mail_messages WHERE id = ?').get(unreadArchive)).toEqual({
      seen: 0,
    });
    expect(db.prepare('SELECT unread FROM mail_folders WHERE id = ?').get(inboxId)).toEqual({
      unread: 0,
    });
    expect(db.prepare('SELECT unread FROM mail_folders WHERE id = ?').get(archiveId)).toEqual({
      unread: 1,
    });
    expect(cacheChanges).toBe(1);

    // 没有未读时不再触碰服务器。
    imapHarness.flagAdds = [];
    expect(await markAllMailSeen()).toEqual({ ok: true });
    expect(imapHarness.flagAdds).toHaveLength(0);
  });

  it('restore fails when the original folder row is gone', () => {
    const folderId = insertFolder(db, 'INBOX', '\\Inbox');
    const messageId = insertMessage(db, folderId, 1, 1, daysAgo(1));
    db.prepare('DELETE FROM mail_folders WHERE id = ?').run(folderId);
    expect(db.prepare('SELECT COUNT(*) AS c FROM mail_messages').get()).toEqual({ c: 0 });

    // 模拟孤儿缓存行（生产中外键级联通常先删掉消息；此处仅验证防御分支）。
    db.pragma('foreign_keys = OFF');
    const orphanId = insertMessage(db, 999, 7, 1, daysAgo(1));
    db.pragma('foreign_keys = ON');
    expect(restoreMailMessage(orphanId)).toEqual({
      ok: false,
      error: '原文件夹已不存在，无法恢复',
    });
    expect(messageId).toBeGreaterThan(0);
  });

  it('trash retention defaults to 30, validates values, and expires old entries', () => {
    expect(getMailTrashRetention()).toBe(30);
    expect(setMailTrashRetention(90)).toBe(90);
    expect(setting(db, 'mail-trash-retention')).toBe('90');
    expect(() => setMailTrashRetention(5)).toThrow('参数无效');

    const folderId = insertFolder(db, 'INBOX', '\\Inbox');
    insertMessage(db, folderId, 1, 1, daysAgo(8));
    insertMessage(db, folderId, 2, 1, daysAgo(1));
    setMailTrashRetention(7);
    getMailState();
    expect(db.prepare('SELECT uid FROM mail_messages ORDER BY uid').all()).toEqual([{ uid: 2 }]);

    // 0 表示永久保留。
    insertMessage(db, folderId, 3, 1, daysAgo(400));
    setMailTrashRetention(0);
    getMailState();
    expect(db.prepare('SELECT COUNT(*) AS c FROM mail_messages').get()).toEqual({ c: 2 });
  });
});
