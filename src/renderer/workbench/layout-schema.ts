// 布局类型 re-export与树操作纯函数。
// 类型与校验 schema 的唯一事实来源是 shared/layout.ts；本文件是 renderer 侧的工作台适配层。
import {
  ratioMax,
  ratioMin,
  workbenchLayoutSchema,
  type GroupNode,
  type LayoutNode,
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
  // 预览标签必须仍在组内且未固定；失效引用直接丢掉（标签保留为常驻）。
  const preview =
    group.preview && group.tabs.includes(group.preview) && !pinned.includes(group.preview)
      ? group.preview
      : undefined;
  return {
    ...group,
    tabs: [...pinned, ...group.tabs.filter((tab) => !pinned.includes(tab))],
    pinned: pinned.length ? pinned : undefined,
    preview,
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

/** 载入布局或拖走最后一个标签后，只保留有内容的组；根空组仍可接收打开内容。 */
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
