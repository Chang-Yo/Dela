import { z } from 'zod';
import { getTodoState } from '../../../../modules/todo';
import {
  coverage,
  freshness,
  limit,
  offset,
  page,
  tool,
} from '../../../../core/capabilities/domain-tools';
import { canvasTaskSource } from '../todo-source';
import { requireCanvasConfigured } from './helpers';

export const queryAssignmentsTool = tool(
  '查询 Canvas 作业的截止视图（只读待办缓存）：按课程与截止时间范围筛选，status 为 open/done/unknown，statusLabel 是 Canvas 的提交状态；unknown 既不算已完成也不算未完成。个人待办请用 query_todos，需要更新状态先调用 refresh_todos。',
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
    requireCanvasConfigured();
    const state = getTodoState();
    const source = state.sources.find((item) => item.id === canvasTaskSource.id);
    const items = state.items.flatMap(({ bodyHtml: _omit, ...item }) =>
      item.source === canvasTaskSource.id &&
      (courseId === undefined || item.group?.id === String(courseId)) &&
      (!startAt || (item.dueAt && Date.parse(item.dueAt) >= Date.parse(startAt))) &&
      (!endAt || (item.dueAt && Date.parse(item.dueAt) < Date.parse(endAt))) &&
      (completed === undefined || item.status === (completed ? 'done' : 'open'))
        ? [item]
        : [],
    );
    return {
      ...page(items, offset, limit),
      freshness: freshness('cached', source?.syncedAt ?? undefined),
      coverage: coverage(
        'cached_assignments',
        !source?.error,
        source?.error ? [`上次同步出错：${source.error}`] : undefined,
      ),
    };
  },
);
