import { hostPorts } from '../../../core/ports';
import {
  existingNotifications,
  saveNotificationRefresh,
  systemNotifyItem,
  upsertNotification,
  type NoticeSource,
} from '../../../modules/notifications';
import { listCanvasAnnouncements, listTodoCanvasCourses } from './api';
import { canvasOwner } from './todo-source';

let nextCheckAt = 0;

export const canvasNoticeSource: NoticeSource = {
  id: 'canvas',
  account: canvasOwner,
  async refresh(key, force) {
    if (!force && Date.now() < nextCheckAt) return;
    nextCheckAt = Date.now() + 20 * 60_000;
    const db = hostPorts().database();
    // 按课程记录首次成功同步：新学期新增课程的存量公告与首次同步一样只进列表，不弹系统通知。
    const knownKey = `canvas-announcement-courses:${key}`;
    const saved = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(knownKey) as
      | { value: string }
      | undefined;
    const known = new Set<number>(saved ? JSON.parse(saved.value) : []);
    const errors: string[] = [];
    const existing = existingNotifications('canvas', key);
    const syncedAt = new Date().toISOString();
    // 逐课顺序请求，避免并发轰炸 Canvas；单门课失败不影响其余课程。
    for (const course of await listTodoCanvasCourses()) {
      try {
        for (const announcement of await listCanvasAnnouncements(course.id)) {
          const id = `canvas:${key}:${announcement.sourceId}`;
          const createdAt = announcement.postedAt || syncedAt;
          const href = { kind: 'canvas', sourceId: announcement.sourceId };
          // Canvas 网页端读过的公告同步为已读；Dela 内标记已读只记在本地，不回写 Canvas。
          upsertNotification(
            'canvas',
            key,
            id,
            announcement.title,
            course.name,
            createdAt,
            href,
            null,
            1,
            announcement.read ? syncedAt : null,
          );
          if (!known.has(course.id) || announcement.read || existing.has(id)) continue;
          systemNotifyItem({ id, source: 'canvas', title: announcement.title, href }, course.name);
        }
        known.add(course.id);
      } catch (error) {
        errors.push(`${course.name}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    db.prepare('INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)').run(
      knownKey,
      JSON.stringify([...known]),
    );
    saveNotificationRefresh('canvas', key, errors.length ? errors.join('\n') : null);
  },
  link: ({ sourceId }) =>
    typeof sourceId === 'string' ? { target: { page: 'sources', sourceId } } : null,
};
