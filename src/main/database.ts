import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

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
  ['ALTER TABLE mail_messages ADD COLUMN body_version INTEGER NOT NULL DEFAULT 0'],
  [
    `CREATE TABLE IF NOT EXISTS timetable_sync (
      semester TEXT PRIMARY KEY,
      last_synced_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS timetable_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester TEXT NOT NULL,
      source_id TEXT NOT NULL,
      course_code TEXT NOT NULL,
      course_name TEXT NOT NULL,
      class_name TEXT,
      teacher TEXT,
      campus TEXT,
      classroom TEXT,
      weekday INTEGER NOT NULL,
      start_period INTEGER NOT NULL,
      end_period INTEGER NOT NULL,
      periods_text TEXT NOT NULL,
      weeks_text TEXT NOT NULL,
      week_numbers TEXT NOT NULL,
      credits REAL,
      note TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_timetable_lessons_semester_day ON timetable_lessons(semester, weekday, start_period)`,
  ],
  [
    `ALTER TABLE timetable_sync ADD COLUMN semester_start TEXT`,
    `CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      location TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_calendar_events_time ON calendar_events(start_at, end_at)`,
  ],
  [
    `CREATE TABLE canvas_courses (id INTEGER PRIMARY KEY, data TEXT NOT NULL, items TEXT NOT NULL DEFAULT '[]')`,
    `CREATE TABLE canvas_sources (id TEXT PRIMARY KEY, course_id INTEGER NOT NULL, data TEXT NOT NULL)`,
    `CREATE TABLE workspace_entries (
      id TEXT PRIMARY KEY, parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT, note_id TEXT, local_path TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE workspace_notes (id TEXT PRIMARY KEY, path TEXT NOT NULL)`,
    `CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE INDEX workspace_parent ON workspace_entries(parent_id)`,
  ],
  [`ALTER TABLE calendar_events ADD COLUMN color TEXT`],
  [
    `INSERT OR IGNORE INTO workspace_entries
      (id, parent_id, name, kind, source_id, note_id, local_path, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000001', NULL, '归档', 'folder', NULL, NULL, NULL, '2026-09-12T00:00:00.000Z')`,
  ],
  [`ALTER TABLE mail_messages ADD COLUMN deleted_at TEXT`],
];

export function getDatabase(): Database.Database {
  if (database) return database;
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'dela.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > 0 && current < migrations.length) {
    const backup = join(dir, `dela-before-v${migrations.length}.db`);
    if (!existsSync(backup)) db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  }
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
