import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runMigrations, UnsupportedDataVersionError } from '..';

// 明文「加密」：只验证迁移读写的内容，不依赖系统钥匙串。
const seal = {
  encrypt: (text: string) => Buffer.from(text),
  decrypt: (data: Buffer) => data.toString(),
};

let userData: string;
const dbPath = () => join(userData, 'dela.db');
const configPath = () => join(userData, 'llm-providers.bin');

function v6Database() {
  const db = new Database(dbPath());
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, cwd TEXT,
    file TEXT NOT NULL, title TEXT NOT NULL DEFAULT '新对话',
    message_count INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.prepare("INSERT INTO sessions (id, file, created_at, updated_at) VALUES (?, '', '', '')").run(
    's1',
  );
  db.pragma('user_version = 6');
  db.close();
}

const v6Config = {
  activeId: 'p2',
  providers: [
    { id: 'p1', name: 'A', baseUrl: 'https://a', apiKey: 'ka', models: ['a1'], model: 'a1' },
    {
      id: 'p2',
      name: 'B',
      baseUrl: 'https://b',
      apiKey: 'kb',
      models: ['b1', 'b2'],
      model: 'b2',
      modelConfigs: { b2: { effortLevels: ['low', 'high'], effort: 'high' } },
      presetId: null,
    },
  ],
};

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'dela-migrate-'));
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));

it('v6→v7：旧会话回填使用中的模型，配置去掉全局选择并全部启用', () => {
  v6Database();
  writeFileSync(configPath(), seal.encrypt(JSON.stringify(v6Config)));
  expect(runMigrations({ userData, seal }, 7)).toBe(1);

  const db = new Database(dbPath());
  expect(db.pragma('user_version', { simple: true })).toBe(7);
  expect(db.prepare('SELECT provider_id, model, effort FROM sessions').get()).toEqual({
    provider_id: 'p2',
    model: 'b2',
    effort: 'high',
  });
  db.close();
  const config = JSON.parse(readFileSync(configPath(), 'utf8'));
  expect(config).not.toHaveProperty('activeId');
  expect(
    config.providers.map((p: Record<string, unknown>) => [p.id, p.enabled, 'model' in p]),
  ).toEqual([
    ['p1', true, false],
    ['p2', true, false],
  ]);
  expect(config.providers[1].modelConfigs.b2.effort).toBe('high');
  expect(readdirSync(userData).filter((name) => name.endsWith('.migrating'))).toEqual([]);
});

it('配置解不开时只加列，会话留空等用户选择', () => {
  v6Database();
  writeFileSync(configPath(), 'garbage');
  runMigrations({ userData, seal: { ...seal, decrypt: () => '{' } }, 7);
  const db = new Database(dbPath());
  expect(db.prepare('SELECT provider_id, model FROM sessions').get()).toEqual({
    provider_id: null,
    model: null,
  });
  db.close();
  expect(readFileSync(configPath(), 'utf8')).toBe('garbage');
});

it('某一步失败时数据库与配置都还原到迁移前', () => {
  v6Database();
  writeFileSync(configPath(), seal.encrypt(JSON.stringify(v6Config)));
  const before = readFileSync(configPath());
  const failing = {
    ...seal,
    encrypt: () => {
      throw new Error('keychain locked');
    },
  };
  expect(() => runMigrations({ userData, seal: failing }, 7)).toThrow('keychain locked');
  const db = new Database(dbPath());
  expect(db.pragma('user_version', { simple: true })).toBe(6);
  expect(() => db.prepare('SELECT provider_id FROM sessions').get()).toThrow();
  db.close();
  expect(readFileSync(configPath())).toEqual(before);
});

it('新安装与当前版本不迁移；缺少中间步骤的旧版本明确拒绝', () => {
  expect(runMigrations({ userData, seal }, 7)).toBe(0);
  const db = new Database(dbPath());
  db.pragma('user_version = 5');
  db.close();
  expect(() => runMigrations({ userData, seal }, 7)).toThrow(UnsupportedDataVersionError);
  expect(existsSync(dbPath())).toBe(true);
});

it('v7→v8：保留原通知与已读状态，允许教务处与 Canvas 来源，水源引用补快照状态列', () => {
  const before = new Database(dbPath());
  before.exec(`CREATE TABLE IF NOT EXISTS shuiyuan_topics (
    topic_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    excerpt TEXT,
    category_name TEXT,
    author TEXT,
    posts_count INTEGER,
    added_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan')),
    account_key TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    read_at TEXT,
    source_unread INTEGER NOT NULL DEFAULT 1,
    href TEXT NOT NULL
  );
CREATE INDEX IF NOT EXISTS idx_notifications_account_source_created
    ON notifications (account_key, source, created_at DESC);
CREATE TABLE IF NOT EXISTS notification_refreshes (
    source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan')),
    account_key TEXT NOT NULL,
    last_success_at TEXT,
    error TEXT,
    PRIMARY KEY (source, account_key)
  );
    INSERT INTO notifications VALUES ('old', 'mail', 'student', '原通知', '', '2026-10-01', '2026-10-02', 1, '{}');
    INSERT INTO notification_refreshes VALUES ('mail', 'student', '2026-10-01', NULL);
    INSERT INTO shuiyuan_topics (topic_id, title, url, added_at) VALUES (1, '旧引用', 'u', '2026-10-01');`);
  before.pragma('user_version = 7');
  before.close();
  expect(runMigrations({ userData, seal }, 8)).toBe(1);
  const db = new Database(dbPath());
  expect(db.pragma('user_version', { simple: true })).toBe(8);
  expect(db.prepare('SELECT title, read_at, category, count FROM notifications').get()).toEqual({
    title: '原通知',
    read_at: '2026-10-02',
    category: null,
    count: 1,
  });
  expect(db.prepare('SELECT last_success_at FROM notification_refreshes').get()).toEqual({
    last_success_at: '2026-10-01',
  });
  db.prepare(
    "INSERT INTO notifications (id, source, account_key, title, body, created_at, read_at, source_unread, href) VALUES ('new', 'jwc', 'students', '新通知', '', '2026-11-01', NULL, 1, '{}')",
  ).run();
  db.prepare("INSERT INTO notification_refreshes VALUES ('jwc', 'students', NULL, NULL)").run();
  db.prepare(
    "INSERT INTO notifications (id, source, account_key, title, created_at, href) VALUES ('c', 'canvas', 'owner', '公告', '2026-11-01', '{}')",
  ).run();
  db.prepare("INSERT INTO notification_refreshes VALUES ('canvas', 'owner', NULL, NULL)").run();
  expect(
    db
      .prepare('SELECT title, snapshot_status, snapshot_at, snapshot_error FROM shuiyuan_topics')
      .get(),
  ).toEqual({ title: '旧引用', snapshot_status: null, snapshot_at: null, snapshot_error: null });
  expect(() =>
    db.prepare("UPDATE shuiyuan_topics SET snapshot_status = 'unknown'").run(),
  ).toThrow();
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v7'").all()).toEqual([]);
  db.close();
  expect(runMigrations({ userData, seal }, 8)).toBe(0);
  expect(readdirSync(userData).filter((name) => name.endsWith('.migrating'))).toEqual([]);
});

it('v8→v9：会话表补 parent_id，原有会话都是顶层会话', () => {
  v6Database();
  const before = new Database(dbPath());
  before.pragma('user_version = 8');
  before.close();
  expect(runMigrations({ userData, seal }, 9)).toBe(1);
  const db = new Database(dbPath());
  expect(db.pragma('user_version', { simple: true })).toBe(9);
  expect(db.prepare('SELECT id, parent_id FROM sessions').all()).toEqual([
    { id: 's1', parent_id: null },
  ]);
  db.close();
});
