import { z } from 'zod';
import { deleteCalendarEvent, getCalendarEvent } from '../../../timetable/api';
import { tool, toolError } from '../shared';

export const deleteEventTool = tool(
  '删除个人日程（本地写，仅自建日历事件）。课程与由个人待办派生的事件不经此删除；不删除任何文件。',
  z.object({ id: z.number().int().positive() }).strict(),
  ({ id }) => {
    const event = getCalendarEvent(id);
    if (!event) throw toolError('NOT_FOUND', '日程不存在或已被删除');
    deleteCalendarEvent(id);
    return { deleted: event };
  },
);
