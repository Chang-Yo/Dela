import type { Schema } from '../../../core/ports';

// 条目身份以路径为主，只有项目与项目快捷方式建行；远程项目的 local_path 是远端 POSIX 路径。
export const workspaceSchema: Schema = {
  owner: 'workspace',
  tables: [
    `CREATE TABLE IF NOT EXISTS workspace_entries (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_id TEXT,
      local_path TEXT,
      remote_id TEXT REFERENCES remotes(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS workspace_parent ON workspace_entries(parent_id)`,
    `INSERT OR IGNORE INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000001', NULL, '归档', 'folder', NULL, NULL, '2026-10-07T00:00:00.000Z')`,
  ],
};
