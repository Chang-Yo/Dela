import { z } from 'zod';
import { calendarEventColors } from '../../../../shared/api';
import { createCalendarEvent } from '../../../timetable/api';
import { tool } from '../shared';

export const createEventTool = tool(
  '创建个人日程（本地写）。起止时间使用 UTC ISO 8601（Z）；不会修改课程课表。color 可选，取值 rose/peach/sand/sage/teal/blue/lilac/slate。',
  z
    .object({
      title: z.string().trim().min(1).max(120),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      location: z.string().max(120).optional(),
      color: z.enum(calendarEventColors).optional(),
    })
    .strict(),
  createCalendarEvent,
);
