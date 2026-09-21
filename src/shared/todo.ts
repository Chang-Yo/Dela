import type { TodoStatus } from './api';

export const todoStatusLabels: Record<TodoStatus, string> = {
  pending: '未完成',
  completed: '已完成',
  submitted: '已提交',
  graded: '已批改',
  excused: '已豁免',
  resubmit: '需重新提交',
  offline: '线下 / 无需在线提交',
  unknown: '待同步确认',
};

export function todoCompleted(status: TodoStatus): boolean {
  return ['completed', 'submitted', 'graded', 'excused'].includes(status);
}

/** 仅按 Canvas 明确返回的提交事实判定；成绩（包括零分）本身不代表完成。 */
export function canvasTodoStatus(assignment: Record<string, unknown>): TodoStatus {
  const sub = assignment.submission as Record<string, unknown> | null | undefined;
  if (!sub || typeof sub !== 'object') return 'unknown';
  if (sub.excused === true) return 'excused';
  if (sub.redo_request === true) return 'resubmit';
  if (
    sub.submitted_at ||
    sub.workflow_state === 'submitted' ||
    sub.workflow_state === 'pending_review'
  ) {
    return sub.workflow_state === 'graded' ? 'graded' : 'submitted';
  }
  const types = assignment.submission_types;
  if (
    Array.isArray(types) &&
    types.every((type) => type === 'on_paper' || type === 'none') &&
    types.length
  ) {
    return sub.workflow_state === 'graded' && sub.missing !== true ? 'graded' : 'offline';
  }
  if (
    sub.workflow_state === 'unsubmitted' ||
    sub.missing === true ||
    sub.workflow_state === 'graded'
  )
    return 'pending';
  return 'unknown';
}
