import type Database from 'better-sqlite3';

export function v8tov9(db: Database.Database): void {
  db.exec('ALTER TABLE sessions ADD COLUMN parent_id TEXT');
}
