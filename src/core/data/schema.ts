import type { Schema } from '../ports';

// 会话索引：完整记录在 file 指向的 Pi JSONL 里；cwd 为 NULL 时按项目目录解析。
// parent_id 非空的是子 Agent 会话：不进会话列表与搜索，随父会话归档、删除。
export const coreSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
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
  migrations: {
    // core 不指向模块的表（0025）：项目移除或降为文件夹时，由 workspace 处理名下会话。
    '20261121-drop-project-fk': (db) => {
      db.exec(`CREATE TABLE sessions_next (
        id TEXT PRIMARY KEY,
        project_id TEXT,
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
      )`);
      const columns =
        'id, project_id, cwd, file, title, message_count, archived, pinned, created_at, updated_at, provider_id, model, effort, parent_id';
      db.exec(`INSERT INTO sessions_next (${columns}) SELECT ${columns} FROM sessions`);
      db.exec('DROP TABLE sessions');
      db.exec('ALTER TABLE sessions_next RENAME TO sessions');
      db.exec(
        'CREATE INDEX idx_sessions_visibility ON sessions(project_id, archived, pinned, updated_at DESC)',
      );
    },
  },
};
