import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
import { closeDatabase, getDatabase, SCHEMA_VERSION } from '../database';

function freshRoot(): string {
  state.root = mkdtempSync(join(tmpdir(), 'dela-db-'));
  return state.root;
}

afterEach(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

describe('current database format', () => {
  it('creates and reopens the current database without losing data', () => {
    freshRoot();
    const db = getDatabase();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.prepare('INSERT INTO workspace_settings VALUES (?, ?)').run('test', 'value');
    closeDatabase();
    expect(
      getDatabase().prepare("SELECT value FROM workspace_settings WHERE key='test'").get(),
    ).toEqual({ value: 'value' });
  });

  it('rejects a database from a newer version without clearing its data', () => {
    const root = freshRoot();
    const db = new Database(join(root, 'dela.db'));
    db.exec('CREATE TABLE sample (value TEXT)');
    db.exec("INSERT INTO sample VALUES ('keep')");
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => getDatabase()).toThrow('数据库格式不受支持');
    const stored = new Database(join(root, 'dela.db'));
    expect(stored.prepare('SELECT value FROM sample').get()).toEqual({ value: 'keep' });
    stored.close();
  });
});
