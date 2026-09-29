import { canvasTools } from './canvas';
import { commonTools } from './common';
import { mailTools } from './mail';
import { shuiyuanTools } from './shuiyuan';
import { timetableTools } from './timetable';
import { todoTools } from './todo';
import { webTools } from './web';
import { workspaceTools } from './workspace';

export const agentTools = {
  ...commonTools,
  ...canvasTools,
  ...workspaceTools,
  ...todoTools,
  ...timetableTools,
  ...mailTools,
  ...webTools,
  ...shuiyuanTools,
};
