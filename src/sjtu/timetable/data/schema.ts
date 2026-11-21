import type { Schema } from '../../../core/ports';

export const timetableSchema: Schema = {
  owner: 'timetable',
  tables: [
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
  ],
};
