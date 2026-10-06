import type {
  FontScalePreference,
  IconPreference,
  KeybindingOverrides,
  SettingsApi,
  TaskNotificationPrefs,
  ThemePreference,
  WorkspacePrefs,
  ZoomPreference,
} from '../shared/api';
import { invoke } from './lib';

export const settings = {
  getTheme: () => invoke('settings:get-theme'),
  setTheme: (theme: ThemePreference) => invoke('settings:set-theme', theme),
  getIcon: () => invoke('settings:get-icon'),
  setIcon: (icon: IconPreference) => invoke('settings:set-icon', icon),
  getZoom: () => invoke('settings:get-zoom'),
  setZoom: (zoom: ZoomPreference) => invoke('settings:set-zoom', zoom),
  getFontScale: () => invoke('settings:get-font-scale'),
  setFontScale: (scale: FontScalePreference) => invoke('settings:set-font-scale', scale),
  getOpenAtLogin: () => invoke('settings:get-open-at-login'),
  setOpenAtLogin: (enabled: boolean) => invoke('settings:set-open-at-login', enabled),
  getCampusNotifications: () => invoke('settings:get-campus-notifications'),
  setCampusNotifications: (enabled: boolean) =>
    invoke('settings:set-campus-notifications', enabled),
  getTaskNotifications: () => invoke('settings:get-task-notifications'),
  setTaskNotifications: (prefs: TaskNotificationPrefs) =>
    invoke('settings:set-task-notifications', prefs),
  getWorkspacePrefs: () => invoke('settings:get-workspace-prefs'),
  setWorkspacePrefs: (prefs: Partial<WorkspacePrefs>) =>
    invoke('settings:set-workspace-prefs', prefs),
  getKeybindings: () => invoke('settings:get-keybindings'),
  setKeybindings: (patch: KeybindingOverrides) => invoke('settings:set-keybindings', patch),
  resetKeybindings: () => invoke('settings:reset-keybindings'),
  getInstruction: () => invoke('settings:get-instruction'),
  setInstruction: (text: string) => invoke('settings:set-instruction', text),
} satisfies SettingsApi;
