import { CircleCheckBig } from 'lucide-react';
import { defineView } from '../../../app/module';
import { markTodoRead, TodoView } from './TodoView';

export { TodoView, useTodoState } from './TodoView';

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
