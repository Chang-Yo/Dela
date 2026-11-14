import { createHash } from 'node:crypto';
import type { TodoItem, TodoStatus } from '../../modules/todo/contract';
import type { TaskSource } from '../../modules/todo';
import { loadCanvasToken } from '../credentials';
import { listTodoCanvasAssignments, listTodoCanvasCourses } from './api';

/** Canvas 账号指纹：令牌的哈希，待办与通知据此区分账号。 */
export function canvasOwner(): string | null {
  const token = loadCanvasToken();
  return token ? createHash('sha256').update(token).digest('hex') : null;
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

export const canvasTaskSource: TaskSource = {
  owner: canvasOwner,
  courses: listTodoCanvasCourses,
  async tasks(owner, course) {
    const now = new Date().toISOString();
    const assignments = await listTodoCanvasAssignments(course.id);
    return assignments.flatMap((a): TodoItem[] => {
      if (typeof a.id !== 'number' || a.published === false) return [];
      const sub = a.submission as Record<string, unknown> | undefined;
      return [
        {
          id: `canvas:${owner}:${course.id}:${a.id}`,
          source: 'canvas',
          assignmentId: a.id,
          courseId: course.id,
          courseCode: course.code || undefined,
          courseName: course.name,
          title: typeof a.name === 'string' ? a.name : '未命名作业',
          notes: '',
          dueAt: typeof a.due_at === 'string' ? a.due_at : null,
          status: canvasTodoStatus(a),
          submittedAt: typeof sub?.submitted_at === 'string' ? sub.submitted_at : null,
          url: typeof a.html_url === 'string' ? a.html_url : undefined,
          description: typeof a.description === 'string' ? a.description : undefined,
          createdAt: typeof a.created_at === 'string' ? a.created_at : now,
          syncedAt: now,
          readAt: null,
        },
      ];
    });
  },
};
