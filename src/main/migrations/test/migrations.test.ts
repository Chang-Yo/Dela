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

function v7Database() {
  const db = new Database(dbPath());
  db.exec(`CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare('INSERT INTO workspace_settings VALUES (?, ?)').run('existing', 'value');
  db.pragma('user_version = 7');
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

it('v7→v8：增加 Canvas 缓存使用记录和固定表，并保留已有设置', () => {
  v7Database();
  expect(runMigrations({ userData, seal }, 8)).toBe(1);

  const db = new Database(dbPath());
  expect(db.pragma('user_version', { simple: true })).toBe(8);
  expect(db.prepare('SELECT value FROM workspace_settings WHERE key=?').get('existing')).toEqual({
    value: 'value',
  });
  expect(db.prepare('SELECT COUNT(*) AS count FROM canvas_cache_usage').get()).toEqual({
    count: 0,
  });
  expect(db.prepare('SELECT COUNT(*) AS count FROM canvas_cache_pins').get()).toEqual({ count: 0 });
  db.close();
});
