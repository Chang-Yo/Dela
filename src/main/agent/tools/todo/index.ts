import type { AgentTool } from '../registry';
import { queryAssignmentsTool, queryTodosTool } from './query';
import { refreshTodosTool } from './refresh';
import { removeTodoTool } from './remove';
import { saveTodoTool } from './save';

export const todoTools = {
  query_todos: queryTodosTool,
  query_assignments: queryAssignmentsTool,
  save_todo: saveTodoTool,
  remove_todo: removeTodoTool,
  refresh_todos: refreshTodosTool,
} satisfies Record<string, AgentTool>;
