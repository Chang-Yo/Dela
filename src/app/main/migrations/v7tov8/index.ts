import type Database from 'better-sqlite3';

export function v7tov8(db: Database.Database): void {
  db.exec(`
    ALTER TABLE notifications RENAME TO notifications_v7;
    CREATE TABLE notifications (
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
    );
    INSERT INTO notifications (id, source, account_key, title, body, created_at, read_at, source_unread, href)
      SELECT id, source, account_key, title, body, created_at, read_at, source_unread, href FROM notifications_v7;
    DROP TABLE notifications_v7;
    CREATE INDEX idx_notifications_account_source_created
      ON notifications (account_key, source, created_at DESC);
    ALTER TABLE notification_refreshes RENAME TO notification_refreshes_v7;
    CREATE TABLE notification_refreshes (
      source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan', 'jwc', 'canvas')),
      account_key TEXT NOT NULL,
      last_success_at TEXT,
      error TEXT,
      PRIMARY KEY (source, account_key)
    );
    INSERT INTO notification_refreshes SELECT * FROM notification_refreshes_v7;
    DROP TABLE notification_refreshes_v7;
    ALTER TABLE shuiyuan_topics ADD COLUMN snapshot_status TEXT
      CHECK(snapshot_status IN ('saving', 'done', 'failed'));
    ALTER TABLE shuiyuan_topics ADD COLUMN snapshot_at TEXT;
    ALTER TABLE shuiyuan_topics ADD COLUMN snapshot_error TEXT;
  `);
}
