// 统一标签工作台的布局契约；zod schema 供 layout:* IPC 双侧校验（节点数上限、ratio 边界、组内标签去重）。
import { z } from 'zod';
import { tabKinds, type TabId } from '../../core/protocol/workbench';

export type SplitOrientation = 'vertical' | 'horizontal';

export interface GroupNode {
  type: 'group';
  id: string;
  tabs: TabId[];
  active: TabId | null;
  /** 预览标签（VS Code 语义）：组内至多一个，下次预览就地替换；编辑、双击后转常驻。 */
  preview?: TabId;
  /** 固定标签（VS Code 语义）：恒为 tabs 的前缀子集；schema 只校验形状，失效引用载入时归一。 */
  pinned?: TabId[];
}

export interface SplitNode {
  type: 'split';
  orientation: SplitOrientation;
  ratio: number;
  children: LayoutNode[];
}

export type LayoutNode = GroupNode | SplitNode;

export interface WorkbenchLayout {
  root: LayoutNode;
  focus: string;
  maximized: string | null;
}

export const ratioMin = 0.05;
export const ratioMax = 0.95;
/** 节点数（组 + split）上限，防止持久化数据无限膨胀。 */
export const maxLayoutNodes = 31;
export const maxTabsPerGroup = 30;
const maxSplitChildren = 4;

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
    preview: tabIdSchema.optional(),
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
