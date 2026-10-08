import { z } from 'zod';
import { loadShuiyuanPosts } from '../../../shuiyuan/api';
import { freshness, tool } from '../shared';
import { requireShuiyuanBound, slimPost, withShuiyuanErrors } from './helpers';

export const readShuiyuanPostsTool = tool(
  '按楼层 post id 续读水源主题（只读联网，每次至多 50 个 id）。postIds 取自 read_shuiyuan_topic 的 stream 或 continuation.nextPostIds；不存在的 id 会在 missingPostIds 中报告。',
  z
    .object({
      topicId: z.number().int().positive(),
      postIds: z.array(z.number().int().positive()).min(1).max(50),
    })
    .strict(),
  async ({ topicId, postIds }) => {
    requireShuiyuanBound();
    const posts = await withShuiyuanErrors(() => loadShuiyuanPosts(topicId, postIds));
    const found = new Set(posts.map((post) => post.id));
    const missingPostIds = postIds.filter((id) => !found.has(id));
    return {
      topicId,
      posts: posts.map(slimPost),
      ...(missingPostIds.length ? { missingPostIds } : {}),
      freshness: freshness('realtime'),
    };
  },
);
