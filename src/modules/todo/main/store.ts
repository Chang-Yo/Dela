import { randomUUID } from 'node:crypto';
import { emit, hostPorts } from '../../../core/ports';
import {
  todoContract,
  todoSaveSchema,
  todoTimeRange,
  type TodoGroup,
  type TodoItem,
  type TodoSaveInput,
  type TodoState,
} from '../contract';

/** 来源提供的条目：只含来源知道的内容，条目 id 由待办拼上来源与账号生成。 */
export type SourceTask = Pick<
  TodoItem,
  'title' | 'time' | 'status' | 'statusLabel' | 'completedAt' | 'url' | 'bodyHtml' | 'createdAt'
> & { externalId: string };

/** 外部来源（如 Canvas 作业）。按分组逐个同步，一组失败不影响其他组。 */
export interface TaskSource {
  id: string;
  /** 筛选标签与通知里的名字，例如「Canvas 作业」。 */
  label: string;
  /** 打开条目原页面的按钮文字，例如「在 Canvas 中打开」。 */
  openLabel?: string;
  /** 当前账号的指纹，未登录时为 null；换账号后旧账号的条目不再显示。 */
  owner(): string | null;
  groups(): Promise<TodoGroup[]>;
  tasks(group: TodoGroup): Promise<SourceTask[]>;
}

type TodoRow = {
  id: string;
  owner: string;
  data: string;
  read_at: string | null;
  notice_at: string | null;
};
type SyncState = { syncedAt: string | null; error: string | null; groups: string[] };
export interface TaskNotice {
  todoId: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

const sources = new Map<string, TaskSource>();
let noticeListener: ((notice: TaskNotice) => void) | null = null;
let changeListener: (() => void) | null = null;
let activeRefresh: Promise<TodoState> | null = null;

export function registerTaskSource(next: TaskSource): void {
  sources.set(next.id, next);
}

export function onTaskNotice(listener: (notice: TaskNotice) => void): void {
  noticeListener = listener;
}

export function onTodoChange(listener: () => void): void {
  changeListener = listener;
}

function syncKey(source: TaskSource, owner: string) {
  return `todo-sync:${source.id}:${owner}`;
}

function syncState(source: TaskSource, owner: string): SyncState {
  const row = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(syncKey(source, owner)) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : { syncedAt: null, error: null, groups: [] };
}

function owners(): string[] {
  return ['local', ...[...sources.values()].flatMap((source) => source.owner() ?? [])];
}

const ownerIn = (list: string[]) => `owner IN (${list.map(() => '?').join(',')})`;

function rows(): TodoRow[] {
  const list = owners();
  return hostPorts()
    .database()
    .prepare(`SELECT * FROM todo_items WHERE ${ownerIn(list)}`)
    .all(...list) as TodoRow[];
}

const startsAt = (item: TodoItem) => (item.time ? todoTimeRange(item.time)[0] : Infinity);

export function getTodoState(): TodoState {
  return {
    items: rows()
      .map((row) => ({ ...JSON.parse(row.data), readAt: row.read_at }) as TodoItem)
      .sort((a, b) => startsAt(a) - startsAt(b) || a.title.localeCompare(b.title)),
    sources: [...sources.values()].map((source) => {
      const owner = source.owner();
      const sync = owner ? syncState(source, owner) : null;
      return {
        id: source.id,
        label: source.label,
        openLabel: source.openLabel,
        connected: owner !== null,
        syncedAt: sync?.syncedAt ?? null,
        error: sync?.error ?? null,
      };
    }),
    syncing: activeRefresh !== null,
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
  if (value.id && !existing) throw new Error('待办不存在，外部来源的条目只能通过同步更新');
  const old = existing ? (JSON.parse(existing.data) as TodoItem) : undefined;
  const now = new Date().toISOString();
  const status =
    value.completed === undefined ? (old?.status ?? 'open') : value.completed ? 'done' : 'open';
  const item: TodoItem = {
    id: value.id ?? randomUUID(),
    source: 'personal',
    title: value.title,
    notes: value.notes ?? old?.notes ?? '',
    time: value.time === undefined ? (old?.time ?? null) : value.time,
    status,
    completedAt: status === 'done' ? (old?.completedAt ?? now) : null,
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

export function markTodoRead(id: string | null): TodoState {
  const list = owners();
  hostPorts()
    .database()
    .prepare(
      `UPDATE todo_items SET read_at=COALESCE(read_at, ?) WHERE ${ownerIn(list)} AND (? IS NULL OR id=?)`,
    )
    .run(new Date().toISOString(), ...list, id, id);
  return publishTodoState();
}

export function todoNotifications(): TaskNotice[] {
  return rows().flatMap((row) => {
    const item = JSON.parse(row.data) as TodoItem;
    const source = sources.get(item.source);
    if (row.notice_at === null || !source) return [];
    return [newTaskNotice(item, source, row.notice_at, row.read_at)];
  });
}

function newTaskNotice(
  item: TodoItem,
  source: TaskSource,
  createdAt: string,
  readAt: string | null,
): TaskNotice {
  const body = item.group ? `${source.label} · ${item.group.label}` : source.label;
  return { todoId: item.id, title: item.title, body, createdAt, readAt };
}

export function refreshTodos(): Promise<TodoState> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = (async () => {
    for (const source of sources.values()) await syncSource(source);
  })().then(
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

async function syncSource(source: TaskSource): Promise<void> {
  const owner = source.owner();
  if (!owner) return;
  const db = hostPorts().database();
  const previous = syncState(source, owner);
  const successful = new Set(previous.groups);
  const errors: string[] = [];
  const groupIds = db.prepare(
    "SELECT id FROM todo_items WHERE owner=? AND json_extract(data, '$.source')=? AND json_extract(data, '$.group.id')=?",
  );
  try {
    for (const group of await source.groups()) {
      if (source.owner() !== owner) return;
      try {
        const tasks = await source.tasks(group);
        if (source.owner() !== owner) return;
        const now = new Date().toISOString();
        const synced = successful.has(group.id);
        const existingIds = new Set(
          (groupIds.all(owner, source.id, group.id) as { id: string }[]).map((row) => row.id),
        );
        const ids = new Set<string>();
        // 已同步过的分组出现新条目（INSERT 且 notice_at=now）是通知产生时刻，弹系统桌面通知。
        const freshNotices: TodoItem[] = [];
        db.prepare('BEGIN').run();
        try {
          for (const { externalId, ...task } of tasks) {
            const item: TodoItem = {
              ...task,
              id: `${source.id}:${owner}:${externalId}`,
              source: source.id,
              notes: '',
              group,
              readAt: null,
              syncedAt: now,
            };
            ids.add(item.id);
            // 已读与完成独立；更新状态时绝不重置 read_at 或生成第二条通知。
            db.prepare(
              'INSERT INTO todo_items(id, owner, data, read_at, notice_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
            ).run(item.id, owner, JSON.stringify(item), synced ? null : now, synced ? now : null);
            if (synced && !existingIds.has(item.id)) freshNotices.push(item);
          }
          for (const id of existingIds)
            if (!ids.has(id)) db.prepare('DELETE FROM todo_items WHERE id=?').run(id);
          db.prepare('COMMIT').run();
        } catch (error) {
          db.prepare('ROLLBACK').run();
          throw error;
        }
        for (const item of freshNotices) noticeListener?.(newTaskNotice(item, source, now, null));
        successful.add(group.id);
      } catch (error) {
        errors.push(`${group.label}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (source.owner() === owner) {
    db.prepare('INSERT OR REPLACE INTO workspace_settings(key, value) VALUES (?, ?)').run(
      syncKey(source, owner),
      JSON.stringify({
        syncedAt: errors.length ? previous.syncedAt : new Date().toISOString(),
        error: errors.join('\n') || null,
        groups: [...successful],
      } satisfies SyncState),
    );
  }
}
