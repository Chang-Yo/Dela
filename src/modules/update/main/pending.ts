import { readSetting, writeSetting } from '../../settings';

// 「下次启动时提醒」标记：读到就清掉，只尝试一次，避免失败后每次启动静默重试。
const PENDING_INSTALL_KEY = 'update-pending-install';

export function savedPendingInstall(): boolean {
  return readSetting(PENDING_INSTALL_KEY) === '1';
}

export function setPendingInstall(pending: boolean): void {
  writeSetting(PENDING_INSTALL_KEY, pending ? '1' : '0');
}
