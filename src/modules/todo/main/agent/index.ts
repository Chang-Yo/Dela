import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from '../../skills/todo/SKILL.md?raw';
import { queryAssignmentsTool, queryTodosTool } from './query';
import { refreshTodosTool } from './refresh';
import { removeTodoTool } from './remove';
import { saveTodoTool } from './save';

export const todoDomain = {
  name: 'todo',
  description: '查询与管理待办、Canvas 作业',
  skill: { name: 'todo', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    query_todos: queryTodosTool,
    query_assignments: queryAssignmentsTool,
    save_todo: saveTodoTool,
    remove_todo: removeTodoTool,
    refresh_todos: refreshTodosTool,
  },
} satisfies CommandDomain;
