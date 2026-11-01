import type { AgentTool } from '../shared';
import { createEventTool } from './create-event';
import { deleteEventTool } from './delete-event';
import { queryScheduleTool } from './query-schedule';
import { inferSemesterStartTool, setSemesterStartTool } from './semester-start';

export const timetableTools = {
  query_schedule: queryScheduleTool,
  infer_semester_start: inferSemesterStartTool,
  set_semester_start: setSemesterStartTool,
  create_event: createEventTool,
  delete_event: deleteEventTool,
} satisfies Record<string, AgentTool>;
