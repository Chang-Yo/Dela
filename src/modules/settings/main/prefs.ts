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

const taskNotificationsDefaults: TaskNotificationPrefs = { completed: false, failed: true };

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

/** 部分合并：只写传入的动作。不裁剪与默认值相同的项，否则默认值一改旧覆盖项语义就变了。 */
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

// 「下次启动时提醒」标记：读到就清掉，只尝试一次，避免失败后每次启动静默重试。

export function savedPendingInstall(): boolean {
  return readSetting('pending-install') === '1';
}

export function setPendingInstall(pending: boolean): boolean {
  writeSetting('pending-install', pending ? '1' : '0');
  return pending;
}
