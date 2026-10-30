import type Database from 'better-sqlite3';
import type { MigrationContext } from '../types';

export function v7tov8(db: Database.Database, _context: MigrationContext): void {
  db.exec(`CREATE TABLE IF NOT EXISTS canvas_cache_usage (
    cache_key TEXT PRIMARY KEY,
    file_id INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS canvas_cache_pins (
    kind TEXT NOT NULL CHECK(kind IN ('file', 'course')),
    item_id INTEGER NOT NULL,
    PRIMARY KEY(kind, item_id)
  );`);
}
