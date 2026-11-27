import { z } from 'zod';
import { getTodoState, refreshTodos } from '../store';
import { todoSyncedAt, todoSyncError } from '../../contract';
import { coverage, freshness, tool, toolError } from '../../../../core/capabilities/domain-tools';
import { slimTodo } from './slim';

export const refreshTodosTool = tool(
  '从所有已连接来源（如 Canvas 作业）刷新待办缓存（联网写缓存）。次级副作用：已同步过的分组出现新条目时会触发系统桌面通知。不会提交作业。',
  z.object({}).strict(),
  async () => {
    if (!getTodoState().sources.some((source) => source.connected))
      throw toolError('NOT_CONFIGURED', '没有已连接的待办来源，请先在设置中连接（如 Canvas）');
    const result = await refreshTodos();
    const error = todoSyncError(result);
    return {
      ...result,
      items: result.items.map(slimTodo),
      freshness: freshness('cached', todoSyncedAt(result) ?? undefined),
      coverage: coverage(
        'cached_sources',
        !error,
        error ? [`部分分组同步失败：${error}`] : undefined,
      ),
    };
  },
);
