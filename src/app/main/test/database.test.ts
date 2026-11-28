import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { ModuleDefinition } from '../../module';

vi.mock('electron', () => ({}));

import { closeDatabase, getDatabase, openDatabase, SCHEMA_VERSION } from '../database';
import { v17ToBaseline } from '../migrations/v17tobaseline';
import { modules } from '../../modules';
import { coreSchema } from '../../../core/data/schema';
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
    for (const schema of [coreSchema, ...modules.map((module) => module.schema)])
      for (const name of Object.keys(schema?.migrations ?? {}))
        expect(name).toMatch(/^\d{8}-[a-z0-9-]+$/);
  });

  it('3.0 的库补跑迁移：过时或易混淆的设置键改名，值不变', () => {
    freshRoot();
    const old = new Database(join(root, 'dela.db'));
    old.pragma('user_version = 17');
    v17ToBaseline(old);
    const insert = old.prepare('INSERT INTO workspace_settings VALUES (?, ?)');
    for (const key of [
      'directory',
      'storage-move',
      'campus-notifications',
      'pending-install',
      'email-draft:d1',
      'theme',
    ])
      insert.run(key, `value of ${key}`);
    old.close();

    const settings = Object.fromEntries(
      (
        openDatabase(modules).prepare('SELECT key, value FROM workspace_settings').all() as {
          key: string;
          value: string;
        }[]
      ).map((row) => [row.key, row.value]),
    );
    expect(settings).toEqual({
      'storage-directory': 'value of directory',
      'workspace-pending-move': 'value of storage-move',
      'notifications-message-alerts': 'value of campus-notifications',
      'update-pending-install': 'value of pending-install',
      'mail-prepared:d1': 'value of email-draft:d1',
      theme: 'value of theme',
    });
  });

  it('3.0 的库补跑迁移：通知来源不再写死，会话不再外键指向项目，原有数据保留', () => {
    freshRoot();
    const old = new Database(join(root, 'dela.db'));
    old.pragma('user_version = 17');
    v17ToBaseline(old);
    old.exec(`
      INSERT INTO workspace_entries (id, name, kind, updated_at) VALUES ('p1', '课题', 'project', 'now');
      INSERT INTO sessions (id, project_id, file, created_at, updated_at) VALUES ('s1', 'p1', 'f', 'now', 'now');
      INSERT INTO notifications (id, source, account_key, title, created_at, read_at, source_unread, href)
        VALUES ('n1', 'jwc', 'students', '历史通知', '2026-11-01', '2026-11-02', 0, '{}');
      INSERT INTO notification_refreshes (source, account_key, last_success_at, error)
        VALUES ('jwc', 'students', '2026-11-03', '旧刷新错误');
    `);
    old.close();

    const db = openDatabase(modules);
    expect(db.prepare("SELECT project_id FROM sessions WHERE id='s1'").pluck().get()).toBe('p1');
    const legacyNotice =
      "SELECT source, account_key, title, read_at, source_unread FROM notifications WHERE id='n1'";
    const previousNotice = {
      source: 'jwc',
      account_key: 'students',
      title: '历史通知',
      read_at: '2026-11-02',
      source_unread: 0,
    };
    expect(db.prepare(legacyNotice).get()).toEqual(previousNotice);
    expect(db.prepare('SELECT * FROM notification_refreshes').get()).toEqual({
      source: 'jwc',
      account_key: 'students',
      last_success_at: '2026-11-03',
      error: '旧刷新错误',
    });
    expect(db.pragma('foreign_key_list(sessions)')).toEqual([]);
    db.exec(`
      INSERT INTO notifications (id, source, account_key, title, created_at, href)
        VALUES ('n2', 'notice', 'subscription', '官网公告', 'now', '{}');
      INSERT INTO notification_refreshes (source, account_key) VALUES ('notice', 'subscription');
    `);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .pluck()
        .all(),
    ).toEqual(
      expect.arrayContaining([
        'idx_sessions_visibility',
        'idx_notifications_account_source_created',
      ]),
    );
    const reopened = openDatabase(modules);
    expect(reopened.prepare(legacyNotice).get()).toEqual(previousNotice);
    expect(reopened.prepare("SELECT source FROM notifications WHERE id='n2'").get()).toEqual({
      source: 'notice',
    });
  });
});
