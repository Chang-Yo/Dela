import type { AgentTool } from '../registry';
import { createEventTool } from './create-event';
import { deleteEventTool } from './delete-event';
import { queryScheduleTool } from './query-schedule';
import { refreshTimetableTool } from './refresh-timetable';
import { getTimetableStatusTool } from './status';

export const timetableTools = {
  get_timetable_status: getTimetableStatusTool,
  query_schedule: queryScheduleTool,
  refresh_timetable: refreshTimetableTool,
  create_event: createEventTool,
  delete_event: deleteEventTool,
} satisfies Record<string, AgentTool>;
