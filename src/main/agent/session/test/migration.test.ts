// v13 迁移（Session/Run 新身份，docs/refactor/state-model.md §3）：
// 旧库（user_version=12，chat_sessions 在用）升级与空库直建两条路径，
// scope → project_id 映射含 home/sources/projects、项目、孤儿与 folder 条目用例。
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));

import { closeDatabase, getDatabase } from '../../../database';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const FOLDER_ID = '22222222-2222-4222-8222-222222222222';
const ORPHAN_ID = '99999999-9999-4999-8999-999999999999';
const roots: string[] = [];

/** v12 时代的最小库：仅含 v13 迁移触及的表 + 会话种子。 */
function createV12Database(root: string) {
  const db = new Database(join(root, 'dela.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE workspace_entries (
      id TEXT PRIMARY KEY, parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT, note_id TEXT, local_path TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workspace_notes (id TEXT PRIMARY KEY, path TEXT NOT NULL);
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, title TEXT NOT NULL DEFAULT '新对话',
      messages TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_chat_sessions_scope ON chat_sessions(scope, updated_at DESC);
  `);
  const insertEntry = db.prepare(
    'INSERT INTO workspace_entries (id, parent_id, name, kind, updated_at) VALUES (?, NULL, ?, ?, ?)',
  );
  insertEntry.run(PROJECT_ID, '毕业设计', 'project', '2026-09-01T00:00:00.000Z');
  insertEntry.run(FOLDER_ID, '归档', 'folder', '2026-09-02T00:00:00.000Z');
  const insertSession = db.prepare(
    'INSERT INTO chat_sessions (id, scope, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const messages = JSON.stringify([{ role: 'user', content: '问题' }]);
  insertSession.run(
    's-home',
    'home',
    '首页会话',
    messages,
    '2026-09-03T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
  );
  insertSession.run(
    's-sources',
    'sources',
    '资料会话',
    messages,
    '2026-09-03T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
  );
  insertSession.run(
    's-projects',
    'projects',
    '项目入口会话',
    messages,
    '2026-09-03T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
  );
  insertSession.run(
    's-project',
    PROJECT_ID,
    '项目会话',
    messages,
    '2026-09-03T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
  );
  // 孤儿：scope 指向已不存在的条目。
  insertSession.run(
    's-orphan',
    ORPHAN_ID,
    '孤儿会话',
    messages,
    '2026-09-03T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
  );
  // scope 指向存在但非 project 的条目（folder）：不归属该项目。
  insertSession.run(
    's-folder',
    FOLDER_ID,
    '文件夹会话',
    messages,
    '2026-09-03T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
  );
  db.pragma('user_version = 12');
  db.close();
}

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dela-v13-'));
  roots.push(root);
  return root;
}

afterAll(() => {
  closeDatabase();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('v13 migration: upgrade from chat_sessions', () => {
  beforeAll(() => {
    createV12Database(freshRoot());
    state.root = roots[0]!;
    getDatabase();
  });

  it('migrates every chat session with identical messages (row count parity)', () => {
    const db = getDatabase();
    const oldCount = (db.prepare('SELECT COUNT(*) AS n FROM chat_sessions').get() as { n: number })
      .n;
    const sessions = db.prepare('SELECT id, project_id, messages FROM sessions').all() as {
      id: string;
      project_id: string | null;
      messages: string;
    }[];
    expect(sessions).toHaveLength(oldCount);
    for (const session of sessions) {
      expect(session.messages).toBe(JSON.stringify([{ role: 'user', content: '问题' }]));
    }
  });

  it('maps scope to project_id: entries merge into the general pool, projects attach, orphans fall back to null', () => {
    const byId = Object.fromEntries(
      (
        getDatabase().prepare('SELECT id, project_id FROM sessions').all() as {
          id: string;
          project_id: string | null;
        }[]
      ).map((row) => [row.id, row.project_id]),
    );
    expect(byId['s-home']).toBeNull();
    expect(byId['s-sources']).toBeNull();
    expect(byId['s-projects']).toBeNull();
    expect(byId['s-project']).toBe(PROJECT_ID);
    expect(byId['s-orphan']).toBeNull();
    expect(byId['s-folder']).toBeNull();
  });

  it('creates archive rows only for project entries and keeps chat_sessions read-only', () => {
    const db = getDatabase();
    const projects = db.prepare('SELECT id FROM projects').all() as { id: string }[];
    expect(projects.map((row) => row.id)).toEqual([PROJECT_ID]);
    // 旧表保留（回滚窗口，裁决 10），仅停用其 scope 索引。
    expect((db.prepare('SELECT COUNT(*) AS n FROM chat_sessions').get() as { n: number }).n).toBe(
      6,
    );
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_chat_sessions_scope'",
        )
        .get(),
    ).toBeUndefined();
    expect(db.pragma('user_version', { simple: true })).toBe(15);
  });

  it('creates a backup file before upgrading', () => {
    expect(existsSync(join(roots[0]!, 'dela-before-v15.db'))).toBe(true);
  });

  it('cascades project deletion: archive row removed, session downgraded to general', () => {
    const db = getDatabase();
    db.prepare('DELETE FROM workspace_entries WHERE id=?').run(PROJECT_ID);
    expect(db.prepare('SELECT id FROM projects').all()).toEqual([]);
    const session = db.prepare('SELECT project_id FROM sessions WHERE id=?').get('s-project') as {
      project_id: string | null;
    };
    expect(session.project_id).toBeNull();
  });
});

describe('v14 migration: upgrade an existing v13 session', () => {
  it('keeps messages and compaction while adding visible, unpinned defaults and a backup', () => {
    closeDatabase();
    state.root = freshRoot();
    let db = getDatabase();
    const id = '0123456789abcdef0123456789abcdef';
    const messages = JSON.stringify([{ role: 'user', content: '保留原有消息' }]);
    db.prepare(
      'INSERT INTO sessions(id, project_id, title, messages, summary, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
    ).run(id, '旧会话', messages, '旧摘要', '2026-09-29', '2026-09-29');
    db.exec(
      `DROP INDEX idx_sessions_visibility; ALTER TABLE sessions DROP COLUMN archived; ALTER TABLE sessions DROP COLUMN pinned;
       DROP TABLE vsjtu_sync; DROP TABLE vsjtu_courses; DROP TABLE vsjtu_videos; DROP TABLE vsjtu_video_refs`,
    );
    db.pragma('user_version = 13');
    closeDatabase();
    db = getDatabase();
    expect(
      db.prepare('SELECT messages, summary, archived, pinned FROM sessions WHERE id=?').get(id),
    ).toEqual({ messages, summary: '旧摘要', archived: 0, pinned: 0 });
    expect(existsSync(join(state.root, 'dela-before-v15.db'))).toBe(true);
  });
});

describe('v14 migration: fresh install', () => {
  beforeAll(() => {
    closeDatabase();
    state.root = freshRoot();
    getDatabase();
  });

  it('builds the current schema directly at v15 with empty tables', () => {
    const db = getDatabase();
    expect(db.pragma('user_version', { simple: true })).toBe(15);
    for (const table of ['projects', 'sessions', 'runs', 'note_versions']) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
      ).toBeDefined();
    }
    expect((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n).toBe(0);
  });
});
