import { z } from 'zod';
import { getCanvasState } from '../../../canvas/api';
import { coverage, freshness, limit, match, offset, page, query, tool, toolError } from '../shared';
import { courseSummary, requireCanvasConfigured } from './helpers';

export const listCanvasCoursesTool = tool(
  '列出已缓存的 Canvas 课程（只读本地缓存）。query 按名称/代码/学期弱过滤；默认不含归档课程，includeArchived 为 true 时包含。空结果表示确实没有匹配的课程。',
  z
    .object({
      query,
      includeArchived: z.boolean().default(false),
      offset,
      limit,
    })
    .strict(),
  ({ query, includeArchived, offset, limit }) => {
    const state = getCanvasState();
    requireCanvasConfigured(state);
    if (!state.syncedAt)
      throw toolError('NOT_FOUND', '课程列表尚未同步，请先调用 refresh_canvas_courses');
    const courses = state.courses.filter(
      (course) =>
        (includeArchived || !course.archived) &&
        match(`${course.name} ${course.code} ${course.term}`, query),
    );
    return {
      ...page(courses.map(courseSummary), offset, limit),
      freshness: freshness('cached', state.syncedAt),
      coverage: coverage('cached_courses', true),
    };
  },
);
