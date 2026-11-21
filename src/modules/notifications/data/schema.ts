import type { Schema } from '../../../core/ports';

export const notificationsSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan', 'jwc', 'canvas')),
      account_key TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      read_at TEXT,
      source_unread INTEGER NOT NULL DEFAULT 1,
      href TEXT NOT NULL,
      category TEXT,
      count INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_account_source_created
      ON notifications (account_key, source, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS notification_refreshes (
      source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan', 'jwc', 'canvas')),
      account_key TEXT NOT NULL,
      last_success_at TEXT,
      error TEXT,
      PRIMARY KEY (source, account_key)
    )`,
  ],
};
