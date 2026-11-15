// workspace_settings 中的设置读写：读取时缺失或损坏的值回退默认，不向调用方抛错。
import { z } from 'zod';
import { hostPorts } from '../../../core/ports';
import { isAccelerator, isShortcutActionId, type KeybindingOverrides } from '../keybindings';
import {
  fontSizeDefault,
  fontSizeMax,
  fontSizeMin,
  iconSchema,
  taskNotificationsSchema,
  themeSchema,
  zoomSchema,
  type IconPreference,
  type TaskNotificationPrefs,
  type ThemePreference,
  type ZoomPreference,
} from '../contract';

const openAtLoginSchema = z
  .string()
  .transform((value) => value === '1')
  .catch(false);

export function readSetting(key: string): string | undefined {
  const row = hostPorts()
    .database()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function writeSetting(key: string, value: string): void {
  hostPorts()
    .database()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(key, value);
}

export function savedTheme(): ThemePreference {
  return themeSchema.catch('system').parse(readSetting('theme'));
}

export function savedIcon(): IconPreference {
  return iconSchema.catch('white').parse(readSetting('icon'));
}

export function savedZoom(): ZoomPreference {
  return zoomSchema.catch(1).parse(Number(readSetting('zoom')));
}

/** 字号（px）：取整并夹到 12–20；非数字（含 NaN、字符串垃圾）回落默认。 */
export function normalizeFontSize(value: unknown): number {
  const size = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(size)) return fontSizeDefault;
  return Math.min(fontSizeMax, Math.max(fontSizeMin, Math.round(size)));
}

export function savedFontSize(): number {
  return normalizeFontSize(readSetting('font-size') ?? fontSizeDefault);
}

export function savedOpenAtLogin(): boolean {
  return openAtLoginSchema.parse(readSetting('open-at-login'));
}

// ---------------------------------------------------------------------------
// 校园消息系统提醒（键由通知中心的弹出守卫读取；默认开启维持既有行为）。
// ---------------------------------------------------------------------------

const campusNotificationsSchema = z
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

export function setTaskNotificationPrefs(prefs: TaskNotificationPrefs): TaskNotificationPrefs {
  writeSetting('task-notifications', JSON.stringify(prefs));
  return prefs;
}

// ---------------------------------------------------------------------------
// 快捷键覆盖项（只存用户改过的动作；默认键位留在 settings/keybindings.ts，
// 后续调整默认值仍能到达既有用户）。
// ---------------------------------------------------------------------------

const keybindingOverridesDefaults: KeybindingOverrides = {};

/** 键缺失或 JSON 损坏回退空覆盖；未知动作 id / 非法键位串逐条丢弃，合法兄弟项保留。 */
export function getKeybindingOverrides(): KeybindingOverrides {
  const raw = readSetting('keybindings');
  if (raw === undefined) return { ...keybindingOverridesDefaults };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...keybindingOverridesDefaults };
  }
  // 'null'、数组、标量都能通过 JSON.parse，但不是覆盖项对象；逐条过滤前先挡住。
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...keybindingOverridesDefaults };
  }
  const overrides: KeybindingOverrides = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (!isShortcutActionId(id)) continue;
    if (value === null || isAccelerator(value)) overrides[id] = value;
  }
  return overrides;
}

/**
 * 部分合并：只写传入的动作，未传动作保持现值。
 * 不做“与默认值相同就不存”的裁剪——那会让写入结果依赖当前默认表，
 * 默认值一改旧覆盖项的语义就变了；多存一条冗余项换来可预测的读写。
 */
export function setKeybindingOverrides(patch: KeybindingOverrides): KeybindingOverrides {
  const next = { ...getKeybindingOverrides(), ...patch };
  writeSetting('keybindings', JSON.stringify(next));
  return next;
}

/** 清空全部覆盖：写空对象而不是删键，读取路径只有一种形态。 */
export function resetKeybindingOverrides(): KeybindingOverrides {
  writeSetting('keybindings', JSON.stringify(keybindingOverridesDefaults));
  return { ...keybindingOverridesDefaults };
}

// ---------------------------------------------------------------------------
// 课堂视频默认下载目录（设置 › 通用 › 课堂视频）：空串 = 没设过，
// 下载时由系统保存对话框决定初始位置。值只来自主进程的目录选择器，不做校验。
// ---------------------------------------------------------------------------

export function savedVideoDownloadDirectory(): string {
  return readSetting('video-download-directory') ?? '';
}

export function setVideoDownloadDirectory(value: string): string {
  writeSetting('video-download-directory', value);
  return value;
}

// ---------------------------------------------------------------------------
// 更新已下载、但用户选了「下次启动时提醒」的标记。主进程在启动后尽早准备更新，
// 读到就清掉：只尝试一次，失败不无限重试（否则每次启动都会静默试一遍）。
// ---------------------------------------------------------------------------

/** 键缺失或值损坏都视为没有待装：只认显式写入的 '1'。 */
export function savedPendingInstall(): boolean {
  return readSetting('pending-install') === '1';
}

export function setPendingInstall(pending: boolean): boolean {
  writeSetting('pending-install', pending ? '1' : '0');
  return pending;
}
