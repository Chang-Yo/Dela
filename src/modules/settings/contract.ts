// 设置契约：偏好、条款接受记录、导出本机数据与缓存清理。偏好的事实在主进程数据库。
import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';
import { isAccelerator, isShortcutActionId, type KeybindingOverrides } from './keybindings';

export * from './keybindings';

export type ThemePreference = 'system' | 'light' | 'dark';

export type IconPreference = 'white' | 'black';

export const zoomLevels = [0.9, 1, 1.1, 1.25, 1.5] as const;
export type ZoomPreference = (typeof zoomLevels)[number];

export const fontSizeMin = 12;
export const fontSizeMax = 20;
export const fontSizeDefault = 16;

/** Agent 任务（Run 终态）的系统提醒偏好；failed 默认开、completed 默认关（低干扰）。 */
export interface TaskNotificationPrefs {
  completed: boolean;
  failed: boolean;
}

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'shortcuts'
  | 'notifications'
  | 'storage'
  | 'connections'
  | 'providers'
  | 'capabilities'
  | 'commands'
  | 'skills'
  | 'mcp'
  | 'workspace'
  | 'remotes'
  | 'archived'
  | 'about'
  | 'privacy'
  | 'terms';

export const settingsSectionLabels: Record<SettingsSectionId, string> = {
  general: '通用',
  appearance: '外观',
  shortcuts: '快捷键',
  notifications: '通知',
  storage: '存储',
  connections: '凭据',
  providers: '模型服务',
  capabilities: '内置能力',
  commands: '自定义指令',
  skills: 'Skills',
  mcp: 'MCP',
  workspace: '工作区',
  remotes: '远程',
  archived: '已归档对话',
  about: '关于',
  privacy: '隐私条款',
  terms: '使用条款',
};

export type ConsentDocument = 'terms' | 'privacy';

export type BackupResult =
  /** skipped 是没复制成功的顶层条目名；原因不止被占用，所以只回报名字，不断言原因。 */
  | { status: 'exported'; path: string; skipped: string[] }
  | { status: 'cancelled' }
  /** 选定的位置不能用（例如落在 Dela 自己的数据目录里），reason 直接给用户看。 */
  | { status: 'failed'; reason: string };

export interface CacheClearResult {
  freed: number;
  /** 有文件被占住没能删掉：Chromium 继续用它们，重启应用后可再清一次。 */
  blocked: boolean;
}

export const themeSchema = z.enum(['system', 'light', 'dark']);
export const iconSchema = z.enum(['white', 'black']);
export const zoomSchema = z.literal(zoomLevels);
export const taskNotificationsSchema = z.object({ completed: z.boolean(), failed: z.boolean() });
// 键须是目录内的动作 id（未知 id 报错而不是静默丢弃）；值要么是 null（显式解绑），要么是合法键位串。
export const keybindingOverridesSchema = z.record(
  z.string().refine(isShortcutActionId),
  z.union([z.null(), z.string().refine(isAccelerator)]),
);

export const settingsContract = defineContract('settings', {
  theme: { input: z.undefined(), output: z.custom<ThemePreference>() },
  setTheme: { input: themeSchema, output: z.custom<ThemePreference>() },
  /** 图标偏好只持久化；窗口与任务栏图标在下次启动创建窗口时生效。 */
  icon: { input: z.undefined(), output: z.custom<IconPreference>() },
  setIcon: { input: iconSchema, output: z.custom<IconPreference>() },
  zoom: { input: z.undefined(), output: z.custom<ZoomPreference>() },
  setZoom: { input: zoomSchema, output: z.custom<ZoomPreference>() },
  /** 字号由渲染端设到根元素 font-size 生效，主进程只取整、夹到范围内并持久化。 */
  fontSize: { input: z.undefined(), output: z.number() },
  setFontSize: { input: z.number(), output: z.number() },
  openAtLogin: { input: z.undefined(), output: z.boolean() },
  setOpenAtLogin: { input: z.boolean(), output: z.boolean() },
  /** 校园消息的系统提醒开关；关闭只停桌面通知，应用内列表不受影响。 */
  campusNotifications: { input: z.undefined(), output: z.boolean() },
  setCampusNotifications: { input: z.boolean(), output: z.boolean() },
  taskNotifications: { input: z.undefined(), output: z.custom<TaskNotificationPrefs>() },
  setTaskNotifications: {
    input: taskNotificationsSchema,
    output: z.custom<TaskNotificationPrefs>(),
  },
  /** 只存用户改过的动作，null 表示显式解绑；写入是部分合并。 */
  keybindings: { input: z.undefined(), output: z.custom<KeybindingOverrides>() },
  setKeybindings: { input: keybindingOverridesSchema, output: z.custom<KeybindingOverrides>() },
  resetKeybindings: { input: z.undefined(), output: z.custom<KeybindingOverrides>() },
  instruction: { input: z.undefined(), output: z.string() },
  setInstruction: { input: z.string(), output: z.string() },
  /** 条款接受记录只追加；revision 是正文顶部的「最后更新」日期。 */
  recordConsent: {
    input: z.object({
      document: z.enum(['terms', 'privacy']),
      revision: z.string().min(1).max(64),
    }),
    output: z.void(),
  },
  /** 只在条款接受页使用：拒绝条款的用户也要能先把自己的数据拿走。 */
  exportData: { input: z.undefined(), output: z.custom<BackupResult>() },
  cacheSize: { input: z.undefined(), output: z.number() },
  clearCache: { input: z.undefined(), output: z.custom<CacheClearResult>() },
});

declare module '../../app/module' {
  interface NavTargets {
    settings: { section: SettingsSectionId };
  }
}
