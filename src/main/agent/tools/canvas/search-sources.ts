import { z } from 'zod';
import { getCanvasState } from '../../../canvas/api';
import { coverage, freshness, limit, match, offset, page, query, tool } from '../shared';
import { requireCanvasConfigured } from './helpers';

export const searchCanvasSourcesTool = tool(
  '按标题查找已缓存的 Canvas 资料（只读本地缓存；只匹配缓存标题，不是正文全文检索）。返回的 ref 可直接传给 read_resource；未同步或同步出错的课程在 courses 中标注。',
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
    requireCanvasConfigured(state);
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
            ref: { type: 'canvas' as const, id: item.sourceId! },
            title: item.name,
            courseId: item.courseId,
            kind: item.kind,
            dueAt: item.dueAt ?? null,
          },
        ]),
    );
    return {
      ...page([...unique.values()], offset, limit),
      freshness: freshness('cached', state.syncedAt),
      coverage: coverage('cached_titles', true),
      courses: state.courses
        .filter((course) => courseId === undefined || course.id === courseId)
        .map((course) => ({
          id: course.id,
          name: course.name,
          contentSyncedAt: course.syncedAt,
          error: course.error,
          archived: course.archived ?? false,
        })),
    };
  },
);
