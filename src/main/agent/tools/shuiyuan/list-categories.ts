import { z } from 'zod';
import { getShuiyuanSiteStructure } from '../../../shuiyuan/api';
import { freshness, tool } from '../shared';
import { requireShuiyuanBound, withShuiyuanErrors } from './helpers';

export const listShuiyuanCategoriesTool = tool(
  '列出水源社区分类树与常用标签（只读联网，站点结构带 10 分钟缓存）。返回的 categoryId 与标签名是 list_shuiyuan_topics 构造 category/tag 浏览的前提。',
  z.object({}).strict(),
  async () => {
    requireShuiyuanBound();
    const structure = await withShuiyuanErrors(() => getShuiyuanSiteStructure());
    return {
      categories: structure.categories.map(({ id, name, slug, parentId, topicCount }) => ({
        id,
        name,
        slug,
        parentId,
        topicCount,
      })),
      tags: structure.tags,
      freshness: freshness('realtime'),
    };
  },
);
