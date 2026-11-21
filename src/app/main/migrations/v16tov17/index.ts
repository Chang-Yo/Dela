import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

const colors = new Set(['rose', 'peach', 'sand', 'sage', 'teal', 'blue', 'lilac', 'slate']);

const localDate = (date: Date) =>
  `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;

/**
 * 待办的截止时间改为三选一的时间（ADR 0024），「写入日历」开关随之取消；
 * 课表里的个人日程并入个人待办：同一天内的成为时段，跨天的按日期成为全天，原时刻记进备注。
 */
export function v16tov17(db: Database.Database): void {
  const update = db.prepare('UPDATE todo_items SET data = ? WHERE id = ?');
  const rows = db.prepare('SELECT id, data FROM todo_items').all() as Array<{
    id: string;
    data: string;
  }>;
  for (const row of rows) {
    const {
      dueAt,
      calendar: _calendar,
      ...rest
    } = JSON.parse(row.data) as {
      dueAt?: string | null;
      calendar?: boolean;
    };
    update.run(
      JSON.stringify({ ...rest, time: dueAt ? { kind: 'due', at: dueAt } : null }),
      row.id,
    );
  }

  const events = db
    .prepare('SELECT title, start_at, end_at, location, color, created_at FROM calendar_events')
    .all() as Array<{
    title: string;
    start_at: string;
    end_at: string;
    location: string | null;
    color: string | null;
    created_at: string;
  }>;
  const insert = db.prepare(
    "INSERT INTO todo_items (id, owner, data, read_at) VALUES (?, 'local', ?, ?)",
  );
  const now = new Date().toISOString();
  for (const event of events) {
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    const nextMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const sameDay = end <= nextMidnight;
    const notes = [
      event.location ? `地点：${event.location}` : '',
      sameDay ? '' : `原时间：${start.toLocaleString('zh-CN')} – ${end.toLocaleString('zh-CN')}`,
    ]
      .filter(Boolean)
      .join('\n');
    const item = {
      id: randomUUID(),
      source: 'personal',
      title: event.title,
      notes,
      // 止于零点的日程不占结束那一天。
      time: sameDay
        ? { kind: 'span', start: event.start_at, end: event.end_at }
        : {
            kind: 'allDay',
            startDate: localDate(start),
            endDate: localDate(new Date(end.getTime() - 1)),
          },
      status: 'open',
      completedAt: null,
      createdAt: event.created_at,
      readAt: now,
      ...(event.color && colors.has(event.color) ? { color: event.color } : {}),
    };
    insert.run(item.id, JSON.stringify(item), now);
  }
  db.exec('DROP TABLE calendar_events');
}
