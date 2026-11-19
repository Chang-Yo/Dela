// 设置：偏好读写、条款接受记录、导出本机数据与缓存清理。设置页在 view/，依赖外壳的分区由 renderer/features/settings 注入。
import { BrowserWindow, type WebContents } from 'electron';
import { defineModule } from '../../app/module';
import { getAgentInstruction, setAgentInstruction } from '../../core/agent/instruction';
import { hostPorts } from '../../core/ports';
import { implement } from '../../core/protocol/contract';
import { settingsContract } from './contract';
import { exportUserData } from './main/backup';
import { cacheSize, clearCaches } from './main/cache';
import { recordConsent } from './main/consent';
import {
  getKeybindingOverrides,
  getTaskNotificationPrefs,
  normalizeFontSize,
  resetKeybindingOverrides,
  savedCampusNotifications,
  savedFontSize,
  savedIcon,
  savedTheme,
  savedZoom,
  setCampusNotifications,
  setKeybindingOverrides,
  setTaskNotificationPrefs,
  writeSetting,
} from './main/prefs';
import { openAtLogin, setOpenAtLogin, setTheme, setZoom } from './main/system';

export { hasConsented } from './main/consent';
export {
  readSetting,
  savedIcon,
  savedPendingInstall,
  savedTheme,
  savedVideoDownloadDirectory,
  savedZoom,
  setPendingInstall,
  setVideoDownloadDirectory,
  writeSetting,
} from './main/prefs';
export { applyTheme } from './main/system';
export { settingsSearch } from './main/search';
export { notifyRunFinished } from './main/task-notify';

export const settingsModule = defineModule({
  id: 'settings',
  ipc: implement(settingsContract, {
    theme: savedTheme,
    setTheme,
    icon: savedIcon,
    setIcon: (icon) => {
      writeSetting('icon', icon);
      return icon;
    },
    zoom: savedZoom,
    setZoom,
    fontSize: savedFontSize,
    setFontSize: (value) => {
      const size = normalizeFontSize(value);
      writeSetting('font-size', String(size));
      return size;
    },
    openAtLogin,
    setOpenAtLogin,
    campusNotifications: savedCampusNotifications,
    setCampusNotifications,
    taskNotifications: getTaskNotificationPrefs,
    setTaskNotifications: setTaskNotificationPrefs,
    keybindings: getKeybindingOverrides,
    setKeybindings: setKeybindingOverrides,
    resetKeybindings: resetKeybindingOverrides,
    instruction: getAgentInstruction,
    setInstruction: setAgentInstruction,
    recordConsent: ({ document, revision }) => recordConsent(document, revision),
    exportData: () => {
      const client = hostPorts().workspaceClient();
      return exportUserData(client && BrowserWindow.fromWebContents(client as WebContents));
    },
    cacheSize,
    clearCache: clearCaches,
  }),
});
