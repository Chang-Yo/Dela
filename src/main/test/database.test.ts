// 破坏性重置：旧世界库（特征表 workspace_notes，user_version 为旧体系任意值）整库丢弃
// 并以 v1 重建；全新目录直接建库；未来版本的库拒绝降级打开。
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
  it('v15 旧库被丢弃并备份，v1 schema 重建', () => {
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
    // 新 schema 可用：sessions 含 archived/pinned，归档种子行存在。
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    expect(columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['archived', 'pinned', 'summary']),
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
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('全新目录直接建 v1 库，不产生备份', () => {
    freshRoot();
    const db = getDatabase();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(existsSync(join(state.root, 'dela-legacy-backup.db'))).toBe(false);
  });

  it('未来版本的库（无特征表）拒绝打开', () => {
    const root = freshRoot();
    const db = new Database(join(root, 'dela.db'));
    db.pragma('user_version = 2');
    db.close();
    expect(() => getDatabase()).toThrow('更新版本');
  });
});
