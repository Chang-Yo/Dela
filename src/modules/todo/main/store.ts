import { randomUUID } from 'node:crypto';
import { emit, hostPorts } from '../../../core/ports';
import {
  todoContract,
  todoSaveSchema,
  type TodoItem,
  type TodoSaveInput,
  type TodoState,
} from '../contract';

export interface TaskCourse {
  id: number;
  name: string;
  code?: string;
}

/** 外部作业来源（如 Canvas）。待办只认这组接口，来源按课程分批同步，单门课失败不影响其他课。 */
export interface TaskSource {
  /** 当前账号的指纹，未登录时为 null；换账号后旧账号的待办不再显示。 */
  owner(): string | null;
  courses(): Promise<TaskCourse[]>;
  /** 一门课的作业；id 需带上 owner，保证不同账号互不覆盖。 */
  tasks(owner: string, course: TaskCourse): Promise<TodoItem[]>;
}

type TodoRow = {
  id: string;
  owner: string;
  data: string;
  read_at: string | null;
  notice_at: string | null;
};
type SyncState = { syncedAt: string | null; error: string | null; courses: number[] };
/** 已同步课程新出现的作业，由通知中心展示与提醒。 */
export interface TaskNotice {
  todoId: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

let source: TaskSource | null = null;
let noticeListener: ((notice: TaskNotice) => void) | null = null;
let changeListener: (() => void) | null = null;
let activeRefresh: Promise<TodoState> | null = null;

export function registerTaskSource(next: TaskSource): void {
  source = next;
}

/** 已同步过的课程出现新作业时调用，由宿主决定是否弹系统通知。 */
export function onTaskNotice(listener: (notice: TaskNotice) => void): void {
  noticeListener = listener;
}

/** 待办状态推送后调用，通知中心据此重播含待办提醒的状态。 */
export function onTodoChange(listener: () => void): void {
  changeListener = listener;
}

function sourceOwner(): string | null {
  return source?.owner() ?? null;
}

function syncState(owner: string | null): SyncState {
  const row = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(`todo-sync:${owner}`) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : { syncedAt: null, error: null, courses: [] };
}

function rows(): TodoRow[] {
  return hostPorts()
    .database()
    .prepare('SELECT * FROM todo_items WHERE owner=? OR owner=?')
    .all('local', sourceOwner() ?? '') as TodoRow[];
}

export function getTodoState(): TodoState {
  const owner = sourceOwner();
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

export function publishTodoState(): TodoState {
  const state = getTodoState();
  emit(todoContract, 'state', state);
  changeListener?.();
  return state;
}

export function saveTodo(input: TodoSaveInput): TodoState {
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
  hostPorts()
    .database()
    .prepare(
      "INSERT INTO todo_items(id, owner, data, read_at) VALUES (?, 'local', ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    )
    .run(item.id, JSON.stringify(item), now);
  return publishTodoState();
}

export function removeTodo(id: string): TodoState {
  hostPorts().database().prepare("DELETE FROM todo_items WHERE id=? AND owner='local'").run(id);
  return publishTodoState();
}

/** id 为 null 时标记全部已读。 */
export function markTodoRead(id: string | null): TodoState {
  hostPorts()
    .database()
    .prepare(
      'UPDATE todo_items SET read_at=COALESCE(read_at, ?) WHERE (owner=? OR owner=?) AND (? IS NULL OR id=?)',
    )
    .run(new Date().toISOString(), 'local', sourceOwner() ?? '', id, id);
  return publishTodoState();
}

export function todoNotifications(): TaskNotice[] {
  return rows()
    .filter((row) => row.notice_at !== null)
    .map((row) => {
      const item = JSON.parse(row.data) as TodoItem;
      return newTaskNotice(item.id, item.title, item.courseName, row.notice_at!, row.read_at);
    });
}

function newTaskNotice(
  id: string,
  title: string,
  courseName: string | undefined,
  createdAt: string,
  readAt: string | null,
): TaskNotice {
  return { todoId: id, title, body: `${courseName ?? 'Canvas'} · 新作业`, createdAt, readAt };
}

export function refreshTodos(): Promise<TodoState> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = syncTasks().then(
    () => {
      activeRefresh = null;
      return publishTodoState();
    },
    (error: unknown) => {
      activeRefresh = null;
      publishTodoState();
      throw error;
    },
  );
  publishTodoState();
  return activeRefresh;
}

async function syncTasks(): Promise<TodoState> {
  const owner = sourceOwner();
  if (!source || !owner) return getTodoState();
  const db = hostPorts().database();
  const previous = syncState(owner);
  const successful = new Set(previous.courses);
  const errors: string[] = [];
  try {
    const courses = await source.courses();
    for (const course of courses) {
      if (sourceOwner() !== owner) return getTodoState();
      try {
        const tasks = await source.tasks(owner, course);
        if (sourceOwner() !== owner) return getTodoState();
        const now = new Date().toISOString();
        const ids = new Set<string>();
        // 已同步过的课程新增作业（INSERT 且 notice_at=now）是通知产生时刻，弹系统桌面通知。
        const existingIds = new Set(
          (
            db
              .prepare(
                "SELECT id FROM todo_items WHERE owner=? AND json_extract(data, '$.courseId')=?",
              )
              .all(owner, course.id) as { id: string }[]
          ).map((row) => row.id),
        );
        const freshNotices: TodoItem[] = [];
        db.prepare('BEGIN').run();
        try {
          for (const item of tasks) {
            ids.add(item.id);
            // 已读与完成独立；更新状态时绝不重置 read_at 或生成第二条通知。
            db.prepare(
              'INSERT INTO todo_items(id, owner, data, read_at, notice_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
            ).run(
              item.id,
              owner,
              JSON.stringify(item),
              successful.has(course.id) ? null : now,
              successful.has(course.id) ? now : null,
            );
            if (successful.has(course.id) && !existingIds.has(item.id)) freshNotices.push(item);
          }
          const old = db
            .prepare(
              "SELECT id FROM todo_items WHERE owner=? AND json_extract(data, '$.courseId')=?",
            )
            .all(owner, course.id) as { id: string }[];
          for (const item of old)
            if (!ids.has(item.id)) db.prepare('DELETE FROM todo_items WHERE id=?').run(item.id);
          db.prepare('COMMIT').run();
        } catch (error) {
          db.prepare('ROLLBACK').run();
          throw error;
        }
        for (const item of freshNotices)
          noticeListener?.(newTaskNotice(item.id, item.title, course.name, now, null));
        successful.add(course.id);
      } catch (error) {
        errors.push(`${course.name}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (sourceOwner() === owner) {
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
