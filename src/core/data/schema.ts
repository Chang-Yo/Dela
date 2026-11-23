import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { hostPorts, type Schema } from '../ports';

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
    // core 不指向模块的表：项目移除或降为文件夹时，由 workspace 处理名下会话。
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
    // 文档读取改用 MinerU：删掉旧的 Python 组件与 skill；read_document 等用户配置 Token 后再开。
    '20261123-mineru-document': (db) => {
      const { userData, home } = hostPorts().paths;
      rmSync(join(userData(), 'components', 'document-reading'), { recursive: true, force: true });
      rmSync(join(home(), '.dela', 'skills', 'document-reading'), { recursive: true, force: true });
      db.exec(
        `UPDATE workspace_settings SET value=json_insert(value, '$[#]', 'read_document') WHERE key='tools-disabled'`,
      );
      db.exec(
        `UPDATE workspace_settings SET value=(SELECT json_group_array(value) FROM json_each(workspace_settings.value) WHERE value != 'document-reading') WHERE key='skills-disabled'`,
      );
    },
  },
};
