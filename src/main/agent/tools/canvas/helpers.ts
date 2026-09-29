import { z } from 'zod';
import type { CanvasCourse, CanvasState } from '../../../../shared/canvas';
import { getCanvasState } from '../../../canvas/api';
import { ToolError, toolError } from '../shared';

/** syncCourse 各分支的标识与中文标签（与 canvas/api.ts branch() 写入 course.error 的前缀一致）。 */
export const canvasSyncBranches = [
  { key: 'files', label: '文件' },
  { key: 'assignments', label: '作业' },
  { key: 'discussions', label: '通知与讨论' },
  { key: 'modules', label: '课程模块' },
] as const;

/** 课程瘦身：列表/状态共用的字段形态（内容同步时间与分支错误就地可见）。 */
export function courseSummary(course: CanvasCourse) {
  return {
    id: course.id,
    name: course.name,
    term: course.term,
    code: course.code,
    archived: course.archived ?? false,
    contentSyncedAt: course.syncedAt,
    error: course.error,
  };
}

/** 未保存令牌（getCanvasState().connected 仅代表本地 token 存在性）时统一返回 NOT_CONFIGURED。 */
export function requireCanvasConfigured(state: CanvasState = getCanvasState()) {
  if (!state.connected)
    throw toolError('NOT_CONFIGURED', '尚未连接 Canvas（未保存访问令牌），请先在设置中连接 Canvas');
}

/** Canvas 业务错误 → 细分错误码；未识别的错误原样抛出（registry 兜底 OPERATION_FAILED）。 */
export function mapCanvasError(error: unknown): Error {
  if (error instanceof ToolError || error instanceof z.ZodError || !(error instanceof Error))
    return error instanceof Error ? error : new Error(String(error));
  const message = error.message;
  if (message.includes('请先连接 Canvas')) return toolError('NOT_CONFIGURED', message);
  if (message.includes('无法连接 Canvas')) return toolError('NETWORK_ERROR', message);
  if (message.includes('401')) return toolError('AUTH_EXPIRED', message);
  if (message.includes('404') || message.includes('课程不存在') || message.includes('资料尚未同步'))
    return toolError('NOT_FOUND', message);
  if (message.includes('Canvas HTTP') || message.includes('Canvas 返回了重复分页'))
    return toolError('UPSTREAM_ERROR', message);
  return error;
}

export async function withCanvasErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw mapCanvasError(error);
  }
}
