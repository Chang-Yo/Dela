import { z } from 'zod';
import { syncCanvasCourse } from '../../../canvas/api';
import { freshness, tool, toolError } from '../shared';
import { canvasSyncBranches, requireCanvasConfigured, withCanvasErrors } from './helpers';

/** 从 course.error（branch() 以「标签：消息」逐行拼接）解析各分支的错误。 */
function branchErrors(error: string | null) {
  const lines = error ? error.split('\n') : [];
  return new Map(
    canvasSyncBranches.map(({ key, label }) => {
      const line = lines.find((item) => item.startsWith(`${label}：`));
      return [key, line ? (line.slice(label.length + 1) as string) : null];
    }),
  );
}

export const refreshCanvasCourseTool = tool(
  '同步单门 Canvas 课程的内容（联网刷新本地缓存）：文件/作业/通知与讨论/课程模块四个分支独立提交，失败分支保留旧缓存并在 branches 中逐项报告——部分失败不是整体失败。courseId 见 list_canvas_courses。',
  z.object({ courseId: z.number().int().positive() }).strict(),
  async ({ courseId }) => {
    requireCanvasConfigured();
    const state = await withCanvasErrors(() => syncCanvasCourse(courseId));
    const course = state.courses.find((item) => item.id === courseId);
    if (!course)
      throw toolError('NOT_FOUND', '课程不存在，请先调用 refresh_canvas_courses 刷新课程列表');
    const errors = branchErrors(course.error);
    return {
      courseId: course.id,
      name: course.name,
      contentSyncedAt: course.syncedAt,
      branches: canvasSyncBranches.map(({ key, label }) => ({
        key,
        label,
        ok: errors.get(key) === null,
        error: errors.get(key),
      })),
      complete: !course.error,
      ...(course.error ? { warnings: [course.error] } : {}),
      freshness: freshness('cached', course.syncedAt),
    };
  },
);
