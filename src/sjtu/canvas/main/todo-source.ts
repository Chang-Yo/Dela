import { createHash } from 'node:crypto';
import type { TodoStatus } from '../../../modules/todo/contract';
import type { SourceTask, TaskSource } from '../../../modules/todo';
import { loadCanvasToken } from './credentials';
import { listTodoCanvasAssignments, listTodoCanvasCourses } from './api';

/** Canvas 账号指纹：令牌的哈希，待办与通知据此区分账号。 */
export function canvasOwner(): string | null {
  const token = loadCanvasToken();
  return token ? createHash('sha256').update(token).digest('hex') : null;
}

const progress = (status: TodoStatus, statusLabel: string) => ({ status, statusLabel });

/** 仅按 Canvas 明确返回的提交事实判定；成绩（包括零分）本身不代表完成。 */
export function canvasTodoStatus(assignment: Record<string, unknown>) {
  const sub = assignment.submission as Record<string, unknown> | null | undefined;
  if (!sub || typeof sub !== 'object') return progress('unknown', '待同步确认');
  if (sub.excused === true) return progress('done', '已豁免');
  if (sub.redo_request === true) return progress('open', '需重新提交');
  if (
    sub.submitted_at ||
    sub.workflow_state === 'submitted' ||
    sub.workflow_state === 'pending_review'
  ) {
    return progress('done', sub.workflow_state === 'graded' ? '已批改' : '已提交');
  }
  const types = assignment.submission_types;
  if (
    Array.isArray(types) &&
    types.every((type) => type === 'on_paper' || type === 'none') &&
    types.length
  ) {
    return sub.workflow_state === 'graded' && sub.missing !== true
      ? progress('done', '已批改')
      : progress('unknown', '线下 / 无需在线提交');
  }
  if (
    sub.workflow_state === 'unsubmitted' ||
    sub.missing === true ||
    sub.workflow_state === 'graded'
  )
    return progress('open', '未完成');
  return progress('unknown', '待同步确认');
}

export const canvasTaskSource: TaskSource = {
  id: 'canvas',
  label: 'Canvas 作业',
  openLabel: '在 Canvas 中打开',
  owner: canvasOwner,
  async groups() {
    const courses = await listTodoCanvasCourses();
    return courses.map((course) => ({ id: String(course.id), label: course.name }));
  },
  async tasks(group) {
    const now = new Date().toISOString();
    const assignments = await listTodoCanvasAssignments(Number(group.id));
    return assignments.flatMap((a): SourceTask[] => {
      if (typeof a.id !== 'number' || a.published === false) return [];
      const sub = a.submission as Record<string, unknown> | undefined;
      return [
        {
          externalId: `${group.id}:${a.id}`,
          title: typeof a.name === 'string' ? a.name : '未命名作业',
          dueAt: typeof a.due_at === 'string' ? a.due_at : null,
          ...canvasTodoStatus(a),
          completedAt: typeof sub?.submitted_at === 'string' ? sub.submitted_at : null,
          url: typeof a.html_url === 'string' ? a.html_url : undefined,
          bodyHtml: typeof a.description === 'string' ? a.description : undefined,
          createdAt: typeof a.created_at === 'string' ? a.created_at : now,
        },
      ];
    });
  },
};
