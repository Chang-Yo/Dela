import { z } from 'zod';
import { syncCanvasCourse, syncCanvasCourses } from '../../../canvas/api';
import { tool } from '../shared';

export const syncSourcesTool = tool(
  '同步 Canvas 课程列表，或指定课程的资料。课程内容可能部分同步失败，检查返回的 error。',
  z.object({ courseId: z.number().int().positive().optional() }).strict(),
  async ({ courseId }) => {
    const state =
      courseId === undefined ? await syncCanvasCourses() : await syncCanvasCourse(courseId);
    return {
      courses: state.courses.filter((c) => courseId === undefined || c.id === courseId),
      syncedAt: state.syncedAt,
    };
  },
);
