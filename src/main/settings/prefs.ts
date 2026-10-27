// workspace_settings 中的设置读写：读取时缺失或损坏的值回退默认，不向调用方抛错。
import { z } from 'zod';
import type { ThemePreference, IconPreference } from '../../shared/api';
import { fontSizeDefault, fontSizeMax, fontSizeMin, zoomLevels } from '../../shared/api';
import {
  isAccelerator,
  isShortcutActionId,
  type KeybindingOverrides,
} from '../../shared/keybindings';
import {
  type ExperimentKey,
  type ExperimentState,
  type TaskNotificationPrefs,
} from '../../shared/settings';
import { getDatabase } from '../database';

export const themeSchema = z.enum(['system', 'light', 'dark']);
export const iconSchema = z.enum(['white', 'black']);
export const zoomSchema = z
  .number()
  .refine((value) => (zoomLevels as readonly number[]).includes(value));
export const openAtLoginSchema = z
  .string()
  .transform((value) => value === '1')
  .catch(false);

export function readSetting(key: string): string | undefined {
  const row = getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

export function writeSetting(key: string, value: string): void {
  getDatabase().prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(key, value);
}

// 试验功能：总开关 + 子项，默认都开启；键缺失或值损坏都视为开启，只有显式写入 '0' 才关闭。
// 子项只在总开关开启时生效，调用方用 experimentEnabled 取「实际是否可用」。
const experimentKeys: Record<ExperimentKey, string> = {
  master: 'experimental-features',
  shuiyuan: 'experimental-shuiyuan',
  videoDownload: 'experimental-video-download',
};

export function savedExperiments(): ExperimentState {
  const read = (key: ExperimentKey) => readSetting(experimentKeys[key]) !== '0';
  return {
    master: read('master'),
    shuiyuan: read('shuiyuan'),
    videoDownload: read('videoDownload'),
  };
}

export function setExperiment(key: ExperimentKey, enabled: boolean): ExperimentState {
  writeSetting(experimentKeys[key], enabled ? '1' : '0');
  return savedExperiments();
}

export function experimentEnabled(key: Exclude<ExperimentKey, 'master'>): boolean {
  const state = savedExperiments();
  return state.master && state[key];
}

/** 水源关闭时能力整体不可调用：IPC、Agent 命令与来源读取共用这一句报错。 */
export function assertShuiyuanEnabled(): void {
  if (!experimentEnabled('shuiyuan'))
    throw new Error('水源功能已关闭，可在设置 → 通用的试验功能中开启');
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
// 校园消息系统提醒（键由 notifications/system.ts 的弹出守卫读取；默认开启维持既有行为）。
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
// 工作现场偏好（启动恢复上次项目与标签）。
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 课堂视频默认下载目录（设置 › 通用 › 试验功能 › 课堂视频）：空串 = 没设过，
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
