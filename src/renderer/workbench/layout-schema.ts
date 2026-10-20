// 布局类型 re-export、树操作纯函数与旧数据种子迁移。
// 类型与校验 schema 的唯一事实来源是 shared/layout.ts；本文件是 renderer 侧的工作台适配层。
import {
  maxTabsPerGroup,
  ratioMax,
  ratioMin,
  workbenchLayoutSchema,
  type GroupNode,
  type LayoutNode,
  type SplitOrientation,
  type TabId,
  type WorkbenchLayout,
} from '../../shared/layout';

export type {
  GroupNode,
  LayoutNode,
  SplitNode,
  SplitOrientation,
  TabId,
  TabKind,
  WorkbenchLayout,
} from '../../shared/layout';
export { maxLayoutNodes, maxTabsPerGroup, ratioMax, ratioMin } from '../../shared/layout';

/** 固定区恒在未固定区之前（VS Code 语义）：载入时归一，过滤失效引用，容忍手工改动。 */
function normalizeGroup(group: GroupNode): GroupNode {
  const pinned = [...new Set(group.pinned ?? [])].filter((tab) => group.tabs.includes(tab));
  return {
    ...group,
    tabs: [...pinned, ...group.tabs.filter((tab) => !pinned.includes(tab))],
    pinned: pinned.length ? pinned : undefined,
  };
}

/** 持久化数据（IPC 或其他来源）→ 布局；不合法返回 null，由调用方落到种子/默认。 */
export function parseWorkbenchLayout(value: unknown): WorkbenchLayout | null {
  const parsed = workbenchLayoutSchema.safeParse(value);
  if (!parsed.success) return null;
  let root = parsed.data.root;
  for (const group of walkGroups(root)) root = updateGroup(root, group.id, normalizeGroup);
  return { ...parsed.data, root };
}

export function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(ratioMax, Math.max(ratioMin, ratio)) : 0.5;
}

export function countNodes(node: LayoutNode): number {
  return node.type === 'group'
    ? 1
    : 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/** split 嵌套深度（组 = 0）；测试断言布局嵌套用。 */
export function splitDepth(node: LayoutNode): number {
  return node.type === 'group' ? 0 : 1 + Math.max(...node.children.map(splitDepth));
}

export function walkGroups(node: LayoutNode): GroupNode[] {
  return node.type === 'group' ? [node] : node.children.flatMap(walkGroups);
}

export function findGroup(node: LayoutNode, id: string): GroupNode | null {
  return walkGroups(node).find((group) => group.id === id) ?? null;
}

/** 取「未被占用的最小组 id」，避免进程重启后计数器复位与已存布局撞名。 */
export function nextGroupId(root: LayoutNode): string {
  const used = new Set(walkGroups(root).map((group) => group.id));
  let n = 1;
  while (used.has(`g${n}`)) n += 1;
  return `g${n}`;
}

/** 不可变更新指定组；update 返回仍须是组节点。 */
export function updateGroup(
  node: LayoutNode,
  id: string,
  update: (group: GroupNode) => GroupNode,
): LayoutNode {
  return replaceGroupNode(node, id, (group) => update(group));
}

/** 用任意布局节点替换指定组（splitGroup/边缘分屏用它把组包进新 split）。 */
export function replaceGroupNode(
  node: LayoutNode,
  id: string,
  next: (group: GroupNode) => LayoutNode,
): LayoutNode {
  if (node.type === 'group') return node.id === id ? next(node) : node;
  return { ...node, children: node.children.map((child) => replaceGroupNode(child, id, next)) };
}

/** 删除指定组并收敛树：split 只剩一个子节点时上提该子节点。根组不删除（空组合法）。 */
export function removeGroup(node: LayoutNode, id: string): LayoutNode {
  if (node.type === 'group') return node;
  const remaining = node.children
    .filter((child) => !(child.type === 'group' && child.id === id))
    .map((child) => removeGroup(child, id));
  if (remaining.length === 1) return remaining[0]!;
  return { ...node, children: remaining };
}

/** 从根到节点的子索引路径（setRatio 用它定位 split）。 */
export function nodeAtPath(root: LayoutNode, path: readonly number[]): LayoutNode | null {
  let node: LayoutNode | null = root;
  for (const index of path) {
    if (!node || node.type !== 'split') return null;
    node = node.children[index] ?? null;
  }
  return node;
}

export function replaceAtPath(
  node: LayoutNode,
  path: readonly number[],
  next: LayoutNode,
): LayoutNode {
  if (!path.length) return next;
  if (node.type !== 'split') return node;
  const head = path[0];
  if (head === undefined) return node;
  const rest = path.slice(1);
  const child = node.children[head];
  if (child === undefined) return node;
  const children = [...node.children];
  children[head] = replaceAtPath(child, rest, next);
  return { ...node, children };
}

export function createDefaultLayout(): WorkbenchLayout {
  const root: GroupNode = { type: 'group', id: 'primary', tabs: [], active: null };
  return { root, focus: 'primary', maximized: null };
}

/** 载入旧布局或拖走最后一个标签后，只保留有内容的组；根空组仍可接收打开内容。 */
export function collapseEmptyGroups(layout: WorkbenchLayout): WorkbenchLayout {
  const prune = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'group') return node.tabs.length ? node : null;
    const children = node.children
      .map(prune)
      .filter((child): child is LayoutNode => child !== null);
    if (!children.length) return null;
    if (children.length === 1) return children[0]!;
    return { ...node, children };
  };
  const root = prune(layout.root) ?? walkGroups(layout.root)[0] ?? createDefaultLayout().root;
  const groups = walkGroups(root);
  return {
    root,
    focus: groups.some((group) => group.id === layout.focus) ? layout.focus : groups[0]!.id,
    maximized: groups.some((group) => group.id === layout.maximized) ? layout.maximized : null,
  };
}

// 旧数据种子：EditorLayout（localStorage 双组形态）+ view:% tabs → WorkbenchLayout。
// `source:{id}` → `preview:source:{id}`；entryId 默认 `note:{entryId}`，调用方可用
// resolveEntryKind 把 local/imported/source 条目判为 preview。

/** 旧 ProjectView 的 localStorage 布局形态（宽容解析，字段均可缺省）。 */
export interface LegacyEditorLayout {
  split?: boolean;
  orientation?: SplitOrientation;
  ratio?: number;
  focus?: 'primary' | 'secondary';
  groups?: {
    primary?: { tabs?: string[]; active?: string | null };
    secondary?: { tabs?: string[]; active?: string | null };
  };
}

export interface LegacySeedInput {
  /** 旧 scope（项目 id / 'projects' / 'sources'），用于读 localStorage。 */
  scope: string;
  /** view:% 行的 tabs（entry id 或 `source:` 引用）。 */
  viewTabs: string[];
  viewActive: string | null;
  /** entryId 的内容判定；缺省全部按 note 处理。 */
  resolveEntryKind?: (entryId: string) => 'note' | 'preview';
}

const legacyLayoutKey = (scope: string) => `dela.editor.layout.${scope}`;

export function readStoredLegacyLayout(scope: string): LegacyEditorLayout | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(legacyLayoutKey(scope));
    return value ? (JSON.parse(value) as LegacyEditorLayout) : null;
  } catch {
    return null;
  }
}

/** 布局成功落库（layout:{projectId}）后清除旧 ProjectView 的 localStorage 布局键。 */
export function removeStoredLegacyLayout(scope: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(legacyLayoutKey(scope));
}

/** 旧标签键 → TabId：`source:*` 只读预览；entryId 由 resolveEntryKind 判定，缺省 note。 */
export function mapLegacyTabKey(
  key: string,
  resolveEntryKind?: LegacySeedInput['resolveEntryKind'],
): TabId | null {
  if (typeof key !== 'string' || !key) return null;
  if (key.startsWith('source:')) return `preview:${key}`;
  const kind = resolveEntryKind?.(key) === 'preview' ? 'preview' : 'note';
  return `${kind}:${key}`;
}

export function seedLayoutFromLegacy(
  input: LegacySeedInput & { stored?: LegacyEditorLayout | null },
): WorkbenchLayout {
  const stored = input.stored !== undefined ? input.stored : readStoredLegacyLayout(input.scope);
  const clean = (
    raw: { tabs?: string[]; active?: string | null } | undefined,
    fallback: string[],
  ) => {
    const source = Array.isArray(raw?.tabs) ? raw.tabs : fallback;
    const mapped = Array.from(new Set(source))
      .map((key) => mapLegacyTabKey(key, input.resolveEntryKind))
      .filter((tab): tab is TabId => tab !== null)
      .slice(0, maxTabsPerGroup);
    const active = raw?.active ? mapLegacyTabKey(raw.active, input.resolveEntryKind) : null;
    return {
      tabs: mapped,
      active: active && mapped.includes(active) ? active : (mapped.at(-1) ?? null),
    };
  };
  const primary = clean(stored?.groups?.primary, Array.from(new Set(input.viewTabs)));
  const secondary = clean(stored?.groups?.secondary, []);
  // 更早版本 view 状态只存单个 active 键：组数据不存在时保留它。
  if (!stored?.groups?.primary && input.viewActive) {
    const active = mapLegacyTabKey(input.viewActive, input.resolveEntryKind);
    if (active && primary.tabs.includes(active)) primary.active = active;
  }
  const split = Boolean(stored?.split && secondary.tabs.length);
  const focusSecondary = stored?.focus === 'secondary' && secondary.tabs.length;
  const primaryGroup: GroupNode = { type: 'group', id: 'primary', ...primary };
  if (!split) return { root: primaryGroup, focus: 'primary', maximized: null };
  return {
    root: {
      type: 'split',
      orientation: stored?.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      ratio: clampRatio(typeof stored?.ratio === 'number' ? stored.ratio : 0.5),
      children: [primaryGroup, { type: 'group', id: 'secondary', ...secondary }],
    },
    focus: focusSecondary ? 'secondary' : 'primary',
    maximized: null,
  };
}
