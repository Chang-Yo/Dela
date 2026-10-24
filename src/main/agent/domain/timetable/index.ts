import type { AgentTool } from '../shared';
import { createEventTool } from './create-event';
import { deleteEventTool } from './delete-event';
import { queryScheduleTool } from './query-schedule';

export const timetableTools = {
  query_schedule: queryScheduleTool,
  create_event: createEventTool,
  delete_event: deleteEventTool,
} satisfies Record<string, AgentTool>;
