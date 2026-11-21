import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Schema } from '../../../core/ports';

const state = vi.hoisted(() => ({ root: '', schemas: [] as Schema[] }));
vi.mock('../../schemas', () => ({
  get schemas() {
    return state.schemas;
  },
}));
import { closeDatabase, getDatabase, SCHEMA_VERSION } from '../database';
import { provideTestHostPorts } from '../../../core/test/host-mock';

function freshRoot(): string {
  state.root = mkdtempSync(join(tmpdir(), 'dela-db-'));
  state.schemas = [];
  provideTestHostPorts({ paths: { userData: () => state.root } });
  return state.root;
}

function reopen() {
  closeDatabase();
  return getDatabase();
}

const applied = () =>
  (
    getDatabase().prepare('SELECT module, name FROM schema_migrations').all() as {
      module: string;
      name: string;
    }[]
  ).map((row) => `${row.module}/${row.name}`);

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

describe('module schemas', () => {
  const rename = vi.fn();
  const notes: Schema = {
    owner: 'notes',
    tables: ['CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)'],
    migrations: { '20261101-rename-body': rename },
  };

  it('新出现的模块按当前结构建表，已有迁移只记账不执行', () => {
    freshRoot();
    state.schemas = [notes];
    getDatabase().prepare("INSERT INTO notes (text) VALUES ('a')").run();
    reopen();
    expect(rename).not.toHaveBeenCalled();
    expect(applied()).toContain('notes/20261101-rename-body');
  });

  it('已有模块按日期、同日按模块 id 补跑迁移，任何一步失败都整体撤回', () => {
    freshRoot();
    const order: string[] = [];
    const step = (name: string) => () => void order.push(name);
    state.schemas = [
      { owner: 'b', tables: [] },
      { owner: 'a', tables: [] },
    ];
    getDatabase();
    state.schemas = [
      {
        owner: 'b',
        tables: [],
        migrations: { '20261102-x': step('b2'), '20261101-y': step('b1') },
      },
      { owner: 'a', tables: [], migrations: { '20261102-z': step('a2') } },
    ];
    reopen();
    expect(order).toEqual(['b1', 'a2', 'b2']);

    state.schemas = [
      {
        owner: 'a',
        tables: [],
        migrations: {
          '20261102-z': step('a2'),
          '20261103-make': (db) => void db.exec('CREATE TABLE made (id INTEGER)'),
          '20261104-fail': () => {
            throw new Error('boom');
          },
        },
      },
    ];
    expect(reopen).toThrow('boom');
    state.schemas = [];
    expect(
      getDatabase().prepare("SELECT name FROM sqlite_master WHERE name = 'made'").get(),
    ).toBeUndefined();
    expect(applied()).not.toContain('a/20261103-make');
  });

  it('不认识的迁移说明数据来自更新版本；清单里没有的模块不管', () => {
    freshRoot();
    state.schemas = [notes, { owner: 'gone', tables: [] }];
    getDatabase();
    state.schemas = [{ ...notes, migrations: {} }];
    expect(reopen).toThrow('更新版本');
    state.schemas = [notes];
    expect(reopen()).toBeTruthy();
  });
});
