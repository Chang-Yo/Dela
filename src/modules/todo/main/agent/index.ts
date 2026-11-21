import type { CommandDomain } from '../../../../core/capabilities/commands';
import skill from './skill/SKILL.md?raw';
import { queryTodosTool } from './query';
import { refreshTodosTool } from './refresh';
import { removeTodoTool } from './remove';
import { saveTodoTool } from './save';

export const todoDomain = {
  name: 'todo',
  description: '查询与管理待办',
  skill: { name: 'todo', files: [{ path: 'SKILL.md', content: skill }] },
  commands: {
    query_todos: queryTodosTool,
    save_todo: saveTodoTool,
    remove_todo: removeTodoTool,
    refresh_todos: refreshTodosTool,
  },
} satisfies CommandDomain;
