// 待办：个人待办与外部作业来源（经 registerTaskSource 注册）的同步，状态以 todo:state 推送。
import { defineModule } from '../../app/module';
import { implement } from '../../core/protocol/contract';
import { todoContract } from './contract';
import { getTodoState, markTodoRead, refreshTodos, removeTodo, saveTodo } from './main/store';

export {
  getTodoState,
  markTodoRead,
  onTaskNotice,
  publishTodoState,
  refreshTodos,
  registerTaskSource,
  removeTodo,
  saveTodo,
  todoNotifications,
  type TaskCourse,
  type TaskSource,
} from './main/store';
export { todoSearch } from './main/search';

const REFRESH_MS = 15 * 60_000;

function syncInBackground() {
  void refreshTodos().catch((error: unknown) => console.error('TODO sync failed', error));
}

export const todoModule = defineModule({
  id: 'todo',
  ipc: implement(todoContract, {
    state: getTodoState,
    refresh: refreshTodos,
    save: saveTodo,
    remove: removeTodo,
    markRead: markTodoRead,
  }),
  start() {
    syncInBackground();
    const timer = setInterval(syncInBackground, REFRESH_MS);
    return () => clearInterval(timer);
  },
});
