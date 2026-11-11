import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from '../../skills/curriculum/SKILL.md?raw';
import { createEventTool } from './create-event';
import { deleteEventTool } from './delete-event';
import { queryScheduleTool } from './query-schedule';

export const timetableDomain = {
  name: 'timetable',
  description: '查询课表与日程，同步课表、创建或删除日程',
  skill: { name: 'curriculum', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    query_schedule: queryScheduleTool,
    create_event: createEventTool,
    delete_event: deleteEventTool,
  },
} satisfies CommandDomain;
