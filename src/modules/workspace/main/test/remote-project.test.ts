// 远程项目的本地边界：远端路径绝不能落到本地文件系统上。
// 用假传输层覆盖登记去重、树上不做本地扫描，以及新建/重命名/打开对远程条目的拒绝。
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  root: '',
  db: null as Database.Database | null,
  locate: vi.fn(),
}));
vi.mock('electron', () => ({ app: { getPath: () => state.root }, shell: { openPath: vi.fn() } }));
vi.mock('../../../../core/remote/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../core/remote/operations')>()),
  locateRemote: state.locate,
}));

import { withinRemoteRoot, removeRemote, listRemotes } from '../../../remotes/main/api';
import {
  createWorkspaceEntry,
  entry,
  getWorkspaceState,
  importRemoteProject,
  projectDirectory,
  remoteProjectOf,
  removeWorkspaceEntry,
  updateWorkspaceEntry,
  workspaceProjects,
} from '../api';
import { provideTestHostPorts } from '../../../../core/test/host-mock';

const remoteId = '11111111-1111-4111-8111-111111111111';

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
      provider_id TEXT, model TEXT, effort TEXT, parent_id TEXT);
  `);
  db.prepare('INSERT INTO remotes VALUES (?, ?, ?, ?, ?, ?)').run(
    remoteId,
    'gpu-box',
    'root@10.0.0.5',
    null,
    null,
    new Date().toISOString(),
  );
  return db;
}

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-remote-'));
  state.db = createDb();
  provideTestHostPorts({ database: () => state.db!, projects: workspaceProjects });
  state.locate.mockReset();
  state.locate.mockResolvedValue({ path: '/root/proj', kind: 'directory', entries: [] });
  state
    .db!.prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('directory', ?)")
    .run(state.root);
});

describe('远端路径归属', () => {
  it('只有根目录之内才算项目内', () => {
    expect(withinRemoteRoot('/root/proj', '/root/proj')).toBe(true);
    expect(withinRemoteRoot('/root/proj', '/root/proj/src/a.ts')).toBe(true);
    // 同前缀的兄弟目录不算项目内。
    expect(withinRemoteRoot('/root/proj', '/root/proj2/a.ts')).toBe(false);
    expect(withinRemoteRoot('/root/proj', '/root')).toBe(false);
    // 根目录项目包含所有绝对路径。
    expect(withinRemoteRoot('/', '/etc/hosts')).toBe(true);
  });
});

describe('远程项目登记', () => {
  it('登记后是项目条目，路径为远端 POSIX 路径', async () => {
    const created = await importRemoteProject(remoteId, '/root/proj/');
    expect(created).toMatchObject({
      kind: 'project',
      name: 'proj',
      path: '/root/proj',
      remoteId,
    });
  });

  it('同一远端目录只登记一次', async () => {
    const first = await importRemoteProject(remoteId, '/root/proj');
    const again = await importRemoteProject(remoteId, '/root/proj');
    expect(again.id).toBe(first.id);
  });

  it('远端不是目录时拒绝登记', async () => {
    state.locate.mockResolvedValue({
      path: '/root/x',
      kind: 'file',
      entries: null,
      directory: false,
    });
    await expect(importRemoteProject(remoteId, '/root/x')).rejects.toThrow('远端目录不存在');
  });
});

describe('远程条目的本地入口', () => {
  it('projectDirectory 拒绝远程项目', async () => {
    const created = await importRemoteProject(remoteId, '/home/root/proj');
    expect(() => projectDirectory(created.id)).toThrow('远程项目没有本地目录');
  });

  it('远程路径形式的条目 id 不走本地 stat', async () => {
    await importRemoteProject(remoteId, '/root/proj');
    expect(() => entry('/root/proj/src/a.ts')).toThrow('远程条目请通过远程接口访问');
  });

  it('远程项目内不能新建文件或文件夹', async () => {
    const created = await importRemoteProject(remoteId, '/root/proj');
    expect(() =>
      createWorkspaceEntry({ parentId: created.id, name: '笔记', kind: 'file' }),
    ).toThrow('远程项目内暂不支持新建文件与文件夹');
  });

  it('远程项目只能改登记的名字，不能移动；登记时可以自定义名字', async () => {
    const named = await importRemoteProject(remoteId, '/root/proj', '实验 A');
    expect(named.name).toBe('实验 A');
    updateWorkspaceEntry(named.id, { name: '改名' });
    expect(entry(named.id).name).toBe('改名');
    expect(entry(named.id).path).toBe('/root/proj');
    const folder = createWorkspaceEntry({ name: '归类', kind: 'folder', parentId: null });
    expect(() => updateWorkspaceEntry(named.id, { parentId: folder.id })).toThrow(
      '远程项目不能移动',
    );
  });

  it('移除远程项目删除条目与会话，连接保留，重新导入得到新身份', async () => {
    const created = await importRemoteProject(remoteId, '/root/proj');
    state
      .db!.prepare(
        'INSERT INTO sessions (id, project_id, file, archived, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .run(crypto.randomUUID(), created.id, '', 'now', 'now');
    await removeWorkspaceEntry(created.id);
    expect(getWorkspaceState().entries.some((item) => item.id === created.id)).toBe(false);
    expect(state.db!.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    const reborn = await importRemoteProject(remoteId, '/root/proj');
    expect(reborn.id).not.toBe(created.id);
  });

  it('删除连接时名下项目与会话一并移除', async () => {
    const created = await importRemoteProject(remoteId, '/root/proj');
    state
      .db!.prepare(
        'INSERT INTO sessions (id, project_id, file, archived, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .run(crypto.randomUUID(), created.id, '', 'now', 'now');
    await removeRemote(remoteId);
    expect(listRemotes()).toEqual([]);
    expect(getWorkspaceState().entries.some((item) => item.id === created.id)).toBe(false);
    expect(state.db!.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });
});

describe('远端条目身份', () => {
  const secondRemoteId = '22222222-2222-4222-8222-222222222222';
  const nodePath = '/root/proj/src/a.ts';

  it('同路径的两台连接不会互相认领', async () => {
    state
      .db!.prepare('INSERT INTO remotes VALUES (?, ?, ?, ?, ?, ?)')
      .run(secondRemoteId, 'another', 'root@10.0.0.6', null, null, new Date().toISOString());
    const first = await importRemoteProject(remoteId, '/root/proj');
    const second = await importRemoteProject(secondRemoteId, '/root/proj');
    expect(second.id).not.toBe(first.id);
    // 条目 id 是「项目 id + 远端路径」：据此精确回到所属项目。
    expect(remoteProjectOf(`${first.id}:${nodePath}`)?.id).toBe(first.id);
    expect(remoteProjectOf(`${second.id}:${nodePath}`)?.id).toBe(second.id);
    // 裸远端路径同时落在两个项目里：不猜，直接说清。
    expect(() => remoteProjectOf(nodePath)).toThrow('同时属于多个项目');
  });
});

afterEach(() => rmSync(state.root, { force: true, recursive: true }));
