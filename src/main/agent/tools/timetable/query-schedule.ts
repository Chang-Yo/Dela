import { querySchedule, scheduleQuerySchema } from '../../../timetable/api';
import { tool } from '../shared';

export const queryScheduleTool = tool(
  '查询指定范围的课程与个人事件，按上海时区展开周次。输入 UTC ISO 时间。缺少周次或学期日期会返回不完整警告。',
  scheduleQuerySchema,
  querySchedule,
);
