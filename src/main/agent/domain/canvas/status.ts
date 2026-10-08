import { z } from 'zod';
import { getCanvasState } from '../../../canvas/api';
import { tool } from '../shared';
import { courseSummary } from './helpers';

export const getCanvasStatusTool = tool(
  '查询 Canvas 状态（只读，不发起网络请求）：访问令牌是否已保存（不代表已验证有效）、课程列表同步时间、各课程内容同步时间/同步错误/归档标记。',
  z.object({}).strict(),
  () => {
    const state = getCanvasState();
    const warnings: string[] = [];
    if (!state.connected) warnings.push('未保存 Canvas 访问令牌；请在设置中连接 Canvas');
    else if (!state.syncedAt) warnings.push('课程列表尚未同步；请调用 refresh_canvas_courses');
    return {
      credentialSaved: state.connected,
      courseListSyncedAt: state.syncedAt,
      courses: state.courses.map(courseSummary),
      ...(warnings.length ? { warnings } : {}),
    };
  },
);
