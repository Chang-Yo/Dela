import { z } from 'zod';
import { getCanvasState } from '../../../canvas/api';
import { limit, match, offset, page, query, tool } from '../shared';

export const findCoursesTool = tool(
  '查找已缓存的 Canvas 课程。返回课程 ID、同步时间和错误；未同步课程内容时先调用 sync_sources。',
  z.object({ query, offset, limit }).strict(),
  ({ query, offset, limit }) => {
    const state = getCanvasState();
    return {
      ...page(
        state.courses.filter((c) => match(`${c.name} ${c.code} ${c.term}`, query)),
        offset,
        limit,
      ),
      connected: state.connected,
      syncedAt: state.syncedAt,
      coverage: 'cached_courses',
    };
  },
);
