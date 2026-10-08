import { z } from 'zod';
import { getShuiyuanTopic, shuiyuanTopicUrl } from '../../../shuiyuan/api';
import { freshness, tool } from '../shared';
import { requireShuiyuanBound, slimPost, withShuiyuanErrors } from './helpers';

/** read_shuiyuan_posts 单次接受的楼层数上限（与业务 loadShuiyuanPosts 一致）。 */
const READ_POSTS_CHUNK = 50;

export const readShuiyuanTopicTool = tool(
  '读取水源主题详情与首段楼层（只读联网）：元信息、楼层 post id 全量 stream 与已加载楼层。剩余楼层按 continuation.nextPostIds 传给 read_shuiyuan_posts 续读；postNumber 可从某楼附近开始加载。',
  z
    .object({
      topicId: z.number().int().positive(),
      postNumber: z.number().int().positive().optional(),
    })
    .strict(),
  async ({ topicId, postNumber }) => {
    requireShuiyuanBound();
    const detail = await withShuiyuanErrors(() => getShuiyuanTopic(topicId, postNumber));
    const loaded = new Set(detail.posts.map((post) => post.id));
    const remaining = detail.stream.filter((id) => !loaded.has(id));
    return {
      ref: { type: 'shuiyuan-topic', id: topicId },
      url: shuiyuanTopicUrl(topicId),
      title: detail.title,
      categoryId: detail.categoryId,
      tags: detail.tags,
      postsCount: detail.postsCount,
      views: detail.views,
      likeCount: detail.likeCount,
      createdAt: detail.createdAt,
      lastPostedAt: detail.lastPostedAt,
      closed: detail.closed,
      archetype: detail.archetype,
      stream: detail.stream,
      posts: detail.posts.map(slimPost),
      continuation:
        remaining.length > 0
          ? {
              nextPostIds: remaining.slice(0, READ_POSTS_CHUNK),
              remainingCount: remaining.length,
            }
          : null,
      freshness: freshness('realtime'),
    };
  },
);
