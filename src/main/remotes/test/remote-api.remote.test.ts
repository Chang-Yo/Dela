// 远程项目主进程链路的真机回归（假数据库 + 真实 helper）：需要 DELA_REMOTE_HOST（如 root@1.2.3.4），
// 由 pnpm test:remote 运行，不在默认 pnpm test 与 CI 里。
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '', db: null as Database.Database | null }));
vi.mock('electron', () => ({
  app: { getPath: () => state.root, getAppPath: () => process.cwd(), isPackaged: false },
  shell: { openPath: vi.fn() },
}));
vi.mock('../../database', () => ({ getDatabase: () => state.db }));
vi.mock('../../canvas/api', () => ({ canvasFilePath: vi.fn(), readCanvasSource: vi.fn() }));
vi.mock('../../shuiyuan/api', () => ({ readShuiyuanSource: vi.fn() }));

import {
  browseRemote,
  listRemotes,
  prepareRemote,
  probeConnection,
  removeRemote,
  saveRemote,
} from '../api';
import { listRemoteDirectory, remoteFileIndex, writeRemoteFile } from '../operations';
import { importRemoteProject, projectLocation } from '../../workspace/api';
import { parentOf, targetOf } from '../api';

const host = process.env.DELA_REMOTE_HOST!;
const keyPath = process.env.DELA_REMOTE_KEY ?? null;
const testRoot = '/tmp/dela-api-test';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE workspace_entries (
      id TEXT PRIMARY KEY, parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT, local_path TEXT, remote_id TEXT,
      updated_at TEXT NOT NULL);
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE remotes (id TEXT PRIMARY KEY, label TEXT NOT NULL, host TEXT NOT NULL,
      port INTEGER, key_path TEXT, created_at TEXT NOT NULL);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES workspace_entries(id) ON DELETE SET NULL,
      file TEXT NOT NULL, title TEXT NOT NULL DEFAULT '新对话', message_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, cwd TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      provider_id TEXT, model TEXT, effort TEXT);
  `);
  return db;
}

beforeAll(async () => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-remote-api-'));
  state.db = createDb();
  // 自带夹具：不依赖别的套件或冒烟脚本先在远端建好目录。
  const target = targetOf({ host, keyPath });
  await writeRemoteFile(target, `${testRoot}/a b.txt`, Buffer.from('hello\n'));
  await writeRemoteFile(target, `${testRoot}/sub/nested.md`, Buffer.from('nested\n'));
}, 120_000);
afterAll(() => rmSync(state.root, { force: true, recursive: true }));

describe('远程项目主进程链路（真机）', () => {
  let connectionId = '';

  it('保存连接并自检', async () => {
    const saved = saveRemote({ label: '测试主机', host, keyPath });
    connectionId = saved.id;
    expect(listRemotes().map((item) => item.host)).toEqual([host]);

    const probe = await probeConnection({ host, keyPath });
    expect(probe.ok).toBe(true);
    // 摘要里带系统信息（`<主机名> · <系统> <架构>`）：探活失败时这里是给用户的原因。
    expect(probe.message).toMatch(/Linux|Darwin/);
  }, 60_000);

  it('连接时带回主目录，浏览从主目录起，能进能退', async () => {
    const prepared = await prepareRemote({ host, keyPath });
    expect(prepared.ok).toBe(true);
    expect(prepared.home).toMatch(/^\//);
    const home = await browseRemote({ host, keyPath }, prepared.home!);
    expect(home.path).toBe(prepared.home);
    expect(home.directories.every((entry) => entry.path.startsWith(home.path))).toBe(true);
    if (home.directories.length) {
      const child = await browseRemote({ host, keyPath }, home.directories[0]!.path);
      expect(parentOf(child.path)).toBe(home.path);
    }
  }, 180_000);

  it('浏览到不存在的目录给出可读错误', async () => {
    await expect(browseRemote({ host, keyPath }, '/no/such/dir-9f3')).rejects.toThrow(/不是目录/);
  }, 60_000);

  it('登记远端项目、列一层目录、生成 @ 候选索引', async () => {
    const project = await importRemoteProject(connectionId, testRoot, '接口测试');
    expect(project).toMatchObject({ kind: 'project', name: '接口测试', path: testRoot });
    expect(projectLocation(project.id)).toEqual({
      kind: 'remote',
      remoteId: connectionId,
      path: testRoot,
    });

    const entries = await listRemoteDirectory(targetOf({ host, keyPath }), testRoot);
    expect(entries.some((entry) => entry.name === 'sub' && entry.directory)).toBe(true);
    expect(entries.some((entry) => entry.name === 'a b.txt' && !entry.directory)).toBe(true);

    const files = await remoteFileIndex({ host, keyPath }, testRoot, 1000);
    expect(files).toContain('a b.txt');
    expect(files).toContain('sub/nested.md');
    // 索引给的是相对路径，渲染端再与项目根拼成候选 key。
    expect(files.every((file) => !file.startsWith('/'))).toBe(true);
  }, 90_000);

  it('同一目录重复登记返回同一个项目', async () => {
    const again = await importRemoteProject(connectionId, testRoot);
    expect(again.path).toBe(testRoot);
    const count = state
      .db!.prepare("SELECT count(*) AS n FROM workspace_entries WHERE kind='project'")
      .get();
    expect(count).toEqual({ n: 1 });
  }, 60_000);

  it('删除连接时名下项目一并移除', async () => {
    await removeRemote(connectionId);
    expect(listRemotes()).toEqual([]);
    expect(
      state.db!.prepare("SELECT count(*) AS n FROM workspace_entries WHERE kind='project'").get(),
    ).toEqual({ n: 0 });
  });
});
