import { BrowserWindow, Notification } from 'electron';
import type { NotificationItem } from '../shared/api';
import { getDatabase } from './database';

// 系统桌面通知：仅提示标题，点击唤起主窗口并跳转对应界面。
// 弹出条件：会话已过启动基线（armSystemNotifications）、未处暂停通知、主窗口未聚焦——
// 聚焦时应用内铃铛红点已足够，避免同屏双重打扰。

let armed = false;

// workspace_settings 中暂停通知的键；notifications.ts 的读写与此处共用，避免裸字符串散落两模块。
export const NOTIFICATIONS_SNOOZE_KEY = 'notifications-snoozed-until';

/** 启动首轮刷新完成后调用；此前收集到的存量通知作为基线，不弹系统通知。 */
export function armSystemNotifications(): void {
  armed = true;
}

export function isWorkspaceWindow(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html')) ||
      url.origin === 'http://127.0.0.1:5173'
    );
  } catch {
    return false;
  }
}

function workspaceWindow(): BrowserWindow | null {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && isWorkspaceWindow(window.webContents.getURL())) return window;
  }
  return null;
}

function snoozed(): boolean {
  const row = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key = ?')
    .get(NOTIFICATIONS_SNOOZE_KEY) as { value?: string } | undefined;
  if (!row?.value) return false;
  const until = Date.parse(row.value);
  return !Number.isNaN(until) && until > Date.now();
}

/** 新增通知的桌面提示入口；守卫不满足时静默返回，不影响通知收集。 */
export function systemNotifyItem(item: NotificationItem): void {
  if (!armed || !Notification.isSupported() || snoozed()) return;
  const window = workspaceWindow();
  // 窗口不存在（尚未创建）或正被使用时不打扰；收起到托盘的窗口不聚焦，正常弹出。
  if (!window || window.isFocused()) return;
  const toast = new Notification({ title: item.title, body: '' });
  toast.on('click', () => {
    const target = workspaceWindow();
    if (!target) return;
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    target.webContents.send('notifications:open', item);
  });
  toast.show();
}
