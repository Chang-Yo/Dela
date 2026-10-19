// 通知镜像订阅与跳转：镜像状态供通知中心与铃铛计数，
// 跳转经 navigation/view 的定位脉冲分发。
import { useEffect, useRef, useState } from 'react';
import type { NotificationItem, NotificationState } from '../../shared/api';
import { leaveComposer } from '../features/mail/compose-close';
import { errorText } from '../workspace/store';
import { showToast } from './toasts';
import { useNavigationStore } from '../navigation/view';

/** active 为 false 时主界面未挂载（如启动流程中），不订阅。 */
export function useNotifications(active: boolean) {
  const [notifications, setNotifications] = useState<NotificationState | null>(null);
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 订阅与 run() 共用的读取序号：await 落地时序号已前进则结果过期，不得覆盖。 */
  const versionRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const api = window.dela?.notifications;
    if (!api) return;
    let alive = true;
    // 重新订阅时归零，保持初始读取的 version===0 守卫语义。
    versionRef.current = 0;
    const unsubscribe = api.onUpdate((state) => {
      versionRef.current += 1;
      setNow(Date.now);
      if (alive) setNotifications(state);
    });
    const unsubscribeTodos = window.dela?.todo.onUpdate(() => {
      const requested = ++versionRef.current;
      void api
        .getState()
        .then((state) => {
          if (alive && requested === versionRef.current) setNotifications(state);
        })
        .catch((cause: unknown) => {
          if (alive) setError(errorText(cause));
        });
    });
    void api
      .getState()
      .then((state) => {
        if (alive && versionRef.current === 0) setNotifications(state);
      })
      .catch((cause) => {
        if (alive) setError(errorText(cause));
      });
    // 暂停到期时重新读取，使铃铛无需等待下一次网络刷新即可恢复。
    const timer = window.setInterval(() => {
      setNow(Date.now);
      const requested = versionRef.current;
      void api
        .getState()
        .then((state) => {
          if (alive && versionRef.current === requested) setNotifications(state);
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
    // 与订阅路径同一竞态守卫：await 期间有推送/其他读取落地时丢弃本次结果。
    const requested = ++versionRef.current;
    try {
      const state = await action();
      // 操作成功时清掉初始加载遗留的错误条（重试按钮也走这里）。
      if (requested === versionRef.current) {
        setNotifications(state);
        setError(null);
      }
    } catch (cause) {
      showToast({ variant: 'error', title: '通知操作失败', description: errorText(cause) });
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

  // TODO 新消息未读数（readAt === null），与主进程 unreadCount 的 todo 口径同源；
  // 不受通知中心暂停（snooze）影响：暂停只静音铃铛，不清空待办本身。
  const todoUnread =
    notifications?.items.filter((item) => item.source === 'todo' && !item.readAt).length ?? 0;

  return { notifications, count, todoUnread, loading, error, run, openNotification };
}
