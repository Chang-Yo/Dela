import { z } from 'zod';
import { listLessons, listSyncedSemesters, syncTimetable } from '../../../timetable/api';
import { tool, toolError } from '../shared';

/** 课表同步失败消息 → 细分错误码；消息保持业务侧中文文案。 */
function mapTimetableError(message: string) {
  if (/登录已失效|重新登录/.test(message)) return toolError('AUTH_EXPIRED', message);
  if (/超时|无法连接|请求中断/.test(message)) return toolError('NETWORK_ERROR', message);
  return toolError('UPSTREAM_ERROR', message);
}

export const refreshTimetableTool = tool(
  '同步指定学期的课表（联网刷新本地缓存；不影响个人日程，也不改动其他学期）。semester 必填（格式 YYYY-YYYY-[123]，可用学期与当前学期推断见 get_timetable_status）。',
  z.object({ semester: z.string().regex(/^\d{4}-\d{4}-[123]$/) }).strict(),
  async ({ semester }) => {
    const result = await syncTimetable(semester);
    if (!result.ok) throw mapTimetableError(result.error ?? '课表同步失败');
    const row = listSyncedSemesters().find((item) => item.semester === semester);
    return {
      semester,
      lastSyncedAt: row?.lastSyncedAt ?? null,
      semesterStart: row?.semesterStart ?? null,
      lessonCount: listLessons(semester).length,
      ...(row && !row.semesterStart
        ? {
            warnings: [
              '教务未返回学期开始日期，课程无法展开为具体日期；请在课表设置中补设学期开始日期',
            ],
          }
        : {}),
    };
  },
);
