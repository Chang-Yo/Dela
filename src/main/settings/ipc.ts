// settings:* 通道注册。
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import {
  getAgentInstruction,
  getKeybindingOverrides,
  getTaskNotificationPrefs,
  iconSchema,
  normalizeFontSize,
  resetKeybindingOverrides,
  savedCampusNotifications,
  savedExperiments,
  setExperiment,
  savedFontSize,
  savedIcon,
  savedOpenAtLogin,
  savedTheme,
  savedZoom,
  setAgentInstruction,
  setCampusNotifications,
  setKeybindingOverrides,
  setTaskNotificationPrefs,
  themeSchema,
  writeSetting,
  zoomSchema,
} from './prefs';
import { cancelVideoDownloads } from '../vsjtu/ipc';

export function applyTheme(theme: z.infer<typeof themeSchema>): 'system' | 'light' | 'dark' {
  nativeTheme.themeSource = theme;
  return theme;
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get-experiments', (event) => {
    checkWorkspaceSender(event);
    return savedExperiments();
  });
  ipcMain.handle('settings:set-experiment', (event, key, value) => {
    checkWorkspaceSender(event);
    const state = setExperiment(
      z.enum(['master', 'shuiyuan', 'videoDownload']).parse(key),
      z.boolean().parse(value),
    );
    // 下载关闭即取消进行中的任务（用户决定：立即取消，不等下完）。
    if (!state.master || !state.videoDownload) cancelVideoDownloads();
    return state;
  });
  ipcMain.handle('settings:get-theme', (event) => {
    checkWorkspaceSender(event);
    return savedTheme();
  });
  ipcMain.handle('settings:set-theme', (event, value) => {
    checkWorkspaceSender(event);
    const theme = themeSchema.parse(value);
    writeSetting('theme', theme);
    return applyTheme(theme);
  });
  // 图标偏好只持久化；窗口/任务栏图标在下次启动创建窗口时生效。
  ipcMain.handle('settings:get-icon', (event) => {
    checkWorkspaceSender(event);
    return savedIcon();
  });
  ipcMain.handle('settings:set-icon', (event, value) => {
    checkWorkspaceSender(event);
    const icon = iconSchema.parse(value);
    writeSetting('icon', icon);
    return icon;
  });
  ipcMain.handle('settings:get-zoom', (event) => {
    checkWorkspaceSender(event);
    return savedZoom();
  });
  ipcMain.handle('settings:set-zoom', (event, value) => {
    checkWorkspaceSender(event);
    const zoom = zoomSchema.parse(value);
    writeSetting('zoom', String(zoom));
    BrowserWindow.fromWebContents(event.sender)?.webContents.setZoomFactor(zoom);
    return zoom;
  });
  // 字号由 renderer 设到根元素 font-size 生效，这里只负责持久化。
  ipcMain.handle('settings:get-font-size', (event) => {
    checkWorkspaceSender(event);
    return savedFontSize();
  });
  ipcMain.handle('settings:set-font-size', (event, value) => {
    checkWorkspaceSender(event);
    const size = normalizeFontSize(value);
    writeSetting('font-size', String(size));
    return size;
  });
  // 开机自启：打包后以系统启动项为准（含任务管理器改动），开发运行不注册 electron.exe。
  ipcMain.handle('settings:get-open-at-login', (event) => {
    checkWorkspaceSender(event);
    if (!app.isPackaged) return savedOpenAtLogin();
    return process.platform === 'win32'
      ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin
      : app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('settings:set-open-at-login', (event, value) => {
    checkWorkspaceSender(event);
    const enabled = z.boolean().parse(value);
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
  });
  // 校园消息系统提醒：只影响 notifications/system.ts 的桌面弹窗，通知收集与应用内列表不受影响。
  ipcMain.handle('settings:get-campus-notifications', (event) => {
    checkWorkspaceSender(event);
    return savedCampusNotifications();
  });
  ipcMain.handle('settings:set-campus-notifications', (event, value) => {
    checkWorkspaceSender(event);
    return setCampusNotifications(z.boolean().parse(value));
  });
  // Agent 任务通知偏好：Run 终态（completed/failed）是否发系统提醒。
  ipcMain.handle('settings:get-task-notifications', (event) => {
    checkWorkspaceSender(event);
    return getTaskNotificationPrefs();
  });
  ipcMain.handle('settings:set-task-notifications', (event, value) => {
    checkWorkspaceSender(event);
    return setTaskNotificationPrefs(value);
  });
  // 快捷键覆盖项：renderer 用默认表合并后派发；这里只负责校验与持久化。
  ipcMain.handle('settings:get-keybindings', (event) => {
    checkWorkspaceSender(event);
    return getKeybindingOverrides();
  });
  ipcMain.handle('settings:set-keybindings', (event, value) => {
    checkWorkspaceSender(event);
    return setKeybindingOverrides(value);
  });
  ipcMain.handle('settings:reset-keybindings', (event) => {
    checkWorkspaceSender(event);
    return resetKeybindingOverrides();
  });
  // 用户附加 Instruction：随系统提示注入每次 Run（空串表示不注入）。
  ipcMain.handle('settings:get-instruction', (event) => {
    checkWorkspaceSender(event);
    return getAgentInstruction();
  });
  ipcMain.handle('settings:set-instruction', (event, value) => {
    checkWorkspaceSender(event);
    return setAgentInstruction(value);
  });
}
