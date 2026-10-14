import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../credentials', () => ({ loadCanvasToken: vi.fn(() => 'test-token') }));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../canvas/api', () => ({
  listTodoCanvasCourses: vi.fn(),
  listTodoCanvasAssignments: vi.fn(),
}));
import { getDatabase } from '../../database';
import { loadCanvasToken } from '../../credentials';
import { listTodoCanvasAssignments, listTodoCanvasCourses } from '../../canvas/api';
import {
  getTodoState,
  markTodoRead,
  refreshTodos,
  removeTodo,
  saveTodo,
  todoNotifications,
} from '..';

let db: DatabaseSync;
const assignment = (id: number, submission = { workflow_state: 'unsubmitted' }) => ({
  id,
  name: `作业 ${id}`,
  submission,
  due_at: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCanvasToken).mockReturnValue('test-token');
  db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE todo_items (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, read_at TEXT, notice_at TEXT); CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  );
  vi.mocked(getDatabase).mockReturnValue({
    prepare: (sql: string) => db.prepare(sql),
    transaction: (fn: () => void) => () => {
      db.exec('BEGIN');
      try {
        fn();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as ReturnType<typeof getDatabase>);
  vi.mocked(listTodoCanvasCourses).mockResolvedValue([{ id: 1, name: '测试课程' }]);
  vi.mocked(listTodoCanvasAssignments).mockResolvedValue([assignment(1)]);
});
afterEach(() => db.close());

describe('TODO 持久化与同步', () => {
  it('历史导入不刷屏，新作业只通知一次，已读不会改变完成状态', async () => {
    await refreshTodos();
    expect(todoNotifications()).toHaveLength(0);
    vi.mocked(listTodoCanvasAssignments).mockResolvedValue([assignment(1), assignment(2)]);
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
  it('远端完成不意味着本地已读', async () => {
    await refreshTodos();
    vi.mocked(listTodoCanvasAssignments).mockResolvedValue([assignment(1), assignment(2)]);
    await refreshTodos();
    vi.mocked(listTodoCanvasAssignments).mockResolvedValue([
      assignment(1),
      assignment(2, { workflow_state: 'submitted' }),
    ]);
    await refreshTodos();
    expect(getTodoState().items.find((item) => item.assignmentId === 2)).toMatchObject({
      status: 'submitted',
      readAt: null,
    });
  });
  it('失败保留旧缓存并报告错误，成功的空列表才移除已消失作业', async () => {
    await refreshTodos();
    vi.mocked(listTodoCanvasAssignments).mockRejectedValueOnce(new Error('离线'));
    await refreshTodos();
    expect(getTodoState().items).toHaveLength(1);
    expect(getTodoState().error).toContain('离线');
    vi.mocked(listTodoCanvasAssignments).mockResolvedValue([]);
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
    expect(() => saveTodo({ title: '非法颜色', color: 'nope' })).toThrow();
  });
  it('切换或断开令牌不显示之前账号的作业和通知', async () => {
    await refreshTodos();
    vi.mocked(loadCanvasToken).mockReturnValue(null);
    expect(getTodoState().items).toHaveLength(0);
    expect(todoNotifications()).toHaveLength(0);
  });
  it('重叠刷新共用一次网络请求', async () => {
    await Promise.all([refreshTodos(), refreshTodos()]);
    expect(listTodoCanvasAssignments).toHaveBeenCalledTimes(1);
  });
});
