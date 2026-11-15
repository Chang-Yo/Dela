// 可配置快捷键的单一事实来源：动作目录、默认键位与规范化纯函数，供 main 校验持久化载荷、renderer 渲染设置与录制。
// 键位串 `Mod` 在 Windows/Linux 为 Ctrl、macOS 为 ⌘（Control 另记 Ctrl）；命名键沿用 KeyboardEvent.key，空格=Space，`+`→`=`。

export type ShortcutActionId =
  | 'new-project'
  | 'import-files'
  | 'global-search'
  | 'open-home'
  | 'open-mail'
  | 'open-timetable'
  | 'open-settings'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'toggle-word-wrap'
  | 'split-right'
  | 'close-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'focus-group'
  | 'open-shortcuts';

/** 动作作用域：global 在窗口级派发，workbench 只在工作台子树内派发。 */
export type ShortcutScope = 'global' | 'workbench';

export interface ShortcutAction {
  id: ShortcutActionId;
  scope: ShortcutScope;
  /** 设置页分组标题。 */
  group: string;
  label: string;
  /** 默认键位；null 表示默认不绑定。 */
  defaultKeys: string | null;
  /**
   * 键位族：`digit` 表示绑定只固定修饰键部分，末位接受 1…9
   * （动作本身作用于“第 N 个工作组”）。
   */
  family?: 'digit';
}

/** 动作目录（顺序即设置页展示顺序）。 */
export const shortcutActions: readonly ShortcutAction[] = [
  {
    id: 'new-project',
    scope: 'global',
    group: '文件',
    label: '新建项目',
    defaultKeys: 'Mod+Shift+N',
  },
  {
    id: 'import-files',
    scope: 'global',
    group: '文件',
    label: '导入本地文件',
    defaultKeys: 'Mod+O',
  },
  { id: 'global-search', scope: 'global', group: '文件', label: '全局搜索', defaultKeys: 'Mod+K' },
  { id: 'open-home', scope: 'global', group: '导航', label: '首页', defaultKeys: 'Mod+1' },
  { id: 'open-mail', scope: 'global', group: '导航', label: '邮箱', defaultKeys: 'Mod+2' },
  { id: 'open-timetable', scope: 'global', group: '导航', label: '课表', defaultKeys: 'Mod+3' },
  { id: 'open-settings', scope: 'global', group: '导航', label: '设置', defaultKeys: 'Mod+,' },
  { id: 'zoom-in', scope: 'global', group: '视图', label: '放大', defaultKeys: 'Mod+=' },
  { id: 'zoom-out', scope: 'global', group: '视图', label: '缩小', defaultKeys: 'Mod+-' },
  { id: 'zoom-reset', scope: 'global', group: '视图', label: '重置缩放', defaultKeys: 'Mod+0' },
  {
    id: 'toggle-word-wrap',
    scope: 'global',
    group: '视图',
    label: '自动换行',
    defaultKeys: 'Alt+Z',
  },
  {
    id: 'split-right',
    scope: 'workbench',
    group: '工作台',
    label: '向右分屏',
    defaultKeys: 'Mod+\\',
  },
  {
    id: 'close-tab',
    scope: 'workbench',
    group: '工作台',
    label: '关闭当前标签',
    defaultKeys: 'Mod+W',
  },
  {
    id: 'next-tab',
    scope: 'workbench',
    group: '工作台',
    label: '下一个标签',
    defaultKeys: 'Mod+PageDown',
  },
  {
    id: 'previous-tab',
    scope: 'workbench',
    group: '工作台',
    label: '上一个标签',
    defaultKeys: 'Mod+PageUp',
  },
  {
    id: 'focus-group',
    scope: 'workbench',
    group: '工作台',
    label: '聚焦工作组',
    defaultKeys: 'Alt+1',
    family: 'digit',
  },
  {
    id: 'open-shortcuts',
    scope: 'global',
    group: '帮助',
    label: '快捷键一览',
    // Mod+/ 被 CodeMirror 的注释切换占用，所以用 F1。
    defaultKeys: 'F1',
  },
];

/** 用户覆盖：null 表示显式解绑（该动作不再响应键盘）。未出现的动作使用默认键位。 */
export type KeybindingOverrides = Partial<Record<ShortcutActionId, string | null>>;

/** 合并后的键位表：动作 → 生效键位（null = 未绑定）。 */
export type KeybindingMap = Record<ShortcutActionId, string | null>;

/** 按键事件中本模块用到的字段（KeyboardEvent 的结构子集，便于纯函数测试）。 */
export interface KeyEventLike {
  key: string;
  /** 物理键位；digit 族在 macOS 上按 Alt+数字会产生别的字符，故优先取它。 */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

const actionById = new Map(shortcutActions.map((action) => [action.id, action]));

export function isShortcutActionId(value: string): value is ShortcutActionId {
  return actionById.has(value as ShortcutActionId);
}

export function defaultKeybindings(): KeybindingMap {
  const map = {} as KeybindingMap;
  for (const action of shortcutActions) map[action.id] = action.defaultKeys;
  return map;
}

/** 默认键位叠加用户覆盖（只存覆盖项，默认值以后仍可演进）。 */
export function mergeKeybindings(overrides: KeybindingOverrides): KeybindingMap {
  const map = defaultKeybindings();
  for (const [id, keys] of Object.entries(overrides)) {
    if (isShortcutActionId(id)) map[id] = keys ?? null;
  }
  return map;
}

const namedKeys = new Set([
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
]);

function normalizeKey(key: string): string | null {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key === '+') return '=';
  if (key.length === 1) return key.toUpperCase();
  if (/^F\d{1,2}$/.test(key)) return key;
  return namedKeys.has(key) ? key : null;
}

/** keydown → 键位串；单独的修饰键或无法识别的键返回 null。 */
export function acceleratorFromEvent(
  event: KeyEventLike,
  platform: 'mac' | 'other' = 'other',
): string | null {
  if (event.isComposing || (platform === 'other' && event.metaKey)) return null;
  // Option 会改变 event.key（如 Option+Z 为 Ω）；快捷键仍按相应字母/数字键识别。
  const physicalKey =
    platform === 'mac' && event.altKey
      ? event.code?.match(/^(?:Key([A-Z])|Digit([0-9]))$/)
      : undefined;
  const key = normalizeKey(physicalKey?.[1] ?? physicalKey?.[2] ?? event.key);
  if (!key) return null;
  const parts: string[] = [];
  if (platform === 'mac') {
    if (event.metaKey) parts.push('Mod');
    if (event.ctrlKey) parts.push('Ctrl');
  } else if (event.ctrlKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function isAccelerator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return false;
  const parts = value.split('+');
  const key = parts.at(-1)!;
  if (normalizeKey(key) !== key) return false;
  const modifiers = parts.slice(0, -1);
  return modifiers.every((part) => ['Mod', 'Ctrl', 'Alt', 'Shift'].includes(part));
}

export function isDigitFamily(accelerator: string): boolean {
  return /\+[1-9]$/.test(accelerator);
}

function modifierPart(accelerator: string): string {
  return accelerator.slice(0, accelerator.lastIndexOf('+'));
}

/** digit 族只比较修饰键部分，末位数字接受 1…9（动作按序号作用于第 N 个工作组）。 */
function matchesAccelerator(
  accelerator: string | null,
  event: KeyEventLike,
  platform: 'mac' | 'other',
  family?: 'digit',
): boolean {
  if (!accelerator) return false;
  const pressed = acceleratorFromEvent(event, platform);
  if (!pressed) return false;
  if (pressed === accelerator) return true;
  if (family !== 'digit' || !isDigitFamily(accelerator)) return false;
  const digit = digitFromEvent(event);
  return digit !== null && modifierPart(pressed) === modifierPart(accelerator);
}

/** digit 族绑定的数字：优先取物理键（macOS Alt+数字输入的是其他字符），否则取 event.key。 */
export function digitFromEvent(event: KeyEventLike): number | null {
  const fromCode = event.code?.match(/^Digit([1-9])$/)?.[1];
  if (fromCode) return Number(fromCode);
  return /^[1-9]$/.test(event.key) ? Number(event.key) : null;
}

/** 按作用域把按键事件解析为动作；未绑定或未命中返回 null（派发方据此决定是否 preventDefault）。 */
export function matchShortcut(
  bindings: KeybindingMap,
  event: KeyEventLike,
  scope: ShortcutScope,
  platform: 'mac' | 'other' = 'other',
): ShortcutActionId | null {
  for (const action of shortcutActions) {
    if (action.scope !== scope) continue;
    if (matchesAccelerator(bindings[action.id], event, platform, action.family)) return action.id;
  }
  return null;
}

export interface ShortcutConflict {
  accelerator: string;
  actionIds: ShortcutActionId[];
}

/** digit 族按“修饰键 + 1…9”展开比较；跨作用域也算冲突（派发顺序不可依赖）。 */
export function findShortcutConflicts(bindings: KeybindingMap): ShortcutConflict[] {
  const used = new Map<string, ShortcutActionId[]>();
  const push = (accelerator: string, id: ShortcutActionId) => {
    const list = used.get(accelerator);
    if (list) list.push(id);
    else used.set(accelerator, [id]);
  };
  for (const action of shortcutActions) {
    const accelerator = bindings[action.id];
    if (!accelerator) continue;
    if (action.family === 'digit' && isDigitFamily(accelerator)) {
      const prefix = modifierPart(accelerator);
      for (let digit = 1; digit <= 9; digit++) push(`${prefix}+${digit}`, action.id);
    } else push(accelerator, action.id);
  }
  return [...used.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([accelerator, actionIds]) => ({ accelerator, actionIds }));
}

const displayKeys: Record<string, string> = {
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Enter: '↵',
  Backspace: '⌫',
  Delete: 'Del',
  Space: 'Space',
};

/** 键位串 → 逐键显示片段（设置页与帮助弹窗的 <kbd> 序列）。 */
export function acceleratorKeys(
  accelerator: string | null,
  platform: 'mac' | 'other',
  family?: 'digit',
): string[] {
  if (!accelerator) return [];
  const parts = accelerator.split('+');
  const key = parts.pop()!;
  const chips = parts.map((part) => {
    if (part === 'Mod') return platform === 'mac' ? '⌘' : 'Ctrl';
    if (part === 'Ctrl') return platform === 'mac' ? '⌃' : 'Ctrl';
    if (part === 'Shift') return '⇧';
    if (part === 'Alt') return platform === 'mac' ? '⌥' : 'Alt';
    return part;
  });
  const label = displayKeys[key] ?? key;
  chips.push(family === 'digit' && isDigitFamily(accelerator) ? `${label}…9` : label);
  return chips;
}

/** 设置页与帮助弹窗共用的分组视图：保持目录顺序，按 group 聚拢。 */
export function shortcutGroups(): Array<{ title: string; actions: ShortcutAction[] }> {
  const groups: Array<{ title: string; actions: ShortcutAction[] }> = [];
  for (const action of shortcutActions) {
    const last = groups.at(-1);
    if (last && last.title === action.group) last.actions.push(action);
    else groups.push({ title: action.group, actions: [action] });
  }
  return groups;
}
