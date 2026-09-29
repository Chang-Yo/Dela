export type ThemePreference = 'system' | 'light' | 'dark';

/** 应用图标底色：white 对应 Dela_white_bg.png，black 对应 Dela_black_bg.png。 */
export type IconPreference = 'white' | 'black';

/** 页面缩放档位（webContents zoom factor）：百分比阶梯与系统显示缩放一致。 */
export const zoomLevels = [0.9, 1, 1.1, 1.25, 1.5] as const;
export type ZoomPreference = (typeof zoomLevels)[number];

/** 全局字号档位：作用于 rem 字号（--text-* 与 body 默认字号），不影响间距与图标。 */
export const fontScaleLevels = [0.9, 1, 1.1, 1.25] as const;
export type FontScalePreference = (typeof fontScaleLevels)[number];

export interface SettingsApi {
  getTheme(): Promise<ThemePreference>;
  setTheme(theme: ThemePreference): Promise<ThemePreference>;
  getIcon(): Promise<IconPreference>;
  setIcon(icon: IconPreference): Promise<IconPreference>;
  getZoom(): Promise<ZoomPreference>;
  setZoom(zoom: ZoomPreference): Promise<ZoomPreference>;
  getFontScale(): Promise<FontScalePreference>;
  setFontScale(scale: FontScalePreference): Promise<FontScalePreference>;
  /** 开机自启状态；打包版以系统启动项为准，开发运行读本地偏好。 */
  getOpenAtLogin(): Promise<boolean>;
  setOpenAtLogin(enabled: boolean): Promise<boolean>;
}

export type SettingsSectionId =
  'general' | 'connections' | 'llm' | 'plugins' | 'appearance' | 'about';
