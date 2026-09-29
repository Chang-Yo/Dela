export type ThemePreference = 'system' | 'light' | 'dark';

/** 应用图标底色：white 对应 Dela_white_bg.png，black 对应 Dela_black_bg.png。 */
export type IconPreference = 'white' | 'black';

/** 页面缩放档位（webContents zoom factor）：百分比阶梯与系统显示缩放一致。 */
export const zoomLevels = [0.9, 1, 1.1, 1.25, 1.5] as const;
export type ZoomPreference = (typeof zoomLevels)[number];

/** 全局字号档位：作用于 rem 字号（--text-* 与 body 默认字号），不影响间距与图标。 */
export const fontScaleLevels = [0.9, 1, 1.1, 1.25] as const;
export type FontScalePreference = (typeof fontScaleLevels)[number];

/** Agent 任务（Run 终态）的系统提醒偏好；failed 默认开、completed 默认关（低干扰）。 */
export interface TaskNotificationPrefs {
  completed: boolean;
  failed: boolean;
}

/** 打开 Markdown 笔记时的默认编辑方式：所见即所得 / 源码。 */
export type NoteEditModePreference = 'rich' | 'source';

/** 工作现场偏好（§4.4）：启动恢复与笔记默认编辑方式。 */
export interface WorkspacePrefs {
  /** 启动时恢复上次项目与标签；关闭后启动进入首页。 */
  restoreLastProject: boolean;
  defaultNoteEditMode: NoteEditModePreference;
}

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
  /** 校园消息（新邮件/水源互动）的系统提醒开关；关闭只停桌面通知，应用内列表不受影响。 */
  getCampusNotifications(): Promise<boolean>;
  setCampusNotifications(enabled: boolean): Promise<boolean>;
  getTaskNotifications(): Promise<TaskNotificationPrefs>;
  setTaskNotifications(prefs: TaskNotificationPrefs): Promise<TaskNotificationPrefs>;
  getWorkspacePrefs(): Promise<WorkspacePrefs>;
  /** 部分更新：只改传入的字段，其余保持现值。 */
  setWorkspacePrefs(prefs: Partial<WorkspacePrefs>): Promise<WorkspacePrefs>;
}

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'workspace'
  | 'llm'
  | 'connections'
  | 'plugins'
  | 'about';
