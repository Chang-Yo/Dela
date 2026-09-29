import type {
  FontScalePreference,
  IconPreference,
  SettingsApi,
  ThemePreference,
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
} satisfies SettingsApi;
