import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { ModuleDefinition } from '../../module';

vi.mock('electron', () => ({}));

import { closeDatabase, getDatabase, openDatabase, SCHEMA_VERSION } from '../database';
import { modules } from '../../modules';
import { provideTestHostPorts } from '../../../core/test/host-mock';

let root = '';

function freshRoot(): string {
  root = mkdtempSync(join(tmpdir(), 'dela-db-'));
  provideTestHostPorts({ paths: { userData: () => root } });
  return root;
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
  rmSync(root, { recursive: true, force: true });
});

describe('current database format', () => {
  it('creates and reopens the current database without losing data', () => {
    freshRoot();
    const db = openDatabase([]);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.prepare('INSERT INTO workspace_settings VALUES (?, ?)').run('test', 'value');
    expect(
      openDatabase([]).prepare("SELECT value FROM workspace_settings WHERE key='test'").get(),
    ).toEqual({ value: 'value' });
  });

  it('rejects a database from a newer version without clearing its data', () => {
    freshRoot();
    const db = new Database(join(root, 'dela.db'));
    db.exec('CREATE TABLE sample (value TEXT)');
    db.exec("INSERT INTO sample VALUES ('keep')");
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => openDatabase([])).toThrow('数据库格式不受支持');
    const stored = new Database(join(root, 'dela.db'));
    expect(stored.prepare('SELECT value FROM sample').get()).toEqual({ value: 'keep' });
    stored.close();
  });
});

describe('module schemas', () => {
  const rename = vi.fn();
  const notes: ModuleDefinition = {
    id: 'notes',
    schema: {
      tables: ['CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)'],
      migrations: { '20261101-rename-body': rename },
    },
  };

  it('新出现的模块按当前结构建表，已有迁移只记账不执行', () => {
    freshRoot();
    openDatabase([notes]).prepare("INSERT INTO notes (text) VALUES ('a')").run();
    openDatabase([notes]);
    expect(rename).not.toHaveBeenCalled();
    expect(applied()).toContain('notes/20261101-rename-body');
  });

  it('已有模块按日期、同日按模块 id 补跑迁移，任何一步失败都整体撤回', () => {
    freshRoot();
    const order: string[] = [];
    const step = (name: string) => () => void order.push(name);
    openDatabase([
      { id: 'b', schema: { tables: [] } },
      { id: 'a', schema: { tables: [] } },
    ]);
    openDatabase([
      {
        id: 'b',
        schema: { tables: [], migrations: { '20261102-x': step('b2'), '20261101-y': step('b1') } },
      },
      { id: 'a', schema: { tables: [], migrations: { '20261102-z': step('a2') } } },
    ]);
    expect(order).toEqual(['b1', 'a2', 'b2']);

    expect(() =>
      openDatabase([
        {
          id: 'a',
          schema: {
            tables: [],
            migrations: {
              '20261102-z': step('a2'),
              '20261103-make': (db) => void db.exec('CREATE TABLE made (id INTEGER)'),
              '20261104-fail': () => {
                throw new Error('boom');
              },
            },
          },
        },
      ]),
    ).toThrow('boom');
    expect(
      openDatabase([]).prepare("SELECT name FROM sqlite_master WHERE name = 'made'").get(),
    ).toBeUndefined();
    expect(applied()).not.toContain('a/20261103-make');
  });

  it('不认识的迁移说明数据来自更新版本；清单里没有的模块不管', () => {
    freshRoot();
    openDatabase([notes, { id: 'gone', schema: { tables: [] } }]);
    expect(() =>
      openDatabase([{ ...notes, schema: { ...notes.schema!, migrations: {} } }]),
    ).toThrow('更新版本');
    expect(openDatabase([notes])).toBeTruthy();
  });

  it('清单里的模块都能建表，迁移名以日期开头', () => {
    freshRoot();
    expect(openDatabase(modules)).toBeTruthy();
    for (const module of modules)
      for (const name of Object.keys(module.schema?.migrations ?? {}))
        expect(name).toMatch(/^\d{8}-[a-z0-9-]+$/);
  });
});
