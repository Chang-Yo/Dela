// 通知中心：汇总各来源（经 registerNoticeSource 注册）与待办的提醒，状态以 notifications:state 推送。
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { onTaskNotice, onTodoChange } from '../todo';
import { notificationsContract } from './contract';
import { notificationsSchema } from './data/schema';
import {
  addNoticeSubscription,
  listNoticeSubscriptions,
  noticeSubscriptionsEnabled,
  previewNoticeSubscription,
  removeNoticeSubscription,
  setNoticeSubscriptionsEnabled,
  websiteNoticeSource,
} from './main/notices';
import {
  listBuiltInSubscriptions,
  markAllNotificationsRead,
  markNotificationRead,
  notificationState,
  publishNotificationState,
  registerNoticeSource,
  refreshNotifications,
  setBuiltInSubscription,
  setNotificationSnooze,
  todoItem,
} from './main/store';
import { messageAlertsEnabled, setMessageAlerts, showMessageNotice } from './main/system';

export {
  deleteNotifications,
  existingNotifications,
  insertNotificationIfAbsent,
  markNotificationsRead,
  publishNotificationState,
  registerNoticeSource,
  saveNotificationRefresh,
  setNotificationsRead,
  storedNotice,
  storedNotifications,
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
  schema: notificationsSchema,
  ipc: implement(notificationsContract, {
    state: notificationState,
    refresh: () => refreshNotifications(true),
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
    setSnooze: setNotificationSnooze,
    subscriptions: () => ({
      experimental: noticeSubscriptionsEnabled(),
      builtIn: listBuiltInSubscriptions(),
      notices: noticeSubscriptionsEnabled() ? listNoticeSubscriptions() : [],
    }),
    setNoticeSubscriptionsEnabled: (enabled) => {
      setNoticeSubscriptionsEnabled(enabled);
      return publishNotificationState();
    },
    setBuiltInSubscription: ({ id, enabled }) => {
      setBuiltInSubscription(id, enabled);
      return publishNotificationState();
    },
    previewNoticeSubscription: ({ url, sampleTitle, render }) =>
      previewNoticeSubscription(url, sampleTitle, render),
    addNoticeSubscription: ({ token, candidate }) => {
      addNoticeSubscription(token, candidate);
      return publishNotificationState();
    },
    removeNoticeSubscription: (id) => {
      removeNoticeSubscription(id);
      return publishNotificationState();
    },
    messageAlerts: messageAlertsEnabled,
    setMessageAlerts,
  }),
  register() {
    registerNoticeSource(websiteNoticeSource);
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
