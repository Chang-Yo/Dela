import type { Schema } from '../ports';

// 会话索引：完整记录在 file 指向的 Pi JSONL 里；cwd 为 NULL 时按项目目录解析。
// parent_id 非空的是子 Agent 会话：不进会话列表与搜索，随父会话归档、删除。
export const coreSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES workspace_entries(id) ON DELETE SET NULL,
      cwd TEXT,
      file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      message_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      effort TEXT,
      parent_id TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_visibility ON sessions(project_id, archived, pinned, updated_at DESC)`,
  ],
};
