import { z } from 'zod';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  removeWorkspaceEntry,
  updateWorkspaceEntry,
} from '../../../workspace/api';
import { workspaceEntryIdSchema } from '../../../../shared/workspace';
import { name, tool, toolError } from '../shared';

export const createEntryTool = tool(
  '创建项目、文件夹或文件（本地写）。parentId 为 null 时创建在根目录；文件名原样使用（不补扩展名，笔记请写 .md），可带初始正文 text。文件与文件夹的 name 可含 / 表示子路径（如 notes/week1.md，中间文件夹自动建）；同名已存在时报错，不会覆盖或改名。',
  z
    .object({
      parentId: workspaceEntryIdSchema.nullable(),
      kind: z.enum(['project', 'folder', 'file']),
      name,
      text: z.string().max(2_000_000).optional(),
    })
    .strict(),
  async (input) => {
    const entry = createWorkspaceEntry(input);
    return { ref: { type: 'workspace', id: entry.id }, entry };
  },
);

export const updateEntryTool = tool(
  '重命名、移动工作区条目，或在文件夹与项目之间原地转换（本地写；转换只改类型，目录与子条目不动）。返回更新后的条目与路径映射。',
  z
    .object({
      id: workspaceEntryIdSchema,
      name: name.optional(),
      parentId: workspaceEntryIdSchema.nullable().optional(),
      kind: z.enum(['folder', 'project']).optional(),
    })
    .strict(),
  async ({ id, ...changes }) => {
    const update = updateWorkspaceEntry(id, changes);
    return {
      ref: { type: 'workspace', id: update.id },
      ...(update.fromPath ? { fromPath: update.fromPath, toPath: update.toPath } : {}),
      entry: getWorkspaceState().entries.find((e) => e.id === update.id),
    };
  },
);

export const removeEntryTool = tool(
  '移除工作区条目（本地写）。普通文件与文件夹移入系统回收站；移除项目会删除名下全部会话（含归档），目录与文件保留；资料引用只解除关联。归档文件夹不能移除。',
  z.object({ id: workspaceEntryIdSchema }).strict(),
  async ({ id }) => {
    try {
      await removeWorkspaceEntry(id);
    } catch (error) {
      if (error instanceof Error && error.message.includes('不存在'))
        throw toolError('NOT_FOUND', error.message);
      throw error;
    }
    return { removed: true, ref: { type: 'workspace', id } };
  },
);
