import { calendarEventInput } from '../../contract';
import { createCalendarEvent } from '../api';
import { tool } from '../../../../core/capabilities/domain-tools';

export const createEventTool = tool(
  '创建个人日程（本地写）。起止时间使用 UTC ISO 8601（Z）；不会修改课程课表。color 可选，取值 rose/peach/sand/sage/teal/blue/lilac/slate。',
  calendarEventInput,
  createCalendarEvent,
);
