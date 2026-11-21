import { z } from 'zod';
import { getTodoState } from '../store';
import { todoSyncedAt } from '../../contract';
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
  '查询统一待办清单（只读本地缓存）：个人待办与已连接来源同步来的条目，关键词匹配标题/备注/分组名（如课程），可按完成状态筛选。status 为 open/done/unknown，unknown 既不算已完成也不算未完成；statusLabel 是来源自己的说法。',
  z.object({ query, completed: z.boolean().optional(), offset, limit }).strict(),
  ({ query, completed, offset, limit }) => {
    const state = getTodoState();
    const items = state.items.filter(
      (item) =>
        match(`${item.title} ${item.notes} ${item.group?.label ?? ''}`, query) &&
        (completed === undefined || item.status === (completed ? 'done' : 'open')),
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
