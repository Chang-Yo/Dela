import { BrowserWindow, ipcMain } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../database';
import { loadCanvasToken } from '../credentials';
import { checkWorkspaceSender } from '../ipc';
import { listTodoCanvasAssignments, listTodoCanvasCourses } from '../canvas/api';
import { canvasTodoStatus } from '../../shared/todo';
import { calendarEventColors } from '../../shared/api';
import type { NotificationItem, TodoItem, TodoState } from '../../shared/api';
import { systemNotifyItem } from '../notifications/system';

const idSchema = z.string().min(1).max(512);
export const todoSaveSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    completed: z.boolean().optional(),
    calendar: z.boolean().optional(),
    color: z.enum(calendarEventColors).optional(),
  })
  .strict();
type TodoRow = {
  id: string;
  owner: string;
  data: string;
  read_at: string | null;
  notice_at: string | null;
};
type SyncState = { syncedAt: string | null; error: string | null; courses: number[] };
let activeRefresh: Promise<TodoState> | null = null;

function canvasOwner(): string | null {
  const token = loadCanvasToken();
  return token ? createHash('sha256').update(token).digest('hex') : null;
}

function syncState(owner: string | null): SyncState {
  const row = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(`todo-sync:${owner}`) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : { syncedAt: null, error: null, courses: [] };
}

function rows(): TodoRow[] {
  return getDatabase()
    .prepare('SELECT * FROM todo_items WHERE owner=? OR owner=?')
    .all('local', canvasOwner() ?? '') as TodoRow[];
}

export function getTodoState(): TodoState {
  const owner = canvasOwner();
  const sync = syncState(owner);
  return {
    items: rows()
      .map((row) => ({ ...JSON.parse(row.data), readAt: row.read_at }) as TodoItem)
      .sort(
        (a, b) => (a.dueAt ?? 'z').localeCompare(b.dueAt ?? 'z') || a.title.localeCompare(b.title),
      ),
    connected: owner !== null,
    syncing: activeRefresh !== null,
    syncedAt: sync.syncedAt,
    error: sync.error,
  };
}

export function broadcastTodos(): TodoState {
  const state = getTodoState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const url = window.webContents.getURL();
    if (
      url.startsWith('http://127.0.0.1:5173/') ||
      (url.startsWith('file:') && /\/renderer\/index\.html(?:\?|$)/.test(url))
    ) {
      window.webContents.send('todo:state', state);
    }
  }
  return state;
}

export function saveTodo(input: unknown): TodoState {
  const value = todoSaveSchema.parse(input);
  const existing = value.id
    ? rows().find((row) => row.id === value.id && row.owner === 'local')
    : undefined;
  if (value.id && !existing) throw new Error('待办不存在，Canvas 作业的完成状态只能通过同步更新');
  const old = existing ? (JSON.parse(existing.data) as TodoItem) : undefined;
  const now = new Date().toISOString();
  const item: TodoItem = {
    id: value.id ?? randomUUID(),
    source: 'personal',
    title: value.title,
    notes: value.notes ?? old?.notes ?? '',
    dueAt: value.dueAt === undefined ? (old?.dueAt ?? null) : value.dueAt,
    status:
      value.completed === undefined
        ? (old?.status ?? 'pending')
        : value.completed
          ? 'completed'
          : 'pending',
    calendar: value.calendar ?? old?.calendar ?? false,
    color: value.color ?? old?.color,
    createdAt: old?.createdAt ?? now,
    readAt: now,
  };
  getDatabase()
    .prepare(
      "INSERT INTO todo_items(id, owner, data, read_at) VALUES (?, 'local', ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    )
    .run(item.id, JSON.stringify(item), now);
  return broadcastTodos();
}

export function removeTodo(input: unknown): TodoState {
  getDatabase()
    .prepare("DELETE FROM todo_items WHERE id=? AND owner='local'")
    .run(idSchema.parse(input));
  return broadcastTodos();
}

export function markTodoRead(input?: unknown): TodoState {
  const id = input === undefined ? null : idSchema.parse(input);
  getDatabase()
    .prepare(
      'UPDATE todo_items SET read_at=COALESCE(read_at, ?) WHERE (owner=? OR owner=?) AND (? IS NULL OR id=?)',
    )
    .run(new Date().toISOString(), 'local', canvasOwner() ?? '', id, id);
  return broadcastTodos();
}

export function todoNotifications(): NotificationItem[] {
  return rows()
    .filter((row) => row.notice_at !== null)
    .map((row) => {
      const item = JSON.parse(row.data) as TodoItem;
      return {
        id: `todo:${row.id}`,
        source: 'todo',
        title: item.title,
        body: `${item.courseName ?? 'Canvas'} · 新作业`,
        createdAt: row.notice_at!,
        readAt: row.read_at,
        href: { kind: 'todo', todoId: item.id },
      };
    });
}

export function refreshTodos(): Promise<TodoState> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = syncCanvasTodos().then(
    () => {
      activeRefresh = null;
      return broadcastTodos();
    },
    (error: unknown) => {
      activeRefresh = null;
      broadcastTodos();
      throw error;
    },
  );
  broadcastTodos();
  return activeRefresh;
}

async function syncCanvasTodos(): Promise<TodoState> {
  const owner = canvasOwner();
  if (!owner) return getTodoState();
  const db = getDatabase();
  const previous = syncState(owner);
  const successful = new Set(previous.courses);
  const errors: string[] = [];
  try {
    const courses = await listTodoCanvasCourses();
    for (const course of courses) {
      if (canvasOwner() !== owner) return getTodoState();
      try {
        const assignments = await listTodoCanvasAssignments(course.id);
        if (canvasOwner() !== owner) return getTodoState();
        const now = new Date().toISOString();
        const ids = new Set<string>();
        // 已知课程新增作业（INSERT 且 notice_at=now）是通知产生时刻，弹系统桌面通知。
        const existingIds = new Set(
          (
            db
              .prepare(
                "SELECT id FROM todo_items WHERE owner=? AND json_extract(data, '$.courseId')=?",
              )
              .all(owner, course.id) as { id: string }[]
          ).map((row) => row.id),
        );
        const freshNotices: { id: string; title: string }[] = [];
        db.transaction(() => {
          for (const a of assignments) {
            if (typeof a.id !== 'number' || a.published === false) continue;
            const id = `canvas:${owner}:${course.id}:${a.id}`;
            ids.add(id);
            const sub = a.submission as Record<string, unknown> | undefined;
            const item: TodoItem = {
              id,
              source: 'canvas',
              assignmentId: a.id,
              courseId: course.id,
              courseName: course.name,
              title: typeof a.name === 'string' ? a.name : '未命名作业',
              notes: '',
              dueAt: typeof a.due_at === 'string' ? a.due_at : null,
              status: canvasTodoStatus(a),
              submittedAt: typeof sub?.submitted_at === 'string' ? sub.submitted_at : null,
              url: typeof a.html_url === 'string' ? a.html_url : undefined,
              description: typeof a.description === 'string' ? a.description : undefined,
              createdAt: typeof a.created_at === 'string' ? a.created_at : now,
              syncedAt: now,
              readAt: null,
            };
            // 已读与完成独立；更新状态时绝不重置 read_at 或生成第二条通知。
            db.prepare(
              'INSERT INTO todo_items(id, owner, data, read_at, notice_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
            ).run(
              id,
              owner,
              JSON.stringify(item),
              successful.has(course.id) ? null : now,
              successful.has(course.id) ? now : null,
            );
            if (successful.has(course.id) && !existingIds.has(id))
              freshNotices.push({ id, title: item.title });
          }
          const old = db
            .prepare(
              "SELECT id FROM todo_items WHERE owner=? AND json_extract(data, '$.courseId')=?",
            )
            .all(owner, course.id) as { id: string }[];
          for (const item of old)
            if (!ids.has(item.id)) db.prepare('DELETE FROM todo_items WHERE id=?').run(item.id);
        })();
        for (const notice of freshNotices) {
          systemNotifyItem({
            id: `todo:${notice.id}`,
            source: 'todo',
            title: notice.title,
            body: `${course.name} · 新作业`,
            createdAt: now,
            readAt: null,
            href: { kind: 'todo', todoId: notice.id },
          });
        }
        successful.add(course.id);
      } catch (error) {
        errors.push(`${course.name}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (canvasOwner() === owner) {
    db.prepare('INSERT OR REPLACE INTO workspace_settings(key, value) VALUES (?, ?)').run(
      `todo-sync:${owner}`,
      JSON.stringify({
        syncedAt: errors.length ? previous.syncedAt : new Date().toISOString(),
        error: errors.join('\n') || null,
        courses: [...successful],
      } satisfies SyncState),
    );
  }
  return getTodoState();
}

export function registerTodoIpc(): void {
  for (const [name, fn] of Object.entries({
    'get-state': getTodoState,
    refresh: refreshTodos,
    save: saveTodo,
    remove: removeTodo,
    'mark-read': (id: unknown) => markTodoRead(idSchema.parse(id)),
  })) {
    ipcMain.handle(`todo:${name}`, (event, input: unknown) => {
      checkWorkspaceSender(event);
      return fn(input);
    });
  }
}
