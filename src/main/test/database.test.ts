// 破坏性重置：旧世界库（特征表 workspace_notes，user_version 为旧体系任意值）整库丢弃
// 并以当前 schema 重建；v1 库只重建会话表；全新目录直接建库；未来版本的库拒绝降级打开。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
import { closeDatabase, getDatabase } from '../database';

function freshRoot(): string {
  state.root = mkdtempSync(join(tmpdir(), 'dela-db-'));
  return state.root;
}

/** 直接在 userData 落一个旧世界库（v15 形态的最小切片：特征表 + 数据 + user_version）。 */
function plantLegacyDb(root: string, userVersion: number) {
  const db = new Database(join(root, 'dela.db'));
  db.exec('CREATE TABLE workspace_notes (id TEXT PRIMARY KEY, body TEXT)');
  db.exec("INSERT INTO workspace_notes VALUES ('n1', '旧笔记')");
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)');
  db.exec("INSERT INTO sessions VALUES ('s1', '旧会话')");
  db.pragma(`user_version = ${userVersion}`);
  db.close();
}

afterEach(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

describe('旧世界库重置', () => {
  it('v15 旧库被丢弃并备份，当前 schema 重建', () => {
    const root = freshRoot();
    plantLegacyDb(root, 15);
    const db = getDatabase();
    // 旧表与数据消失，备份文件落盘（内容来自丢弃前的旧库）。
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_notes'").get(),
    ).toBeUndefined();
    expect(() => db.prepare('SELECT * FROM workspace_notes').all()).toThrow();
    expect(existsSync(join(root, 'dela-legacy-backup.db'))).toBe(true);
    const backup = new Database(join(root, 'dela-legacy-backup.db'), { readonly: true });
    expect(backup.prepare('SELECT body FROM workspace_notes').get()).toMatchObject({
      body: '旧笔记',
    });
    backup.close();
    // 新 schema 可用：sessions 是 Pi 会话文件的索引，归档种子行存在。
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    expect(columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['file', 'archived', 'pinned', 'message_count']),
    );
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM workspace_entries WHERE name='归档'").get(),
    ).toMatchObject({ count: 1 });
  });

  it('user_version=0 且含特征表的半途库同样重置', () => {
    const root = freshRoot();
    plantLegacyDb(root, 0);
    const db = getDatabase();
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_notes'").get(),
    ).toBeUndefined();
    expect(existsSync(join(root, 'dela-legacy-backup.db'))).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
  });

  it('v3 库补 cwd 列，旧会话读回 cwd 为 NULL 且照常可用', () => {
    const root = freshRoot();
    const old = new Database(join(root, 'dela.db'));
    old.exec(`CREATE TABLE workspace_entries (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_id TEXT,
      local_path TEXT,
      remote_id TEXT,
      updated_at TEXT NOT NULL
    )`);
    old.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES workspace_entries(id) ON DELETE SET NULL,
      file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      message_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    old.exec(
      `INSERT INTO sessions (id, file, title, message_count, archived, pinned, created_at, updated_at)
       VALUES ('s-old', '', '旧对话', 3, 0, 0, 'x', 'x')`,
    );
    old.pragma('user_version = 3');
    old.close();
    const db = getDatabase();
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    expect(columns.map(({ name }) => name)).toContain('cwd');
    expect(
      db
        .prepare('SELECT id, project_id AS projectId, message_count AS count, cwd FROM sessions')
        .all(),
    ).toEqual([{ id: 's-old', projectId: null, count: 3, cwd: null }]);
  });

  it('版本号已是当前值但缺 remote_id 的库，打开时补列', () => {
    // 实测出现过这种半途库：user_version 已是当前值、remotes 表已建，但条目表没加列。
    // 只认版本号会让它永久缺列，之后所有条目查询都会报 no such column。
    const root = freshRoot();
    const old = new Database(join(root, 'dela.db'));
    old.exec(
      `CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
        kind TEXT NOT NULL, source_id TEXT, local_path TEXT, updated_at TEXT NOT NULL)`,
    );
    old.exec(
      "INSERT INTO workspace_entries VALUES ('p1', NULL, '课题', 'project', NULL, 'E:\\proj', 'x')",
    );
    old.pragma('user_version = 4');
    old.close();
    const db = getDatabase();
    const row = db
      .prepare('SELECT name, remote_id AS remoteId FROM workspace_entries WHERE id=?')
      .get('p1');
    expect(row).toEqual({ name: '课题', remoteId: null });
  });

  it('v1 库升级只重建会话表，领域缓存保留', () => {
    const root = freshRoot();
    const old = new Database(join(root, 'dela.db'));
    old.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, messages TEXT)');
    old.exec("INSERT INTO sessions VALUES ('s1', '[]')");
    old.exec(
      'CREATE TABLE todo_items (id TEXT PRIMARY KEY, owner TEXT, data TEXT, read_at TEXT, notice_at TEXT)',
    );
    old.exec("INSERT INTO todo_items VALUES ('t1', 'me', '{}', NULL, NULL)");
    old.pragma('user_version = 1');
    old.close();
    const db = getDatabase();
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toMatchObject({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM todo_items').get()).toMatchObject({
      count: 1,
    });
  });

  it('全新目录直接建库，不产生备份', () => {
    freshRoot();
    const db = getDatabase();
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    expect(existsSync(join(state.root, 'dela-legacy-backup.db'))).toBe(false);
  });

  it('未来版本的库（无特征表）拒绝打开', () => {
    const root = freshRoot();
    const db = new Database(join(root, 'dela.db'));
    db.pragma('user_version = 5');
    db.close();
    expect(() => getDatabase()).toThrow('更新版本');
  });
});
