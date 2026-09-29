import { z } from 'zod';
import { createWorkspaceEntry } from '../../../workspace/api';
import { name, tool, uuid } from '../shared';

export const linkSourceTool = tool(
  '将 Canvas 资料关联到项目或文件夹，保留原始资料来源。',
  z.object({ parentId: uuid, sourceId: z.string().min(1).max(512), name }).strict(),
  (input) => {
    const entry = createWorkspaceEntry({ ...input, kind: 'source' });
    return { ref: { type: 'workspace', id: entry.id }, entry };
  },
);
