import { z } from 'zod';
import { addShuiyuanSourceRef } from '../../../shuiyuan/api';
import { createWorkspaceEntry } from '../../../workspace/api';
import { tool, toolError, uuid } from '../shared';
import { requireShuiyuanBound, withShuiyuanErrors } from './helpers';

export const linkShuiyuanTopicTool = tool(
  '把水源主题关联到项目或文件夹（本地写）：实时拉取主题写入引用行，再在目标位置创建 source 条目；原帖保持在水源，重复关联返回已有条目。',
  z
    .object({
      topicId: z.number().int().positive(),
      parentId: uuid,
    })
    .strict(),
  async ({ topicId, parentId }) => {
    requireShuiyuanBound();
    const sourceRef = await withShuiyuanErrors(() => addShuiyuanSourceRef(topicId));
    let entry;
    try {
      entry = createWorkspaceEntry({
        parentId,
        name: sourceRef.title,
        kind: 'source',
        sourceId: `shuiyuan-topic:${topicId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('不存在') || message.includes('文件夹或项目'))
        throw toolError('NOT_FOUND', message);
      throw error;
    }
    return {
      ref: { type: 'shuiyuan-topic', id: topicId },
      sourceRef,
      workspaceRef: { type: 'workspace', id: entry.id },
      entry,
    };
  },
);
