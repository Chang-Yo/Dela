import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

let database: Database.Database | null = null;

const migrations: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS mail_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL UNIQUE,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
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
      UNIQUE(folder_id, uid)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mail_messages_folder_date ON mail_messages(folder_id, date DESC)`,
  ],
];

export function getDatabase(): Database.Database {
  if (database) return database;
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'dela.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < migrations.length; version += 1) {
    const statements = migrations[version];
    if (!statements) break;
    db.transaction(() => {
      for (const statement of statements) db.exec(statement);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
  database = db;
  return db;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}
