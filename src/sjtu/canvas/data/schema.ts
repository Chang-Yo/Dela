import type { Schema } from '../../../core/ports';

export const canvasSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS canvas_courses (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]'
    )`,
    `CREATE TABLE IF NOT EXISTS canvas_sources (id TEXT PRIMARY KEY, course_id INTEGER NOT NULL, data TEXT NOT NULL)`,
  ],
};
