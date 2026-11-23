import { app, nativeTheme, type WebContents } from 'electron';
import { hostPorts } from '../../../core/ports';
import type { ThemePreference, ZoomPreference } from '../contract';
import { savedOpenAtLogin, writeSetting } from './prefs';

export function applyTheme(theme: ThemePreference): ThemePreference {
  nativeTheme.themeSource = theme;
  return theme;
}

export function setTheme(theme: ThemePreference): ThemePreference {
  writeSetting('theme', theme);
  return applyTheme(theme);
}

export function setZoom(zoom: ZoomPreference): ZoomPreference {
  writeSetting('zoom', String(zoom));
  (hostPorts().workspaceClient() as WebContents | null)?.setZoomFactor(zoom);
  return zoom;
}

// 打包后以系统启动项为准（含任务管理器改动），开发运行不注册 electron.exe。
export function openAtLogin(): boolean {
  if (!app.isPackaged) return savedOpenAtLogin();
  return process.platform === 'win32'
    ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin
    : app.getLoginItemSettings().openAtLogin;
}

export function setOpenAtLogin(enabled: boolean): boolean {
  if (app.isPackaged && process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    const actual = app.getLoginItemSettings();
    if (enabled && actual.status === 'requires-approval')
      throw new Error('请在 macOS「系统设置 › 通用 › 登录项」中允许 Dela，然后返回重试。');
    if (actual.openAtLogin !== enabled || (!enabled && actual.status === 'requires-approval'))
      throw new Error(
        `macOS 未能${enabled ? '开启' : '关闭'}登录时启动，请在「系统设置 › 通用 › 登录项」中检查 Dela。`,
      );
    writeSetting('open-at-login', enabled ? '1' : '0');
    return enabled;
  }
  writeSetting('open-at-login', enabled ? '1' : '0');
  if (app.isPackaged)
    app.setLoginItemSettings({
      openAtLogin: enabled,
      ...(process.platform === 'win32' ? { args: ['--hidden'] } : {}),
    });
  return enabled;
}
