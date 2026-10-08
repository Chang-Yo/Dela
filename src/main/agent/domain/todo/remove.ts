import { z } from 'zod';
import { getTodoState, removeTodo } from '../../../todo';
import { slimTodo, tool, toolError } from '../shared';

export const removeTodoTool = tool(
  '删除个人待办（本地写，仅个人待办；Canvas 作业由同步管理，不可删除）。删除前做存在性检查，未知 id 返回 NOT_FOUND。',
  z.object({ id: z.string().min(1).max(512) }).strict(),
  ({ id }) => {
    const target = getTodoState().items.find((item) => item.id === id);
    if (!target) throw toolError('NOT_FOUND', '待办不存在或已删除');
    if (target.source === 'canvas')
      throw toolError('OPERATION_FAILED', '不能删除 Canvas 作业（由同步管理），仅个人待办可删除');
    const state = removeTodo(id);
    return { removedId: id, ...state, items: state.items.map(slimTodo) };
  },
);
