import { z } from 'zod';
import { getCanvasState } from '../../../canvas/api';
import { limit, match, offset, page, query, tool } from '../shared';

export const searchSourcesTool = tool(
  '按标题查找已缓存的 Canvas 资料，返回可传给 read_resource 的引用。不是正文全文检索。',
  z
    .object({
      query,
      courseId: z.number().int().positive().optional(),
      kind: z.enum(['file', 'assignment', 'page', 'discussion', 'link']).optional(),
      offset,
      limit,
    })
    .strict(),
  ({ query, courseId, kind, offset, limit }) => {
    const state = getCanvasState();
    const unique = new Map(
      state.items
        .filter(
          (item) =>
            item.sourceId &&
            (courseId === undefined || item.courseId === courseId) &&
            (!kind || item.kind === kind) &&
            match(item.name, query),
        )
        .map((item) => [
          item.sourceId!,
          {
            ref: { type: 'canvas', id: item.sourceId! },
            title: item.name,
            courseId: item.courseId,
            kind: item.kind,
            dueAt: item.dueAt ?? null,
          },
        ]),
    );
    return {
      ...page([...unique.values()], offset, limit),
      coverage: 'cached_titles',
      courses: state.courses
        .filter((c) => courseId === undefined || c.id === courseId)
        .map((c) => ({ id: c.id, syncedAt: c.syncedAt, error: c.error })),
    };
  },
);
