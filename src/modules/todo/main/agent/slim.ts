import type { TodoItem } from '../../contract';

// 来源正文是面向渲染的 HTML，体积大，不进入模型上下文；需要时经来源模块自己的命令读取。
export const slimTodo = ({ bodyHtml: _omit, ...item }: TodoItem): Omit<TodoItem, 'bodyHtml'> =>
  item;
