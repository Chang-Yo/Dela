// Run 终态的系统提醒入口（§4.4 任务通知）：由 agent/session/manager 在 finishRun 后调用。
// 偏好读取失败或 Electron 通知不可用都不影响 Run 终态落库与推送。
import { getDatabase } from '../database';
import { systemNotifyToast } from '../notifications/system';
import { getTaskNotificationPrefs } from './prefs';

/** completed/failed 按各自偏好提醒；stopped 为用户主动停止，不打扰。 */
export function notifyRunFinished(sessionId: string, status: 'completed' | 'failed'): void {
  try {
    const prefs = getTaskNotificationPrefs();
    if (status === 'completed' && !prefs.completed) return;
    if (status === 'failed' && !prefs.failed) return;
    const row = getDatabase().prepare('SELECT title FROM sessions WHERE id=?').get(sessionId) as
      { title: string } | undefined;
    const title = status === 'completed' ? '任务完成' : '任务失败';
    systemNotifyToast(title, row?.title ?? 'Dela 会话');
  } catch {
    // 通知属于尽力而为：任何读取/弹出失败都静默，不掩盖执行结果本身。
  }
}
