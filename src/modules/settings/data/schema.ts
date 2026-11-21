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
};
