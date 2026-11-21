import type { Schema } from '../../../core/ports';

export const todoSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS todo_items (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      data TEXT NOT NULL,
      read_at TEXT,
      notice_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_todo_owner ON todo_items(owner)`,
  ],
};
