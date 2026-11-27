import { z } from 'zod';
import { getTodoState } from '../store';
import { todoInRange, todoSyncedAt } from '../../contract';
import {
  coverage,
  freshness,
  limit,
  match,
  offset,
  page,
  query,
  tool,
} from '../../../../core/capabilities/domain-tools';
import { slimTodo } from './slim';

export const queryTodosTool = tool(
  '查询统一待办与日程（只读本地缓存）：个人待办与已连接来源同步来的条目，关键词匹配标题/备注/分组名（如课程），可按完成状态与时间范围筛选。time 为 null 或三种之一：due（截止时刻 at）、span（同一天的 start–end）、allDay（startDate–endDate，结束日算在内）；startAt/endAt（UTC ISO 8601）筛出与该范围有交集的条目，不含没有时间的待办。status 为 open/done/unknown，unknown 既不算已完成也不算未完成；statusLabel 是来源自己的说法。',
  z
    .object({
      query,
      completed: z.boolean().optional(),
      startAt: z.string().datetime().optional(),
      endAt: z.string().datetime().optional(),
      offset,
      limit,
    })
    .strict(),
  ({ query, completed, startAt, endAt, offset, limit }) => {
    const state = getTodoState();
    const items = state.items.filter(
      (item) =>
        match(`${item.title} ${item.notes} ${item.group?.label ?? ''}`, query) &&
        (completed === undefined || item.status === (completed ? 'done' : 'open')) &&
        todoInRange(item.time, startAt, endAt),
    );
    const warnings = state.sources.flatMap((source) =>
      !source.connected
        ? [`${source.label}未连接：清单不含这类条目`]
        : source.error
          ? [`${source.label}上次同步出错：${source.error}`]
          : [],
    );
    return {
      ...page(items.map(slimTodo), offset, limit),
      freshness: freshness('cached', todoSyncedAt(state) ?? undefined),
      coverage: coverage('todos_and_cached_sources', warnings.length === 0, warnings),
    };
  },
);
