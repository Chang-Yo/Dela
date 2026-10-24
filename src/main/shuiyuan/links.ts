import { BrowserWindow } from 'electron';
import { shuiyuanTopicFromUrl } from '../../shared/shuiyuan';
import { isWorkspaceWindow } from '../notifications/system';
import { experimentEnabled } from '../settings/prefs';
import { getShuiyuanState } from './api';

/**
 * 外链出口前的水源分流：功能开启且已绑定时，主题链接交回工作区窗口在应用内阅读。
 * 返回 false 时调用方照常交给系统浏览器，未绑定用户点开链接仍能在浏览器里看帖。
 */
export function openShuiyuanLinkInApp(url: string): boolean {
  const topic = shuiyuanTopicFromUrl(url);
  if (!topic || !experimentEnabled('shuiyuan') || !getShuiyuanState().connected) return false;
  const workspace = BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed() && isWorkspaceWindow(window.webContents.getURL()),
  );
  if (!workspace) return false;
  workspace.webContents.send('shuiyuan:open-topic', topic);
  return true;
}
