import { z } from 'zod';
import { tool } from '../shared';
import { searchWeb } from './searxng';

export const webSearchTool = tool(
  '联网搜索网页，返回标题、链接和摘要；只读。需要具体内容时对链接调用 fetch_page。中英文均可。',
  z
    .object({
      query: z.string().trim().min(1).max(400),
      region: z
        .string()
        .regex(/^[a-z]{2}-[a-z]{2}$/)
        .optional(),
      count: z.number().int().min(1).max(10).default(5),
    })
    .strict(),
  async ({ query, region, count }) => {
    const results = await searchWeb(query, region);
    return { query, results: results.slice(0, count) };
  },
);
