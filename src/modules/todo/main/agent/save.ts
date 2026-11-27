import { saveTodo } from '../store';
import { todoSaveSchema } from '../../contract';
import { tool, toolError } from '../../../../core/capabilities/domain-tools';
import { slimTodo } from './slim';

export const saveTodoTool = tool(
  '新建或修改个人待办（本地写）。提供 id 时更新已有条目；不能修改外部来源的条目（如 Canvas 作业，其状态由同步更新），不会提交作业。completed 控制完成状态。time 三选一或 null：{kind:"due",at} 截止时刻；{kind:"span",start,end} 同一天内的时段；{kind:"allDay",startDate,endDate} 按 YYYY-MM-DD 的全天，结束日算在内。时刻用 UTC ISO 8601（Z）。带时间的待办都显示在月历上，color 可选 rose/peach/sand/sage/teal/blue/lilac/slate。',
  todoSaveSchema,
  (input) => {
    try {
      const state = saveTodo(input);
      return { ...state, items: state.items.map(slimTodo) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('待办不存在')) throw toolError('NOT_FOUND', message);
      throw error;
    }
  },
);
