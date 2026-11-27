import type { Schema } from '../../../core/ports';

export const settingsSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS consent_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document TEXT NOT NULL,
      revision TEXT NOT NULL,
      app_version TEXT NOT NULL,
      accepted_at TEXT NOT NULL
    )`,
  ],
  migrations: {
    // 待安装更新的标记改归更新模块；更新模块没有自己的表，由原主人设置模块改名。
    '20261121-move-pending-install': (db) => {
      db.exec(
        "UPDATE workspace_settings SET key='update-pending-install' WHERE key='pending-install'",
      );
    },
  },
};
