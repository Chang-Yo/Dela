// Run 终态的系统提醒入口：由 core/agent/session/run 在 Run 结束后经 hostPorts().notifier 调用。
// 偏好读取失败或系统通知不可用都不影响 Run 终态落库与推送。
import { row } from '../../../core/agent/session/store';
import { systemNotifyToast } from '../../notifications';
import { getTaskNotificationPrefs } from './prefs';

export function notifyRunFinished(sessionId: string, status: 'completed' | 'failed'): void {
  try {
    const prefs = getTaskNotificationPrefs();
    if (status === 'completed' && !prefs.completed) return;
    if (status === 'failed' && !prefs.failed) return;
    const title = status === 'completed' ? '任务完成' : '任务失败';
    systemNotifyToast(title, row(sessionId).title);
  } catch {
    // 通知属于尽力而为：任何读取/弹出失败都静默，不掩盖执行结果本身。
  }
}
