import { z } from 'zod';
import { createWorkspaceEntry } from '../../../workspace/api';
import { name, tool, toolError, uuid } from '../shared';

export const linkCanvasSourceTool = tool(
  '把 Canvas 课程资料关联到项目或文件夹（本地写）。sourceId 为 Canvas 资料的引用 id（search_canvas_sources 结果里 ref 的 id）；只建引用不复制文件，同一父目录下重复关联返回已有条目。水源帖子请用 link_shuiyuan_topic。',
  z.object({ parentId: uuid, sourceId: z.string().min(1).max(512), name }).strict(),
  async (input) => {
    try {
      const entry = createWorkspaceEntry({ ...input, kind: 'source' });
      return { ref: { type: 'workspace', id: entry.id }, entry };
    } catch (error) {
      if (error instanceof Error && error.message.includes('资料不存在'))
        throw toolError('NOT_FOUND', error.message);
      throw error;
    }
  },
);
