import type { AgentTool } from '../shared';
import { listCanvasCoursesTool } from './list-courses';
import { refreshCanvasCourseTool } from './refresh-course';
import { refreshCanvasCoursesTool } from './refresh-courses';
import { searchCanvasSourcesTool } from './search-sources';
import { getCanvasStatusTool } from './status';

export const canvasTools = {
  get_canvas_status: getCanvasStatusTool,
  list_canvas_courses: listCanvasCoursesTool,
  search_canvas_sources: searchCanvasSourcesTool,
  refresh_canvas_courses: refreshCanvasCoursesTool,
  refresh_canvas_course: refreshCanvasCourseTool,
} satisfies Record<string, AgentTool>;
