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
  [
    `CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      messages TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_chat_sessions_scope ON chat_sessions(scope, updated_at DESC)`,
    // 旧版把每个 scope 的对话存为 workspace_settings 的 `chat:<scope>` JSON；升级为多会话表。
    `INSERT INTO chat_sessions (id, scope, title, messages, created_at, updated_at)
      SELECT lower(hex(randomblob(16))),
        substr(key, 6),
        substr(coalesce(json_extract(value, '$[0].content'), '新对话'), 1, 60),
        value,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM workspace_settings WHERE key LIKE 'chat:%'`,
    `DELETE FROM workspace_settings WHERE key LIKE 'chat:%'`,
  ],
  [
    // 水源来源引用：仅在用户把帖子添加到项目时写入一行，不是同步缓存。
    `CREATE TABLE shuiyuan_topics (
      topic_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      excerpt TEXT,
      category_name TEXT,
      author TEXT,
      posts_count INTEGER,
      added_at TEXT NOT NULL
    )`,
  ],
  [
    `CREATE TABLE notifications (
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
    `CREATE INDEX idx_notifications_account_source_created
      ON notifications (account_key, source, created_at DESC)`,
    `CREATE TABLE notification_refreshes (
      source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan')),
      account_key TEXT NOT NULL,
      last_success_at TEXT,
      error TEXT,
      PRIMARY KEY (source, account_key)
    )`,
  ],
  [
    `CREATE TABLE todo_items (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      data TEXT NOT NULL,
      read_at TEXT,
      notice_at TEXT
    )`,
    `CREATE INDEX idx_todo_owner ON todo_items(owner)`,
  ],
  [
    // Session/Run 新身份（docs/refactor/state-model.md §3）：projects 档案、sessions 取代
    // chat_sessions（旧表停写保留，一个发布周期后单独迁移 DROP，见裁决 10）、runs 落库、note_versions。
    `CREATE TABLE projects (
      id TEXT PRIMARY KEY REFERENCES workspace_entries(id) ON DELETE CASCADE,
      background TEXT NOT NULL DEFAULT '',
      goal TEXT NOT NULL DEFAULT '',
      workdir TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_projects_updated ON projects(updated_at DESC)`,
    `CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      messages TEXT NOT NULL DEFAULT '[]',
      summary TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at DESC)`,
    `CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC)`,
    `CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','waiting_input','completed','failed','stopped','interrupted')),
      request TEXT NOT NULL DEFAULT '{}',
      steps TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT
    )`,
    `CREATE INDEX idx_runs_session ON runs(session_id, started_at DESC)`,
    `CREATE INDEX idx_runs_project ON runs(project_id, started_at DESC)`,
    `CREATE TABLE note_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL REFERENCES workspace_notes(id) ON DELETE CASCADE,
      revision TEXT NOT NULL,
      text TEXT NOT NULL,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_note_versions_note ON note_versions(note_id, created_at DESC)`,
    // 为现存 project 条目建档案行（folder/note 等其他 kind 不建档）。
    `INSERT INTO projects (id, created_at, updated_at)
      SELECT id, updated_at, updated_at FROM workspace_entries WHERE kind='project'`,
    // 会话迁移 scope → project_id：'home'/'sources'/'projects' 与孤儿（条目已删除或非 project）
    // 不命中 JOIN，落入 NULL 通用池（裁决 5）；消息 JSON 原样保留。
    `INSERT INTO sessions (id, project_id, title, messages, created_at, updated_at)
      SELECT c.id, p.id, c.title, c.messages, c.created_at, c.updated_at
      FROM chat_sessions c LEFT JOIN projects p ON p.id = c.scope`,
    // 旧表只读保留（回滚窗口），停用其索引；后续迁移版本再 DROP TABLE chat_sessions。
    // 回滚护栏：v13 之后若新增行（用户回滚旧版续用会话再升级），这些行只存在于旧表、
    // 不会随本迁移的 INSERT INTO ... SELECT 进入 sessions；届时 DROP 前必须先检查旧表
    // 在 v13 迁移时间点之后的新增行，有则先补迁移再 DROP，否则该批会话将永久丢失。
    `DROP INDEX idx_chat_sessions_scope`,
  ],
  [
    'ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
    'CREATE INDEX idx_sessions_visibility ON sessions(project_id, archived, pinned, updated_at)',
  ],
  [
    // 课堂视频：课程/场次同步缓存（直链不入库，播放时现取）+ 添加到项目时的引用行
    // （对齐 shuiyuan_topics：只在用户添加时写入，不是同步缓存）。
    `CREATE TABLE vsjtu_sync (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_synced_at TEXT,
      acte_id TEXT,
      error TEXT
    )`,
    `CREATE TABLE vsjtu_courses (
      tecl_id INTEGER PRIMARY KEY,
      subj_code TEXT,
      subj_name TEXT NOT NULL
    )`,
    `CREATE TABLE vsjtu_videos (
      course_id INTEGER PRIMARY KEY,
      tecl_id INTEGER NOT NULL,
      begin_time TEXT NOT NULL,
      end_time TEXT,
      leti_number INTEGER,
      classroom TEXT,
      teacher TEXT,
      vod_time REAL,
      thumb_url TEXT,
      transfer_ready INTEGER NOT NULL DEFAULT 0,
      ppt_ready INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX idx_vsjtu_videos_tecl ON vsjtu_videos(tecl_id, begin_time DESC)`,
    `CREATE TABLE vsjtu_video_refs (
      course_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      course_name TEXT,
      begin_time TEXT,
      leti_number INTEGER,
      vod_time REAL,
      added_at TEXT NOT NULL
    )`,
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
