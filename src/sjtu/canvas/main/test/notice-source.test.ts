import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../modules/todo', () => ({
  getTodoState: () => ({ items: [], sources: [], syncing: false }),
  todoSyncedAt: () => null,
  todoSyncError: () => null,
  todoNotifications: () => [],
}));
vi.mock('../../../../modules/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../modules/notifications')>()),
  systemNotifyItem: vi.fn(),
}));
vi.mock('../todo-source', () => ({ canvasOwner: () => 'owner' }));
vi.mock('../api', () => ({ listTodoCanvasCourses: vi.fn(), listCanvasAnnouncements: vi.fn() }));

import { provideTestHostPorts } from '../../../../core/test/host-mock';
import {
  notificationsModule,
  registerNoticeSource,
  systemNotifyItem,
} from '../../../../modules/notifications';
import type { NotificationState } from '../../../../modules/notifications/contract';
import { listCanvasAnnouncements, listTodoCanvasCourses } from '../api';
import { canvasNoticeSource } from '../notice-source';

registerNoticeSource(canvasNoticeSource);
const ipc = notificationsModule.ipc!;
const getNotificationState = (sources?: string[]) =>
  ipc.call('state', sources) as NotificationState;
const refreshNotifications = () => ipc.call('refresh', undefined) as Promise<NotificationState>;

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const table of notificationsModule.schema!.tables) db.exec(table);
  return db;
}

describe('Canvas notice source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const db = createDb();
    provideTestHostPorts({ database: () => db as never });
  });

  it('lists existing announcements silently on first sync and toasts later unread ones', async () => {
    vi.mocked(listTodoCanvasCourses).mockResolvedValue([{ id: 1, name: '操作系统' }]);
    const announcement = (id: number, read: boolean) => ({
      sourceId: `canvas-discussion:1:${id}`,
      title: `公告 ${id}`,
      postedAt: `2026-09-1${id}T00:00:00.000Z`,
      read,
    });
    vi.mocked(listCanvasAnnouncements).mockResolvedValueOnce([
      announcement(1, true),
      announcement(2, false),
    ]);

    await refreshNotifications();
    expect(getNotificationState(['canvas'])).toMatchObject({ totalCount: 2, unreadCount: 1 });
    expect(systemNotifyItem).not.toHaveBeenCalled();

    vi.mocked(listCanvasAnnouncements).mockResolvedValueOnce([
      announcement(3, false),
      announcement(2, false),
      announcement(1, true),
    ]);
    await refreshNotifications();
    expect(systemNotifyItem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(systemNotifyItem).mock.calls[0]).toEqual([
      {
        id: 'canvas:owner:canvas-discussion:1:3',
        source: 'canvas',
        title: '公告 3',
        href: { kind: 'canvas', sourceId: 'canvas-discussion:1:3' },
      },
      '操作系统',
    ]);
  });

  it('baselines courses one by one and keeps syncing past a failing course', async () => {
    const course = (id: number) => ({ id, name: `课程 ${id}` });
    const announcement = (courseId: number, id: number) => ({
      sourceId: `canvas-discussion:${courseId}:${id}`,
      title: `公告 ${id}`,
      postedAt: '2026-09-10T00:00:00.000Z',
      read: false,
    });
    vi.mocked(listTodoCanvasCourses).mockResolvedValueOnce([course(1)]);
    vi.mocked(listCanvasAnnouncements).mockResolvedValueOnce([announcement(1, 1)]);
    await refreshNotifications();

    // 新学期加入课程 2（存量公告）与课程 3（请求失败），课程 1 有新公告。
    vi.mocked(listTodoCanvasCourses).mockResolvedValueOnce([course(3), course(2), course(1)]);
    vi.mocked(listCanvasAnnouncements)
      .mockRejectedValueOnce(new Error('令牌失效或无权访问此内容'))
      .mockResolvedValueOnce([announcement(2, 5)])
      .mockResolvedValueOnce([announcement(1, 2), announcement(1, 1)]);
    await refreshNotifications();

    expect(vi.mocked(systemNotifyItem).mock.calls.map(([item]) => item.id)).toEqual([
      'canvas:owner:canvas-discussion:1:2',
    ]);
    expect(getNotificationState(['canvas'])).toMatchObject({
      totalCount: 3,
      refresh: { canvas: { error: '课程 3：令牌失效或无权访问此内容' } },
    });
  });
});
