// 通知中心：汇总各来源（经 registerNoticeSource 注册）与待办的提醒，状态以 notifications:state 推送。
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { onTaskNotice, onTodoChange } from '../todo';
import { notificationsContract } from './contract';
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationState,
  publishNotificationState,
  refreshNotifications,
  setNotificationSnooze,
  todoItem,
} from './main/store';
import { messageAlertsEnabled, setMessageAlerts, showMessageNotice } from './main/system';

export {
  existingNotifications,
  publishNotificationState,
  registerNoticeSource,
  saveNotificationRefresh,
  systemNotifyItem,
  upsertNotification,
  type NoticeLink,
  type NoticeSource,
  type StoredNotice,
} from './main/store';
export { systemNotifyToast } from './main/system';

// 来源各自节流，这里两分钟轮询一次。
const REFRESH_MS = 2 * 60_000;

function refreshInBackground() {
  void refreshNotifications().catch((error: unknown) =>
    console.error('Notification refresh failed', error),
  );
}

export const notificationsModule = defineModule({
  id: 'notifications',
  ipc: implement(notificationsContract, {
    state: notificationState,
    refresh: () => refreshNotifications(true),
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
    setSnooze: setNotificationSnooze,
    messageAlerts: messageAlertsEnabled,
    setMessageAlerts,
  }),
  register() {
    onTaskNotice((notice) => {
      const item = todoItem(notice);
      showMessageNotice(item.id, item.title, '', item.target);
    });
    onTodoChange(() => void publishNotificationState());
  },
  start() {
    refreshInBackground();
    const timer = setInterval(refreshInBackground, REFRESH_MS);
    return () => clearInterval(timer);
  },
});
