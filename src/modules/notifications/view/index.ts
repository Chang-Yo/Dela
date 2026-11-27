// 通知中心的渲染端出口：页面由清单汇总各模块的来源后生成，铃铛计数给外壳用。
import { Globe } from 'lucide-react';
import { defineView, type NoticeKind } from '../../../app/module';
import { subscribe } from '../../../core/protocol/contract';
import { notificationsContract } from '../contract';
import { notificationsPage } from './NotificationsView';
import { openNotification } from './use-notifications';

export {
  notificationsClient,
  useNotificationCounts,
  useNotificationState,
  useNotificationSubscriptions,
} from './use-notifications';

export function notificationsView(kinds: Record<string, NoticeKind>) {
  return defineView({
    pages: {
      notifications: {
        component: notificationsPage({ ...kinds, notice: { label: '官网公告', icon: Globe } }),
      },
    },
    start(navigate) {
      // 主进程已唤起并聚焦窗口，这里沿用通知列表的跳转与已读。
      subscribe(notificationsContract, window.dela?.bridge, 'open', ({ id, target }) =>
        openNotification({ id, target, readAt: null }, navigate),
      );
    },
  });
}
