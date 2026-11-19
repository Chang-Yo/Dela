import { emit, hostPorts } from '../../../core/ports';
import { notificationsContract, type NotificationTarget } from '../contract';

// 系统桌面通知：启动基线与暂停是公共守卫，校园通知另受提醒开关约束；
// 主窗口正被使用时由宿主跳过，应用内铃铛红点已足够。

let armed = false;

export const NOTIFICATIONS_SNOOZE_KEY = 'notifications-snoozed-until';
// '0' 关闭（只停桌面弹窗，应用内通知列表不受影响），缺省视为开启；设置页读写同一个键。
const CAMPUS_NOTIFICATIONS_KEY = 'campus-notifications';

/** 启动首轮刷新完成后调用；此前收集到的存量通知作为基线，不弹系统通知。 */
export function armSystemNotifications(): void {
  armed = true;
}

function setting(key: string): string | undefined {
  return (
    hostPorts()
      .database()
      .prepare('SELECT value FROM workspace_settings WHERE key = ?')
      .get(key) as { value?: string } | undefined
  )?.value;
}

function snoozed(): boolean {
  const until = Date.parse(setting(NOTIFICATIONS_SNOOZE_KEY) ?? '');
  return !Number.isNaN(until) && until > Date.now();
}

export function showCampusNotice(
  id: string,
  title: string,
  body: string,
  target: NotificationTarget,
): void {
  if (!armed || snoozed() || setting(CAMPUS_NOTIFICATIONS_KEY) === '0') return;
  hostPorts().notifier.show(title, body, () => emit(notificationsContract, 'open', { id, target }));
}

/** 非校园类系统提醒（Agent 任务通知等），点击只唤起主窗口。 */
export function systemNotifyToast(title: string, body: string): void {
  if (!armed || snoozed()) return;
  hostPorts().notifier.show(title, body);
}
