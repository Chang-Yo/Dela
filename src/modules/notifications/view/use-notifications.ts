import { useQuery } from '@tanstack/react-query';
import type { Navigate } from '../../../app/module';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import { notificationsContract, type NotificationItem, type NotificationTarget } from '../contract';

export const notificationsClient = createClient(notificationsContract, window.dela?.bridge);

export function notifyFailure(reason: unknown): void {
  showToast({ variant: 'error', title: '通知操作失败', description: errorMessage(reason) });
}

// 暂停到期不会有推送，按分钟重读，铃铛无需等待下一次刷新即可恢复。
export function useNotificationState() {
  return useQuery({
    queryKey: ['notifications', 'state'],
    queryFn: () => notificationsClient.state(),
    refetchInterval: 60_000,
  });
}

/** 铃铛的未读数受暂停影响；TODO 新消息数不受影响，暂停只静音铃铛。 */
export function useNotificationCounts() {
  const { data } = useNotificationState();
  return {
    count: data?.snoozedUntil ? 0 : (data?.unreadCount ?? 0),
    todoUnread: data?.items.filter((item) => item.source === 'todo' && !item.readAt).length ?? 0,
  };
}

export function openTarget(target: NotificationTarget, navigate: Navigate): boolean {
  if (!('url' in target)) return navigate(target);
  window.open(target.url);
  return true;
}

export function openNotification(
  item: Pick<NotificationItem, 'id' | 'target' | 'readAt'>,
  navigate: Navigate,
): void {
  if (openTarget(item.target, navigate) && !item.readAt)
    void notificationsClient.markRead(item.id).catch(notifyFailure);
}
