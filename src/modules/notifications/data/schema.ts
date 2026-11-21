import type { Schema } from '../../../core/ports';

export const notificationsSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
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
      source TEXT NOT NULL,
      account_key TEXT NOT NULL,
      last_success_at TEXT,
      error TEXT,
      PRIMARY KEY (source, account_key)
    )`,
  ],
  migrations: {
    // 来源由模块登记（registerNoticeSource），表里不再写死交大的来源名。
    '20261121-open-sources': (db) => {
      db.exec(`CREATE TABLE notifications_next (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        account_key TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        read_at TEXT,
        source_unread INTEGER NOT NULL DEFAULT 1,
        href TEXT NOT NULL,
        category TEXT,
        count INTEGER NOT NULL DEFAULT 1
      )`);
      const columns =
        'id, source, account_key, title, body, created_at, read_at, source_unread, href, category, count';
      db.exec(`INSERT INTO notifications_next (${columns}) SELECT ${columns} FROM notifications`);
      db.exec('DROP TABLE notifications');
      db.exec('ALTER TABLE notifications_next RENAME TO notifications');
      db.exec(`CREATE INDEX idx_notifications_account_source_created
        ON notifications (account_key, source, created_at DESC)`);

      db.exec(`CREATE TABLE notification_refreshes_next (
        source TEXT NOT NULL,
        account_key TEXT NOT NULL,
        last_success_at TEXT,
        error TEXT,
        PRIMARY KEY (source, account_key)
      )`);
      db.exec(`INSERT INTO notification_refreshes_next (source, account_key, last_success_at, error)
        SELECT source, account_key, last_success_at, error FROM notification_refreshes`);
      db.exec('DROP TABLE notification_refreshes');
      db.exec('ALTER TABLE notification_refreshes_next RENAME TO notification_refreshes');
    },
  },
};
