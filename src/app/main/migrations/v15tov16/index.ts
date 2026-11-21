import type Database from 'better-sqlite3';

type LegacyTodo = Record<string, unknown> & {
  source: 'personal' | 'canvas';
  status: string;
  courseId?: number;
  courseName?: string;
  description?: string;
  submittedAt?: string | null;
};

const canvasStatus: Record<string, [status: string, label: string]> = {
  pending: ['open', '未完成'],
  submitted: ['done', '已提交'],
  graded: ['done', '已批改'],
  excused: ['done', '已豁免'],
  resubmit: ['open', '需重新提交'],
  offline: ['unknown', '线下 / 无需在线提交'],
  unknown: ['unknown', '待同步确认'],
};

/**
 * 待办改为通用来源：状态只剩 open/done/unknown，Canvas 的说法存为 statusLabel，
 * 课程字段并成 group，提交时间改名 completedAt，同步进度的键带上来源 id。
 */
export function v15tov16(db: Database.Database): void {
  const update = db.prepare('UPDATE todo_items SET data = ? WHERE id = ?');
  const rows = db.prepare('SELECT id, data FROM todo_items').all() as Array<{
    id: string;
    data: string;
  }>;
  for (const row of rows) {
    const {
      status,
      courseId,
      courseName,
      courseCode: _code,
      assignmentId: _assignment,
      description,
      submittedAt,
      ...rest
    } = JSON.parse(row.data) as LegacyTodo;
    const item =
      rest.source === 'canvas'
        ? {
            ...rest,
            status: canvasStatus[status]?.[0] ?? 'unknown',
            statusLabel: canvasStatus[status]?.[1] ?? '待同步确认',
            completedAt: submittedAt ?? null,
            group: { id: String(courseId), label: courseName ?? `课程 ${courseId}` },
            ...(description === undefined ? {} : { bodyHtml: description }),
          }
        : { ...rest, status: status === 'completed' ? 'done' : 'open', completedAt: null };
    update.run(JSON.stringify(item), row.id);
  }

  const sync = db
    .prepare("SELECT key, value FROM workspace_settings WHERE key LIKE 'todo-sync:%'")
    .all() as Array<{ key: string; value: string }>;
  const remove = db.prepare('DELETE FROM workspace_settings WHERE key = ?');
  const insert = db.prepare('INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)');
  for (const { key, value } of sync) {
    const { courses, ...state } = JSON.parse(value) as { courses: number[] };
    remove.run(key);
    insert.run(
      `todo-sync:canvas:${key.slice('todo-sync:'.length)}`,
      JSON.stringify({ ...state, groups: courses.map(String) }),
    );
  }
}
