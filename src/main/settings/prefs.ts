// workspace_settings 中的设置读写（自 src/main/index.ts 内联实现迁出；行为不变）。
// 除原有标量偏好外，承载 §4.4 新增的通知与工作现场偏好；全部经 zod 校验，
// 键缺失或值损坏时回退默认值，不向调用方抛错。
import { z } from 'zod';
import type { ThemePreference, IconPreference } from '../../shared/api';
import { fontScaleLevels, zoomLevels } from '../../shared/api';
import {
  isAccelerator,
  isShortcutActionId,
  type KeybindingOverrides,
} from '../../shared/keybindings';
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

export function savedExperimentalFeatures(): boolean {
  return readSetting('experimental-features') === '1';
}

export function setExperimentalFeatures(enabled: boolean): boolean {
  writeSetting('experimental-features', enabled ? '1' : '0');
  return enabled;
}

// 试验子项（当前仅课堂视频）：键缺失或值损坏视为开启——总开关本身默认关闭，
// 用户开启总开关即恢复子项可用，不必再逐项打开。
export function savedExperimentalClassroom(): boolean {
  return readSetting('experimental-classroom') !== '0';
}

export function setExperimentalClassroom(enabled: boolean): boolean {
  writeSetting('experimental-classroom', enabled ? '1' : '0');
  return enabled;
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
// 工作现场偏好（启动恢复上次项目与标签、默认笔记编辑方式、笔记拼写检查）。
// ---------------------------------------------------------------------------

const workspacePrefsDefaults: WorkspacePrefs = {
  // 现行为本就恢复上次项目（App 读 localStorage 的最后项目键），默认开启与其一致。
  restoreLastProject: true,
  defaultNoteEditMode: 'rich',
  // 现行为本就关闭拼写检查（两个编辑器都硬编码 spellcheck=false）。
  noteSpellcheck: false,
};

export const workspacePrefsSchema = z.object({
  restoreLastProject: z.boolean(),
  defaultNoteEditMode: z.enum(['rich', 'source']),
  // 字段级 default：旧版存的 JSON 没有这个键，缺省补齐而不是让整条偏好回退默认值。
  noteSpellcheck: z.boolean().default(false),
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

// ---------------------------------------------------------------------------
// 快捷键覆盖项（只存用户改过的动作；默认键位留在 shared/keybindings.ts，
// 后续调整默认值仍能到达既有用户）。
// ---------------------------------------------------------------------------

const keybindingOverridesDefaults: KeybindingOverrides = {};

// 键须是目录内的动作 id（未知 id 报错而不是静默丢弃）；值要么是 null（显式解绑），
// 要么是合法键位串。与默认值相同的覆盖项照原样保存，不裁剪（见下）。
export const keybindingOverridesSchema = z.record(
  z.string().refine(isShortcutActionId),
  z.union([z.null(), z.string().refine(isAccelerator)]),
);

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
export function setKeybindingOverrides(input: unknown): KeybindingOverrides {
  const patch = keybindingOverridesSchema.parse(input);
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
// 用户附加 Instruction（设置 › 自定义指令）：随系统提示注入每次 Run，缺省为空
// （空串 = 不注入）。上限与自定义指令正文一致，避免一条偏好挤占过多上下文预算。
// ---------------------------------------------------------------------------

export const instructionSchema = z.string().trim().max(2000);

/** 键缺失、超长或数据损坏一律回退空串：注入端只关心“有没有内容”。 */
export function getAgentInstruction(): string {
  return instructionSchema.catch('').parse(readSetting('agent-instruction') ?? '');
}

export function setAgentInstruction(input: unknown): string {
  const text = instructionSchema.parse(input);
  writeSetting('agent-instruction', text);
  return text;
}
