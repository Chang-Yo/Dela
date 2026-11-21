import { saveTodo } from '../store';
import { todoSaveSchema } from '../../contract';
import { tool, toolError } from '../../../../core/capabilities/domain-tools';
import { slimTodo } from './slim';

export const saveTodoTool = tool(
  '新建或修改个人待办（本地写）。提供 id 时更新已有条目；不能修改外部来源的条目（如 Canvas 作业，其状态由同步更新），不会提交作业。completed 控制完成状态；dueAt 为 UTC ISO 8601；calendar+color 控制是否在日历中按截止时间显示。',
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
