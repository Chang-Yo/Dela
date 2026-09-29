import { z } from 'zod';
import type { ShuiyuanFeed } from '../../../../shared/shuiyuan';
import { listShuiyuanTopics } from '../../../shuiyuan/api';
import { cursorPage, freshness, tool } from '../shared';
import { requireShuiyuanBound, slimTopicSummary, withShuiyuanErrors } from './helpers';

const listTopicsInput = z
  .object({
    kind: z.enum(['latest', 'featured', 'category', 'tag']),
    categoryId: z.number().int().positive().optional(),
    tag: z.string().trim().min(1).max(60).optional(),
    nextCursor: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'category' && value.categoryId === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'kind=category 时必须提供 categoryId（可用 list_shuiyuan_categories 发现分类）',
      });
    if (value.kind === 'tag' && value.tag === undefined)
      ctx.addIssue({ code: 'custom', message: 'kind=tag 时必须提供标签名 tag' });
    if (value.kind !== 'category' && value.categoryId !== undefined)
      ctx.addIssue({ code: 'custom', message: 'categoryId 仅在 kind=category 时使用' });
    if (value.kind !== 'tag' && value.tag !== undefined)
      ctx.addIssue({ code: 'custom', message: 'tag 仅在 kind=tag 时使用' });
  });

export const listShuiyuanTopicsTool = tool(
  '浏览水源社区主题列表（只读联网）：latest 最新、featured 精选、category 按分类（categoryId 见 list_shuiyuan_categories）、tag 按标签。分页：把上一页的 nextCursor 原样回传；远端不提供总数。',
  listTopicsInput,
  async (input) => {
    requireShuiyuanBound();
    const feed: ShuiyuanFeed =
      input.kind === 'category'
        ? { kind: 'category', categoryId: input.categoryId! }
        : input.kind === 'tag'
          ? { kind: 'tag', tag: input.tag! }
          : { kind: input.kind };
    const result = await withShuiyuanErrors(() => listShuiyuanTopics(feed, input.nextCursor));
    return {
      ...cursorPage(result.topics.map(slimTopicSummary), result.moreUrl),
      freshness: freshness('realtime'),
    };
  },
);
