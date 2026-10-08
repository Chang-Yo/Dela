import { z } from 'zod';
import { getTodoState } from '../../../todo';
import type { TodoItem } from '../../../../shared/api';
import { todoCompleted } from '../../../../shared/todo';
import {
  coverage,
  freshness,
  limit,
  match,
  offset,
  page,
  query,
  slimTodo,
  tool,
  toolError,
} from '../shared';

/** 两个查询工具共用的完成语义：unknown/offline 既不算已完成也不算未完成。 */
function matchesCompleted(item: TodoItem, completed: boolean | undefined) {
  return (
    completed === undefined ||
    (completed ? todoCompleted(item.status) : ['pending', 'resubmit'].includes(item.status))
  );
}

export const queryTodosTool = tool(
  '查询统一待办清单（只读本地缓存）：个人待办与 Canvas 作业，关键词匹配标题/备注/课程名，可按完成状态筛选。查作业截止时间与提交状态请改用 query_assignments；未知与线下状态既不算已完成也不算未完成。',
  z.object({ query, completed: z.boolean().optional(), offset, limit }).strict(),
  ({ query, completed, offset, limit }) => {
    const state = getTodoState();
    const items = state.items.filter(
      (item) =>
        match(`${item.title} ${item.notes} ${item.courseName ?? ''}`, query) &&
        matchesCompleted(item, completed),
    );
    const warnings: string[] = [];
    if (!state.connected) warnings.push('Canvas 未连接：清单只含个人待办，作业不可见');
    if (state.error) warnings.push(`上次作业同步出错：${state.error}`);
    return {
      ...page(items.map(slimTodo), offset, limit),
      freshness: freshness('cached', state.syncedAt ?? undefined),
      coverage: coverage('personal_todos_and_cached_assignments', warnings.length === 0, warnings),
    };
  },
);

export const queryAssignmentsTool = tool(
  '查询 Canvas 作业的截止视图（只读本地缓存）：按课程与截止时间范围筛选，含真实提交状态；个人待办请用 query_todos。需要更新状态先调用 refresh_todos；未知与线下状态既不算已完成也不算未完成。',
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
    if (!state.connected)
      throw toolError('NOT_CONFIGURED', 'Canvas 未连接，无法查询作业；请先在设置中连接 Canvas');
    const items = state.items.filter(
      (item) =>
        item.source === 'canvas' &&
        (courseId === undefined || item.courseId === courseId) &&
        (!startAt || (item.dueAt && Date.parse(item.dueAt) >= Date.parse(startAt))) &&
        (!endAt || (item.dueAt && Date.parse(item.dueAt) < Date.parse(endAt))) &&
        matchesCompleted(item, completed),
    );
    return {
      ...page(items.map(slimTodo), offset, limit),
      freshness: freshness('cached', state.syncedAt ?? undefined),
      coverage: coverage(
        'cached_assignments',
        !state.error,
        state.error ? [`上次同步出错：${state.error}`] : undefined,
      ),
    };
  },
);
