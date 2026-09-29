import { z } from 'zod';
import {
  createWorkspaceEntry,
  getWorkspaceState,
  updateWorkspaceEntry,
} from '../../../workspace/api';
import { name, tool, uuid } from '../shared';

export const createEntryTool = tool(
  '创建项目、文件夹或 Markdown 笔记。parentId 为 null 时创建在根目录。',
  z
    .object({
      parentId: uuid.nullable(),
      kind: z.enum(['project', 'folder', 'note']),
      name,
      text: z.string().max(1000000).optional(),
    })
    .strict(),
  (input) => {
    const entry = createWorkspaceEntry(input);
    return { ref: { type: 'workspace', id: entry.id }, entry };
  },
);

export const updateEntryTool = tool(
  '重命名或移动工作区条目。返回实际更新后的条目。',
  z.object({ id: uuid, name: name.optional(), parentId: uuid.nullable().optional() }).strict(),
  ({ id, ...changes }) => {
    updateWorkspaceEntry(id, changes);
    return {
      ref: { type: 'workspace', id },
      entry: getWorkspaceState().entries.find((e) => e.id === id),
    };
  },
);
