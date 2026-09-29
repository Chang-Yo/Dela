import { z } from 'zod';
import type { TodoItem } from '../../../shared/api';

export const uuid = z.string().uuid();
export const query = z.string().max(500).default('');
export const offset = z.number().int().min(0).default(0);
export const limit = z.number().int().min(1).max(100).default(30);
export const name = z.string().trim().min(1).max(200);

export function page<T>(items: T[], start: number, count: number) {
  return {
    items: items.slice(start, start + count),
    total: items.length,
    nextOffset: start + count < items.length ? start + count : null,
  };
}

// 作业描述 HTML 体积大且面向渲染，不进入模型上下文；需要正文时经 readCanvasSource 读取。
export const slimTodo = ({
  description: _omit,
  ...item
}: TodoItem): Omit<TodoItem, 'description'> => item;

export function tool<T extends z.ZodType>(
  description: string,
  schema: T,
  execute: (input: z.output<T>) => unknown,
) {
  return { description, schema, execute: (input: unknown) => execute(schema.parse(input)) };
}

export function match(value: string, keyword: string) {
  return value.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}
