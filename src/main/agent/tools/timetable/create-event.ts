import { z } from 'zod';
import { createCalendarEvent } from '../../../timetable/api';
import { tool } from '../shared';

export const createEventTool = tool(
  '创建个人日程。起止时间使用 UTC ISO 8601（Z）；不会修改课程课表。',
  z
    .object({
      title: z.string().trim().min(1).max(120),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      location: z.string().max(120).optional(),
    })
    .strict(),
  createCalendarEvent,
);
