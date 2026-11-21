import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoStatus } from '../contract';

const database = vi.hoisted(() => vi.fn());
vi.mock('../../../core/ports', () => ({ emit: vi.fn(), hostPorts: () => ({ database }) }));
import {
  getTodoState,
  markTodoRead,
  refreshTodos,
  registerTaskSource,
  removeTodo,
  saveTodo,
  todoNotifications,
  type SourceTask,
} from '../main/store';

let db: DatabaseSync;
let tasks: SourceTask[];
const group = { id: '1', label: '测试课程' };
const task = (id: number, status: TodoStatus = 'open'): SourceTask => ({
  externalId: String(id),
  title: '作业 ' + id,
  dueAt: null,
  status,
  completedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
});
const source = {
  id: 'canvas',
  label: 'Canvas 作业',
  owner: vi.fn<() => string | null>(),
  groups: vi.fn(async () => [group]),
  tasks: vi.fn(async () => tasks),
};
const other = {
  id: 'other',
  label: '其他来源',
  owner: vi.fn<() => string | null>(),
  groups: vi.fn(async () => [{ id: 'g', label: '分组' }]),
  tasks: vi.fn(async (): Promise<SourceTask[]> => [{ ...task(9), title: '其他条目' }]),
};
registerTaskSource(source);
registerTaskSource(other);
const item = (id: number) => getTodoState().items.find((row) => row.id === `canvas:owner:${id}`)!;
beforeEach(() => {
  vi.clearAllMocks();
  source.owner.mockReturnValue('owner');
  other.owner.mockReturnValue(null);
  tasks = [task(1)];
  db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE todo_items (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, read_at TEXT, notice_at TEXT); CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  );
  database.mockReturnValue(db);
});
afterEach(() => db.close());

describe('TODO 持久化与同步', () => {
  it('历史导入不刷屏，新条目只通知一次，已读不会改变完成状态', async () => {
    await refreshTodos();
    expect(todoNotifications()).toHaveLength(0);
    tasks = [task(1), task(2)];
    await refreshTodos();
    const notice = todoNotifications()[0]!;
    expect(notice).toMatchObject({ readAt: null, body: 'Canvas 作业 · 测试课程' });
    markTodoRead(item(2).id);
    await refreshTodos();
    expect(todoNotifications()).toHaveLength(1);
    expect(todoNotifications()[0]!.readAt).not.toBeNull();
    expect(item(2)).toMatchObject({ status: 'open', source: 'canvas', group });
    expect(getTodoState().syncing).toBe(false);
  });
  it('远端完成不意味着本地已读', async () => {
    await refreshTodos();
    tasks = [task(1), task(2)];
    await refreshTodos();
    tasks = [task(1), task(2, 'done')];
    await refreshTodos();
    expect(item(2)).toMatchObject({ status: 'done', readAt: null });
  });
  it('失败保留旧缓存并报告错误，成功的空列表才移除已消失条目', async () => {
    await refreshTodos();
    source.tasks.mockRejectedValueOnce(new Error('离线'));
    await refreshTodos();
    expect(getTodoState().items).toHaveLength(1);
    expect(getTodoState().sources[0]!.error).toContain('离线');
    tasks = [];
    await refreshTodos();
    expect(getTodoState().items).toHaveLength(0);
  });
  it('个人待办可编辑、完成、重开和删除，不能手动完成来源的条目', async () => {
    const saved = saveTodo({ title: '准备报告' }).items[0]!;
    saveTodo({ id: saved.id, title: '准备报告', completed: true });
    expect(getTodoState().items[0]).toMatchObject({ status: 'done' });
    expect(getTodoState().items[0]!.completedAt).not.toBeNull();
    saveTodo({ id: saved.id, title: '报告', notes: '补图', completed: false });
    expect(getTodoState().items[0]).toMatchObject({
      title: '报告',
      notes: '补图',
      status: 'open',
      completedAt: null,
    });
    await refreshTodos();
    expect(() => saveTodo({ id: item(1).id, title: '错误', completed: true })).toThrow();
    removeTodo(saved.id);
    expect(getTodoState().items).toHaveLength(1);
  });
  it('写入日历标记与颜色随待办保存，完成等局部更新不会丢失', () => {
    const saved = saveTodo({
      title: '准备报告',
      dueAt: '2026-09-22T10:00:00.000Z',
      calendar: true,
      color: 'rose',
    }).items[0]!;
    expect(saved).toMatchObject({ calendar: true, color: 'rose' });
    saveTodo({ id: saved.id, title: '准备报告', completed: true });
    expect(getTodoState().items[0]).toMatchObject({
      calendar: true,
      color: 'rose',
      status: 'done',
    });
    expect(() => saveTodo({ title: '非法颜色', color: 'nope' as 'rose' })).toThrow();
  });
  it('多个来源并存，断开一个只隐藏它自己的条目和通知', async () => {
    other.owner.mockReturnValue('someone');
    await refreshTodos();
    expect(getTodoState().items.map((row) => row.title)).toEqual(['作业 1', '其他条目']);
    source.owner.mockReturnValue(null);
    expect(getTodoState().items.map((row) => row.title)).toEqual(['其他条目']);
    expect(todoNotifications()).toHaveLength(0);
    expect(getTodoState().sources.map((row) => row.connected)).toEqual([false, true]);
  });
  it('重叠刷新共用一次网络请求', async () => {
    await Promise.all([refreshTodos(), refreshTodos()]);
    expect(source.tasks).toHaveBeenCalledTimes(1);
  });
});
