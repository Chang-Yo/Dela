// 统一标签工作台的布局契约。
// 类型按 §3.2 定义；zod schema 供 layout:* IPC 双侧校验（节点数上限、ratio 边界、组内标签去重）。
import { z } from 'zod';

const tabKinds = ['chat', 'note', 'preview', 'review', 'terminal'] as const;
export type TabKind = (typeof tabKinds)[number];
/** chat:{sessionId} | note:{entryId} | preview:{sourceKey|entryId} | review:{...} | terminal:{projectId} */
export type TabId = `${TabKind}:${string}`;

export type SplitOrientation = 'vertical' | 'horizontal';

export interface GroupNode {
  type: 'group';
  /** 组内唯一；WorkbenchLayout.focus/maximized 按它引用。 */
  id: string;
  tabs: TabId[];
  active: TabId | null;
  /** 固定标签（VS Code 语义）：恒为 tabs 的前缀子集，批量关闭不波及；store 维护该不变量，
   *  schema 只校验形状，引用失效/乱序由载入时的归一修复。 */
  pinned?: TabId[];
}

export interface SplitNode {
  type: 'split';
  /** vertical = 左右并排（flex-row）；horizontal = 上下堆叠（flex-col），沿用旧 EditorLayout 语义。 */
  orientation: SplitOrientation;
  /** 第一个子节点占的比例，其余子节点均分剩余空间；2 子时即旧 primary/secondary 语义。 */
  ratio: number;
  /** ≥2，支持嵌套组合出三屏（结构上是二叉/多叉树，本批 store 只产生二元 split）。 */
  children: LayoutNode[];
}

export type LayoutNode = GroupNode | SplitNode;

export interface WorkbenchLayout {
  root: LayoutNode;
  /** 焦点组 id：openTab 无显式目标时的落点。 */
  focus: string;
  /** 最大化组 id；null = 正常布局。 */
  maximized: string | null;
}

export const ratioMin = 0.05;
export const ratioMax = 0.95;
/** 整棵树的节点数（组 + split）上限：约等于 4 层满二叉分割，防止持久化数据无限膨胀。 */
export const maxLayoutNodes = 31;
/** 单组标签上限，量级与旧 MAX_EDITOR_TABS 的单组实际占用一致。 */
export const maxTabsPerGroup = 30;
/** split 子节点数上限（schema 容忍历史多叉数据；store 本批只写二元）。 */
const maxSplitChildren = 4;

// 模板串类型 TabId 的运行时校验：templateLiteral 让推断类型就是 `${TabKind}:${string}`。
const tabIdSchema = z
  .templateLiteral([z.enum(tabKinds), z.literal(':'), z.string().min(1)])
  .refine((value) => value.length <= 512, { message: 'TabId 过长' });
const groupIdSchema = z.string().min(1).max(64);

const groupNodeSchema = z
  .object({
    type: z.literal('group'),
    id: groupIdSchema,
    tabs: z.array(tabIdSchema).max(maxTabsPerGroup),
    active: tabIdSchema.nullable(),
    pinned: z.array(tabIdSchema).max(maxTabsPerGroup).optional(),
  })
  .refine((node) => new Set(node.tabs).size === node.tabs.length, {
    message: '组内标签重复',
    path: ['tabs'],
  })
  .refine((node) => node.active === null || node.tabs.includes(node.active), {
    message: '活动标签不在该组内',
    path: ['active'],
  });

const splitNodeSchema: z.ZodType<SplitNode> = z.object({
  type: z.literal('split'),
  orientation: z.enum(['vertical', 'horizontal']),
  ratio: z.number().min(ratioMin).max(ratioMax),
  children: z
    .array(z.lazy(() => layoutNodeSchema))
    .min(2)
    .max(maxSplitChildren),
});

const layoutNodeSchema: z.ZodType<LayoutNode> = z.union([groupNodeSchema, splitNodeSchema]);

export const workbenchLayoutSchema: z.ZodType<WorkbenchLayout> = z
  .object({
    root: layoutNodeSchema,
    focus: groupIdSchema,
    maximized: groupIdSchema.nullable(),
  })
  .superRefine((layout, ctx) => {
    const count = (node: LayoutNode): number =>
      node.type === 'group' ? 1 : 1 + node.children.reduce((sum, child) => sum + count(child), 0);
    if (count(layout.root) > maxLayoutNodes)
      ctx.addIssue({ code: 'custom', path: ['root'], message: `布局节点数超过 ${maxLayoutNodes}` });
    const groups = new Set<string>();
    const collect = (node: LayoutNode) => {
      if (node.type === 'group') groups.add(node.id);
      else node.children.forEach(collect);
    };
    collect(layout.root);
    if (!groups.has(layout.focus))
      ctx.addIssue({ code: 'custom', path: ['focus'], message: '焦点组不存在' });
    if (layout.maximized !== null && !groups.has(layout.maximized))
      ctx.addIssue({ code: 'custom', path: ['maximized'], message: '最大化组不存在' });
  });

/** layout:* IPC 面。 */
export interface LayoutApi {
  get(projectId: string | null): Promise<WorkbenchLayout | null>;
  save(projectId: string | null, state: WorkbenchLayout): Promise<void>;
}
