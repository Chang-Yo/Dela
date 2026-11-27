import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from './skill/SKILL.md?raw';
import { linkCanvasSourceTool } from './link-source';
import { listCanvasCoursesTool } from './list-courses';
import { queryAssignmentsTool } from './query-assignments';
import { refreshCanvasCourseTool } from './refresh-course';
import { refreshCanvasCoursesTool } from './refresh-courses';
import { searchCanvasSourcesTool } from './search-sources';
import { getCanvasStatusTool } from './status';

export const canvasDomain = {
  name: 'canvas',
  description: '查询、同步 Canvas 课程、资料与作业',
  skill: { name: 'canvas', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    get_canvas_status: getCanvasStatusTool,
    list_canvas_courses: listCanvasCoursesTool,
    search_canvas_sources: searchCanvasSourcesTool,
    query_assignments: queryAssignmentsTool,
    refresh_canvas_courses: refreshCanvasCoursesTool,
    refresh_canvas_course: refreshCanvasCourseTool,
    link_canvas_source: linkCanvasSourceTool,
  },
} satisfies CommandDomain;
