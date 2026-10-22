import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

let database: Database.Database | null = null;

// 2026-10 破坏性重置：schema 从 v1 重开，不迁移旧世界数据（docs/DEVELOPMENT.md §8 持久化）。
// 旧世界的特征表：workspace_notes（v5–v15 体系都有，新 schema 不再创建）。
const LEGACY_MARKER = 'workspace_notes';
const legacyTables = [
  'runs',
  'note_versions',
  'sessions',
  'projects',
  'chat_sessions',
  'vsjtu_videos',
  'vsjtu_courses',
  'vsjtu_sync',
  'vsjtu_video_refs',
  'workspace_notes',
  'workspace_entries',
  'remotes',
  'workspace_settings',
  'todo_items',
  'notification_refreshes',
  'notifications',
  'shuiyuan_topics',
  'canvas_sources',
  'canvas_courses',
  'calendar_events',
  'timetable_lessons',
  'timetable_sync',
  'mail_messages',
  'mail_folders',
  'mail_accounts',
];

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
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_visibility ON sessions(project_id, archived, pinned, updated_at DESC)`,
];

// 这张表与版本号解耦创建（见 getDatabase 里的说明），所以不在上面的 schema 数组里：
// 条款接受记录只追加、不改写，一次接受一行。条款改版后再次接受会留下新行，
// 因此「同意的是哪一版、什么时候同意的」可回溯。版本与时间由主进程填写。
const createConsentRecords = `CREATE TABLE IF NOT EXISTS consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document TEXT NOT NULL,
  revision TEXT NOT NULL,
  app_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL
)`;

const SCHEMA_VERSION = 6;

/** v2→v3 只加列：远程项目不迁移已有数据，旧条目一律视为本地项目。
 *  旧世界库刚被整库丢弃、v1 库本就没有条目表，这两种情况下表还不存在，直接跳过。 */
function addColumnIfMissing(db: Database.Database, table: string, column: string, type: string) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return;
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function getDatabase(): Database.Database {
  if (database) return database;
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'dela.db'));
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const version = db.pragma('user_version', { simple: true }) as number;
    // 旧世界库（特征表存在，user_version 为旧体系的任意值，包括与当前版本号相同的 4/5）必须
    // 在版本闸门之前判定：放进闸门里，撞上当前版本号的老库既不会被拒绝也不会被重建，
    // 只会留下一堆缺表的库，随后每次查询都报 no such table。
    const legacy = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(LEGACY_MARKER);
    if (legacy) {
      // 旧世界库：一次性备份后整库丢弃，不做迁移。
      const backup = join(dir, 'dela-legacy-backup.db');
      if (!existsSync(backup)) db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        for (const table of legacyTables) db.exec(`DROP TABLE IF EXISTS ${table}`);
      })();
      db.pragma('foreign_keys = ON');
    } else if (version > SCHEMA_VERSION) {
      throw new Error('数据库由更新版本的 Dela 创建，请先升级应用');
    } else if (version === 1) {
      // v1→v2：会话改由 Pi JSONL 承载，旧会话/运行/项目档案表不迁移；领域缓存与条目保留。
      db.transaction(() => {
        for (const table of ['runs', 'sessions', 'projects'])
          db.exec(`DROP TABLE IF EXISTS ${table}`);
      })();
    }
    if (!legacy && version >= 1 && version < 6) {
      // v5→v6：条目不再区分 note/local/imported，统一为 file。导出 PDF 的 imported 行及其关联
      // 破坏性丢弃（PDF 文件留在「预览导出」，按普通文件出现；pptx 再导出一次即重建关联）。
      // 半途库可能缺其中某张表，逐表判断。
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      db.transaction(() => {
        if (hasTable('workspace_entries'))
          db.exec("DELETE FROM workspace_entries WHERE kind IN ('note', 'local', 'imported')");
        if (hasTable('workspace_settings'))
          db.exec("DELETE FROM workspace_settings WHERE key LIKE 'preview-export:%'");
      })();
    }
    // 刚丢弃过旧世界库时版本号可能是任意值（含当前值），所以这里按「是否重建过」而不是只看版本号。
    if (legacy || version !== SCHEMA_VERSION) {
      db.transaction(() => {
        for (const statement of schema) db.exec(statement);
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
      })();
    }
    // 建表也与版本号解耦：中途版本或手工改过的库可能已经是当前版本号却没这张表，
    // 只认版本号会让它永久缺表，而写入失败在界面上是无感的。列修复（addColumnIfMissing）
    // 早就出于同样原因每次打开都幂等补一次。
    db.exec(createConsentRecords);
    // 列修复与版本号解耦：中途版本可能已经把 user_version 提到当前值却没加列（实测出现过），
    // 只认版本号会让这种库永久缺列；这里每次打开都幂等补一次，缺列才执行 ALTER。
    addColumnIfMissing(db, 'workspace_entries', 'remote_id', 'TEXT');
    // v3→v4 只加列：会话自带工作目录，旧会话留 NULL 继续按项目目录解析。
    addColumnIfMissing(db, 'sessions', 'cwd', 'TEXT');
    // 第三方 IMAP 的 SMTP 参数：老库的 imap_host/imap_port 已存在，缺的是这两列。
    addColumnIfMissing(db, 'mail_accounts', 'smtp_host', 'TEXT');
    addColumnIfMissing(db, 'mail_accounts', 'smtp_port', 'INTEGER');
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
