import { z } from 'zod';
import { getTodoState } from '../../../todo';
import { todoCompleted } from '../../../../shared/todo';
import { limit, match, offset, page, query, slimTodo, tool } from '../shared';

export const queryTodosTool = tool(
  '查询本地个人待办和 Canvas 作业。已读与完成独立，未知或线下状态不能当成未提交；返回同步时间与错误。',
  z.object({ query, completed: z.boolean().optional(), offset, limit }).strict(),
  ({ query, completed, offset, limit }) => {
    const state = getTodoState();
    const items = state.items.filter(
      (item) =>
        match(`${item.title} ${item.notes} ${item.courseName ?? ''}`, query) &&
        (completed === undefined ||
          (completed ? todoCompleted(item.status) : ['pending', 'resubmit'].includes(item.status))),
    );
    return {
      ...page(items.map(slimTodo), offset, limit),
      syncedAt: state.syncedAt,
      error: state.error,
    };
  },
);

export const queryAssignmentsTool = tool(
  '查询 TODO 缓存中的 Canvas 作业、截止时间和真实提交状态。首次使用或缓存过期时调用 refresh_todos。未知与线下状态不会归为未完成。',
  z
    .object({
      courseId: z.number().int().positive().optional(),
      startAt: z.string().datetime().optional(),
      endAt: z.string().datetime().optional(),
      completed: z.boolean().optional(),
      offset,
      limit,
    })
    .strict(),
  ({ courseId, startAt, endAt, completed, offset, limit }) => {
    const state = getTodoState();
    const items = state.items.filter(
      (item) =>
        item.source === 'canvas' &&
        (courseId === undefined || item.courseId === courseId) &&
        (!startAt || (item.dueAt && Date.parse(item.dueAt) >= Date.parse(startAt))) &&
        (!endAt || (item.dueAt && Date.parse(item.dueAt) < Date.parse(endAt))) &&
        (completed === undefined ||
          (completed ? todoCompleted(item.status) : ['pending', 'resubmit'].includes(item.status))),
    );
    return {
      ...page(items.map(slimTodo), offset, limit),
      coverage: 'cached_assignments',
      syncedAt: state.syncedAt,
      error: state.error,
    };
  },
);
