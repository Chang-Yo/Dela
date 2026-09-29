import { z } from 'zod';
import { listShuiyuanTopics } from '../../../shuiyuan/api';
import { cursorPage, freshness, tool } from '../shared';
import { requireShuiyuanBound, slimTopicSummary, withShuiyuanErrors } from './helpers';

export const searchShuiyuanTopicsTool = tool(
  '按关键词实时搜索水源社区主题（只读联网）。返回主题摘要与 topicId 引用，可用 read_shuiyuan_topic 读取。分页：把上一页的 nextCursor 原样回传；远端不提供总数。',
  z
    .object({
      query: z.string().trim().min(1).max(200),
      nextCursor: z.string().min(1).max(500).optional(),
    })
    .strict(),
  async ({ query, nextCursor }) => {
    requireShuiyuanBound();
    const result = await withShuiyuanErrors(() =>
      listShuiyuanTopics({ kind: 'search', query }, nextCursor),
    );
    return {
      ...cursorPage(result.topics.map(slimTopicSummary), result.moreUrl),
      freshness: freshness('realtime'),
    };
  },
);
