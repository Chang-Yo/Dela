import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

let database: Database.Database | null = null;

const schema: string[] = [
  // 邮箱缓存（账户/文件夹/近端邮件窗口）。
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
  // 课表与日历。
  `CREATE TABLE IF NOT EXISTS timetable_sync (
    semester TEXT PRIMARY KEY,
    last_synced_at TEXT NOT NULL,
    semester_start TEXT
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
  `CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    location TEXT,
    color TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_calendar_events_time ON calendar_events(start_at, end_at)`,
  // Canvas 课程与资料缓存。
  `CREATE TABLE IF NOT EXISTS canvas_courses (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS canvas_sources (id TEXT PRIMARY KEY, course_id INTEGER NOT NULL, data TEXT NOT NULL)`,
  // 工作区：条目身份以路径为主，只有项目与来源引用建行；笔记不落库。
  // 远程连接：项目条目经 remote_id 指向这里，local_path 存远程绝对路径（POSIX）。
  // Dela 不保存任何 SSH 凭据：密钥、端口与跳板由 ssh 自己按 ~/.ssh/config 解析。
  `CREATE TABLE IF NOT EXISTS remotes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER,
    key_path TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_remotes_host ON remotes(host, port)`,
  `CREATE TABLE IF NOT EXISTS workspace_entries (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES workspace_entries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_id TEXT,
    local_path TEXT,
    remote_id TEXT REFERENCES remotes(id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS workspace_parent ON workspace_entries(parent_id)`,
  `CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `INSERT OR IGNORE INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, updated_at)
    VALUES ('00000000-0000-4000-8000-000000000001', NULL, '归档', 'folder', NULL, NULL, '2026-10-07T00:00:00.000Z')`,
  // 水源来源引用：仅在用户把帖子添加到项目时写入一行，不是同步缓存。
  `CREATE TABLE IF NOT EXISTS shuiyuan_topics (
    topic_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    excerpt TEXT,
    category_name TEXT,
    author TEXT,
    posts_count INTEGER,
    added_at TEXT NOT NULL
  )`,
  // 通知中心。
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan')),
    account_key TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    read_at TEXT,
    source_unread INTEGER NOT NULL DEFAULT 1,
    href TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_account_source_created
    ON notifications (account_key, source, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notification_refreshes (
    source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan')),
    account_key TEXT NOT NULL,
    last_success_at TEXT,
    error TEXT,
    PRIMARY KEY (source, account_key)
  )`,
  // TODO：个人待办与 Canvas 作业缓存。
  `CREATE TABLE IF NOT EXISTS todo_items (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    data TEXT NOT NULL,
    read_at TEXT,
    notice_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_todo_owner ON todo_items(owner)`,
  // 会话索引：完整记录是 Pi 的 JSONL 会话文件（file 列）；项目即 kind='project' 的条目，
  // 会话自带工作目录（通用会话是 chat-sessions 下的私有目录），cwd 为 NULL 时按条目 local_path 解析。
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
    effort TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_visibility ON sessions(project_id, archived, pinned, updated_at DESC)`,
];

const createConsentRecords = `CREATE TABLE IF NOT EXISTS consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document TEXT NOT NULL,
  revision TEXT NOT NULL,
  app_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL
)`;

export const SCHEMA_VERSION = 7;

export function getDatabase(): Database.Database {
  if (database) return database;
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'dela.db'));
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version !== 0 && version !== SCHEMA_VERSION)
      throw new Error('数据库格式不受支持，请使用当前版本创建的数据目录');
    db.transaction(() => {
      for (const statement of schema) db.exec(statement);
      db.exec(createConsentRecords);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  } catch (error) {
    db.close();
    throw error;
  }
  database = db;
  return db;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}
