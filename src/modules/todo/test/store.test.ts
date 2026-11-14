import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem, TodoStatus } from '../contract';

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
} from '../main/store';

let db: DatabaseSync;
let tasks: TodoItem[];
const course = { id: 1, name: '测试课程', code: 'TEST101' };
const task = (id: number, status: TodoStatus = 'pending'): TodoItem => ({
  id: 'canvas:owner:1:' + id,
  source: 'canvas',
  assignmentId: id,
  courseId: course.id,
  courseCode: course.code,
  courseName: course.name,
  title: '作业 ' + id,
  notes: '',
  dueAt: null,
  status,
  createdAt: '2026-09-01T00:00:00.000Z',
  readAt: null,
});
const source = {
  owner: vi.fn<() => string | null>(),
  courses: vi.fn(async () => [course]),
  tasks: vi.fn(async () => tasks),
};
registerTaskSource(source);
beforeEach(() => {
  vi.clearAllMocks();
  source.owner.mockReturnValue('owner');
  tasks = [task(1)];
  db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE todo_items (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, read_at TEXT, notice_at TEXT); CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  );
  database.mockReturnValue(db);
});
afterEach(() => db.close());

describe('TODO 持久化与同步', () => {
  it('历史导入不刷屏，新作业只通知一次，已读不会改变完成状态', async () => {
    await refreshTodos();
    expect(todoNotifications()).toHaveLength(0);
    tasks = [task(1), task(2)];
    await refreshTodos();
    const notice = todoNotifications()[0]!;
    expect(notice.readAt).toBeNull();
    const item = getTodoState().items.find((item) => item.assignmentId === 2)!;
    markTodoRead(item.id);
    await refreshTodos();
    expect(todoNotifications()).toHaveLength(1);
    expect(todoNotifications()[0]!.readAt).not.toBeNull();
    expect(getTodoState().items.find((row) => row.id === item.id)!.status).toBe('pending');
    expect(getTodoState().syncing).toBe(false);
  });
  it('来源的作业保存课程代码，供日历与课表使用同一配色键', async () => {
    await refreshTodos();
    expect(getTodoState().items.find((item) => item.source === 'canvas')).toMatchObject({
      courseCode: 'TEST101',
      courseName: '测试课程',
    });
  });
  it('远端完成不意味着本地已读', async () => {
    await refreshTodos();
    tasks = [task(1), task(2)];
    await refreshTodos();
    tasks = [task(1), task(2, 'submitted')];
    await refreshTodos();
    expect(getTodoState().items.find((item) => item.assignmentId === 2)).toMatchObject({
      status: 'submitted',
      readAt: null,
    });
  });
  it('失败保留旧缓存并报告错误，成功的空列表才移除已消失作业', async () => {
    await refreshTodos();
    source.tasks.mockRejectedValueOnce(new Error('离线'));
    await refreshTodos();
    expect(getTodoState().items).toHaveLength(1);
    expect(getTodoState().error).toContain('离线');
    tasks = [];
    await refreshTodos();
    expect(getTodoState().items).toHaveLength(0);
  });
  it('个人待办可编辑、完成、重开和删除，不能手动完成 Canvas 作业', async () => {
    const item = saveTodo({ title: '准备报告' }).items[0]!;
    saveTodo({ id: item.id, title: '准备报告', completed: true });
    expect(getTodoState().items[0]!.status).toBe('completed');
    saveTodo({ id: item.id, title: '报告', notes: '补图', completed: false });
    expect(getTodoState().items[0]).toMatchObject({
      title: '报告',
      notes: '补图',
      status: 'pending',
    });
    await refreshTodos();
    const canvas = getTodoState().items.find((item) => item.source === 'canvas')!;
    expect(() => saveTodo({ id: canvas.id, title: '错误', completed: true })).toThrow();
    removeTodo(item.id);
    expect(getTodoState().items).toHaveLength(1);
  });
  it('写入日历标记与颜色随待办保存，完成等局部更新不会丢失', () => {
    const item = saveTodo({
      title: '准备报告',
      dueAt: '2026-09-22T10:00:00.000Z',
      calendar: true,
      color: 'rose',
    }).items[0]!;
    expect(item).toMatchObject({ calendar: true, color: 'rose' });
    saveTodo({ id: item.id, title: '准备报告', completed: true });
    expect(getTodoState().items[0]).toMatchObject({
      calendar: true,
      color: 'rose',
      status: 'completed',
    });
    expect(() => saveTodo({ title: '非法颜色', color: 'nope' as 'rose' })).toThrow();
  });
  it('切换或断开账号不显示之前账号的作业和通知', async () => {
    await refreshTodos();
    source.owner.mockReturnValue(null);
    expect(getTodoState().items).toHaveLength(0);
    expect(todoNotifications()).toHaveLength(0);
  });
  it('重叠刷新共用一次网络请求', async () => {
    await Promise.all([refreshTodos(), refreshTodos()]);
    expect(source.tasks).toHaveBeenCalledTimes(1);
  });
});
