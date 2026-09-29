import { z } from 'zod';
import { refreshTodos } from '../../../todo';
import { tool } from '../shared';

export const refreshTodosTool = tool(
  '从 Canvas 同步在读且未归档课程的作业和提交状态，只读操作，不会提交作业。',
  z.object({}).strict(),
  refreshTodos,
);
