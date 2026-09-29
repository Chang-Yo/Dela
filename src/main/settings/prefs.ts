// workspace_settings 中的设置读写（自 src/main/index.ts 内联实现迁出；行为不变）。
// 除原有标量偏好外，承载 §4.4 新增的通知与工作现场偏好；全部经 zod 校验，
// 键缺失或值损坏时回退默认值，不向调用方抛错。
import { z } from 'zod';
import type { ThemePreference, IconPreference } from '../../shared/api';
import { fontScaleLevels, zoomLevels } from '../../shared/api';
import { type TaskNotificationPrefs, type WorkspacePrefs } from '../../shared/settings';
import { getDatabase } from '../database';

export const themeSchema = z.enum(['system', 'light', 'dark']);
export const iconSchema = z.enum(['white', 'black']);
export const zoomSchema = z
  .number()
  .refine((value) => (zoomLevels as readonly number[]).includes(value));
export const fontScaleSchema = z
  .number()
  .refine((value) => (fontScaleLevels as readonly number[]).includes(value));
// 持久化为 '1'/'0'；键不存在（老版本升级、首次使用）视为默认开启。
export const openAtLoginSchema = z
  .string()
  .transform((value) => value === '1')
  .catch(true);

export function readSetting(key: string): string | undefined {
  const row = getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

export function writeSetting(key: string, value: string): void {
  getDatabase().prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(key, value);
}

export function savedTheme(): ThemePreference {
  return themeSchema.catch('system').parse(readSetting('theme'));
}

export function savedIcon(): IconPreference {
  return iconSchema.catch('white').parse(readSetting('icon'));
}

export function savedZoom(): number {
  return zoomSchema.catch(1).parse(Number(readSetting('zoom')));
}

export function savedFontScale(): number {
  return fontScaleSchema.catch(1).parse(Number(readSetting('font-scale')));
}

export function savedOpenAtLogin(): boolean {
  return openAtLoginSchema.parse(readSetting('open-at-login'));
}

// ---------------------------------------------------------------------------
// 校园消息系统提醒（键由 system-notify 的弹出守卫读取；默认开启维持既有行为）。
// ---------------------------------------------------------------------------

export const campusNotificationsSchema = z
  .string()
  .transform((value) => value === '1')
  .catch(true);

export function savedCampusNotifications(): boolean {
  return campusNotificationsSchema.parse(readSetting('campus-notifications'));
}

export function setCampusNotifications(enabled: boolean): boolean {
  writeSetting('campus-notifications', enabled ? '1' : '0');
  return enabled;
}

// ---------------------------------------------------------------------------
// Agent 任务通知偏好（Run completed/failed 的系统提醒）。
// ---------------------------------------------------------------------------

const taskNotificationsDefaults: TaskNotificationPrefs = { completed: false, failed: true };

export const taskNotificationsSchema = z.object({
  completed: z.boolean(),
  failed: z.boolean(),
});

/** 键缺失或 JSON 损坏回退默认（failed 开、completed 关）。 */
export function getTaskNotificationPrefs(): TaskNotificationPrefs {
  const raw = readSetting('task-notifications');
  if (raw === undefined) return { ...taskNotificationsDefaults };
  try {
    return taskNotificationsSchema.catch({ ...taskNotificationsDefaults }).parse(JSON.parse(raw));
  } catch {
    return { ...taskNotificationsDefaults };
  }
}

export function setTaskNotificationPrefs(input: unknown): TaskNotificationPrefs {
  const prefs = taskNotificationsSchema.parse(input);
  writeSetting('task-notifications', JSON.stringify(prefs));
  return prefs;
}

// ---------------------------------------------------------------------------
// 工作现场偏好（启动恢复上次项目与标签、默认笔记编辑方式）。
// ---------------------------------------------------------------------------

const workspacePrefsDefaults: WorkspacePrefs = {
  // 现行为本就恢复上次项目（App 读 localStorage 的最后项目键），默认开启与其一致。
  restoreLastProject: true,
  defaultNoteEditMode: 'rich',
};

export const workspacePrefsSchema = z.object({
  restoreLastProject: z.boolean(),
  defaultNoteEditMode: z.enum(['rich', 'source']),
});

export function getWorkspacePrefs(): WorkspacePrefs {
  const raw = readSetting('workspace-prefs');
  if (raw === undefined) return { ...workspacePrefsDefaults };
  try {
    return workspacePrefsSchema.catch({ ...workspacePrefsDefaults }).parse(JSON.parse(raw));
  } catch {
    return { ...workspacePrefsDefaults };
  }
}

/** 部分合并：只写传入字段，未传字段保持现值。 */
export function setWorkspacePrefs(input: unknown): WorkspacePrefs {
  const partial = workspacePrefsSchema.partial().parse(input);
  const next = { ...getWorkspacePrefs(), ...partial };
  writeSetting('workspace-prefs', JSON.stringify(next));
  return next;
}
