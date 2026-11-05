import { z } from 'zod';
import { addShuiyuanSourceRef } from '../../../shuiyuan/sources';
import { createWorkspaceEntry } from '../../../workspace/api';
import { tool, toolError, uuid } from '../shared';
import { requireShuiyuanBound, withShuiyuanErrors } from './helpers';

export const linkShuiyuanTopicTool = tool(
  '把水源主题关联到项目或文件夹：联网读取引用信息，创建本地 source 条目并后台保存快照。ref 只读本地快照或摘要，onlineRef 用于联网读取；重复关联返回已有条目。',
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
      ref: { type: 'workspace', id: entry.id },
      onlineRef: { type: 'shuiyuan-online', id: topicId },
      sourceRef,
      entry,
    };
  },
);
