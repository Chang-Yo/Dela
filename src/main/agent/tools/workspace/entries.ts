import { z } from 'zod';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  removeWorkspaceEntry,
  updateWorkspaceEntry,
} from '../../../workspace/api';
import { name, tool, toolError, uuid } from '../shared';

export const createEntryTool = tool(
  '创建项目、文件夹或 Markdown 笔记（本地写）。parentId 为 null 时创建在根目录；笔记可带初始正文 text。',
  z
    .object({
      parentId: uuid.nullable(),
      kind: z.enum(['project', 'folder', 'note']),
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
  '重命名、移动工作区条目，或在文件夹与项目之间原地转换（本地写；转换只改类型，目录与子条目不动）。返回更新后的条目。',
  z
    .object({
      id: uuid,
      name: name.optional(),
      parentId: uuid.nullable().optional(),
      kind: z.enum(['folder', 'project']).optional(),
    })
    .strict(),
  async ({ id, ...changes }) => {
    updateWorkspaceEntry(id, changes);
    return {
      ref: { type: 'workspace', id },
      entry: getWorkspaceState().entries.find((e) => e.id === id),
    };
  },
);

export const removeEntryTool = tool(
  '移除工作区条目引用（本地写）。只解除应用内的条目，不删除磁盘文件：笔记与导入文件保留在原位置。移除项目或文件夹会连同其子条目引用一起移除（同样不删文件）。归档文件夹不能移除。',
  z.object({ id: uuid }).strict(),
  async ({ id }) => {
    try {
      removeWorkspaceEntry(id);
    } catch (error) {
      if (error instanceof Error && error.message.includes('不存在'))
        throw toolError('NOT_FOUND', error.message);
      throw error;
    }
    return { removed: true, ref: { type: 'workspace', id } };
  },
);
