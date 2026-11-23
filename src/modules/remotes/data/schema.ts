import type { Schema } from '../../../core/ports';

// Dela 不保存密码，只存连接参数与私钥路径；凭据由 ssh 从 ~/.ssh 与 agent 读取。
export const remotesSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS remotes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER,
      key_path TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_remotes_host ON remotes(host, port)`,
  ],
};
