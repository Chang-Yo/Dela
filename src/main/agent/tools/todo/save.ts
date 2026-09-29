import { saveTodo, todoSaveSchema } from '../../../todo';
import { tool } from '../shared';

export const saveTodoTool = tool(
  '新建或修改个人待办，completed 控制完成状态。提供 id 时更新已有条目；不能修改 Canvas 作业状态，不会提交作业。',
  todoSaveSchema,
  saveTodo,
);
