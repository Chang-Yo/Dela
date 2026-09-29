import { z } from 'zod';
import { syncCanvasCourses } from '../../../canvas/api';
import { freshness, tool } from '../shared';
import { courseSummary, requireCanvasConfigured, withCanvasErrors } from './helpers';

export const refreshCanvasCoursesTool = tool(
  '从 Canvas 刷新课程列表（联网刷新本地缓存）。仅更新列表，不同步课程内容；历史课程与项目引用不会被删除。令牌失效返回 AUTH_EXPIRED。',
  z.object({}).strict(),
  async () => {
    requireCanvasConfigured();
    const state = await withCanvasErrors(() => syncCanvasCourses());
    return {
      courseListSyncedAt: state.syncedAt,
      courses: state.courses.map(courseSummary),
      freshness: freshness('cached', state.syncedAt),
    };
  },
);
