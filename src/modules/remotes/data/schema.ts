import type { Schema } from '../../../core/ports';

// Dela 不保存任何 SSH 凭据：密钥、端口与跳板由 ssh 自己按 ~/.ssh/config 解析。
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
