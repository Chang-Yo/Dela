// 通知镜像订阅与跳转（迁移自旧 App.tsx 通知段）：镜像状态供通知中心与铃铛计数，
// 跳转经 app/navigation 的定位脉冲分发。
import { useEffect, useRef, useState } from 'react';
import type { NotificationItem, NotificationState } from '../../shared/api';
import { leaveComposer } from '../features/mail/compose-close';
import { errorText } from '../workspace/store';
import { useNavigationStore } from './navigation';

/** active 对应旧 launchStage 门控：'flow' 阶段不订阅（主界面未挂载），其余阶段镜像就绪。 */
export function useNotifications(active: boolean) {
  const [notifications, setNotifications] = useState<NotificationState | null>(null);
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const api = window.dela?.notifications;
    if (!api) return;
    let alive = true;
    let version = 0;
    const unsubscribe = api.onUpdate((state) => {
      version += 1;
      setNow(Date.now);
      if (alive) setNotifications(state);
    });
    const unsubscribeTodos = window.dela?.todo.onUpdate(() => {
      const requested = ++version;
      void api
        .getState()
        .then((state) => {
          if (alive && requested === version) setNotifications(state);
        })
        .catch((cause: unknown) => {
          if (alive) setError(errorText(cause));
        });
    });
    void api
      .getState()
      .then((state) => {
        if (alive && version === 0) setNotifications(state);
      })
      .catch((cause) => {
        if (alive) setError(errorText(cause));
      });
    // 暂停到期时重新读取，使铃铛无需等待下一次网络刷新即可恢复。
    const timer = window.setInterval(() => {
      setNow(Date.now);
      const requested = version;
      void api
        .getState()
        .then((state) => {
          if (alive && version === requested) setNotifications(state);
        })
        .catch(() => {});
    }, 60_000);
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeTodos?.();
      window.clearInterval(timer);
    };
  }, [active]);

  const run = async (action: () => Promise<NotificationState>) => {
    setLoading(true);
    setError(null);
    try {
      setNotifications(await action());
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const openNotification = (item: NotificationItem) => {
    if (!leaveComposer(() => openNotification(item))) return;
    const target = item.href;
    const navigation = useNavigationStore.getState();
    if (target.kind === 'todo') navigation.openTodo(target.todoId);
    else if (target.kind === 'mail') navigation.openMail(target.messageId);
    else navigation.openShuiyuanTopic(target.topicId, target.postNumber ?? undefined);
    if (!item.readAt && window.dela?.notifications) {
      void run(() => window.dela!.notifications.markRead(item.id));
    }
  };

  // 系统桌面通知点击：主进程已唤起并聚焦窗口，这里复用通知面板的跳转与已读逻辑。
  // 经 ref 取最新处理器：订阅只挂一次，不随重渲染重绑。
  const openRef = useRef(openNotification);
  openRef.current = openNotification;
  useEffect(() => {
    if (!active) return;
    return window.dela?.notifications?.onOpen((item) => openRef.current(item));
  }, [active]);

  const count =
    notifications?.snoozedUntil && Date.parse(notifications.snoozedUntil) > now
      ? 0
      : (notifications?.unreadCount ?? 0);

  return { notifications, count, loading, error, run, openNotification };
}
