import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from './skill/SKILL.md?raw';
import { queryScheduleTool } from './query-schedule';

export const timetableDomain = {
  name: 'timetable',
  description: '查询课表',
  skill: { name: 'curriculum', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    query_schedule: queryScheduleTool,
  },
} satisfies CommandDomain;
