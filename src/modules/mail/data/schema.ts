import type { Schema } from '../../../core/ports';

export const mailSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS mail_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL UNIQUE,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
      smtp_host TEXT,
      smtp_port INTEGER,
      created_at TEXT NOT NULL,
      last_synced_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS mail_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      special_use TEXT,
      uid_validity TEXT,
      total INTEGER,
      unread INTEGER,
      synced_at TEXT,
      UNIQUE(account_id, path)
    )`,
    `CREATE TABLE IF NOT EXISTS mail_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL REFERENCES mail_folders(id) ON DELETE CASCADE,
      uid INTEGER NOT NULL,
      message_id TEXT,
      subject TEXT,
      sender_name TEXT,
      sender_address TEXT,
      to_addresses TEXT,
      cc_addresses TEXT,
      date TEXT,
      seen INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      snippet TEXT,
      body_text TEXT,
      body_html TEXT,
      attachments TEXT,
      size INTEGER,
      fetched_at TEXT,
      body_version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      UNIQUE(folder_id, uid)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mail_messages_folder_date ON mail_messages(folder_id, date DESC)`,
  ],
};
