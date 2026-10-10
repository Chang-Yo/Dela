// settings:* 通道注册。
// 新增：campus-notifications、task-notifications、workspace-prefs、keybindings 四组偏好读写。
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { z } from 'zod';
import { checkWorkspaceSender } from '../ipc';
import {
  fontScaleSchema,
  getAgentInstruction,
  getKeybindingOverrides,
  getTaskNotificationPrefs,
  getWorkspacePrefs,
  iconSchema,
  resetKeybindingOverrides,
  savedCampusNotifications,
  savedExperimentalFeatures,
  setExperimentalFeatures,
  savedFontScale,
  savedIcon,
  savedOpenAtLogin,
  savedTheme,
  savedZoom,
  setAgentInstruction,
  setCampusNotifications,
  setKeybindingOverrides,
  setTaskNotificationPrefs,
  setWorkspacePrefs,
  themeSchema,
  writeSetting,
  zoomSchema,
} from './prefs';

export function applyTheme(theme: z.infer<typeof themeSchema>): 'system' | 'light' | 'dark' {
  nativeTheme.themeSource = theme;
  return theme;
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get-experimental-features', (event) => {
    checkWorkspaceSender(event);
    return savedExperimentalFeatures();
  });
  ipcMain.handle('settings:set-experimental-features', (event, value) => {
    checkWorkspaceSender(event);
    return setExperimentalFeatures(z.boolean().parse(value));
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
  // 页面缩放立即应用到调用窗口，并持久化供下次启动使用。
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
  // 字号缩放由 renderer 以 CSS 变量生效，这里只负责持久化。
  ipcMain.handle('settings:get-font-scale', (event) => {
    checkWorkspaceSender(event);
    return savedFontScale();
  });
  ipcMain.handle('settings:set-font-scale', (event, value) => {
    checkWorkspaceSender(event);
    const scale = fontScaleSchema.parse(value);
    writeSetting('font-scale', String(scale));
    return scale;
  });
  // 开机自启：打包后以系统启动项为准（含任务管理器改动），开发运行不注册 electron.exe。
  ipcMain.handle('settings:get-open-at-login', (event) => {
    checkWorkspaceSender(event);
    return app.isPackaged ? app.getLoginItemSettings().openAtLogin : savedOpenAtLogin();
  });
  ipcMain.handle('settings:set-open-at-login', (event, value) => {
    checkWorkspaceSender(event);
    const enabled = z.boolean().parse(value);
    writeSetting('open-at-login', enabled ? '1' : '0');
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    return enabled;
  });
  // 校园消息系统提醒：只影响 system-notify 的桌面弹窗，通知收集与应用内列表不受影响。
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
  // 工作现场偏好：启动恢复上次项目与标签、默认笔记编辑方式。
  ipcMain.handle('settings:get-workspace-prefs', (event) => {
    checkWorkspaceSender(event);
    return getWorkspacePrefs();
  });
  ipcMain.handle('settings:set-workspace-prefs', (event, value) => {
    checkWorkspaceSender(event);
    return setWorkspacePrefs(value);
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
