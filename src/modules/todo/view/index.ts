// 待办模块的渲染端出口。日历的日期、配色与选色控件也给课表用。
import { CircleCheckBig } from 'lucide-react';
import { defineView } from '../../../app/module';
import { markTodoRead, TodoView } from './TodoView';

export { TodoView, useTodoState } from './TodoView';
export { EventColorRow } from './EventColorRow';
export * from './calendar';

export const todoView = defineView({
  pages: {
    todo: {
      component: TodoView,
      open: ({ todoId }) => {
        if (todoId) markTodoRead(todoId);
      },
    },
  },
  notices: { todo: { label: 'TODO', icon: CircleCheckBig } },
});
