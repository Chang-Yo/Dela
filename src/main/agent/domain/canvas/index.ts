import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from '../../skills/canvas/SKILL.md?raw';
import { linkCanvasSourceTool } from './link-source';
import { listCanvasCoursesTool } from './list-courses';
import { refreshCanvasCourseTool } from './refresh-course';
import { refreshCanvasCoursesTool } from './refresh-courses';
import { searchCanvasSourcesTool } from './search-sources';
import { getCanvasStatusTool } from './status';

export const canvasDomain = {
  name: 'canvas',
  description: '查询、同步 Canvas 课程与资料',
  skill: { name: 'canvas', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    get_canvas_status: getCanvasStatusTool,
    list_canvas_courses: listCanvasCoursesTool,
    search_canvas_sources: searchCanvasSourcesTool,
    refresh_canvas_courses: refreshCanvasCoursesTool,
    refresh_canvas_course: refreshCanvasCourseTool,
    link_canvas_source: linkCanvasSourceTool,
  },
} satisfies CommandDomain;
