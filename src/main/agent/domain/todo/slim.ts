import type { TodoItem } from '../../../../modules/todo/contract';

// 作业描述 HTML 体积大且面向渲染，不进入模型上下文；需要正文时经 readCanvasSource 读取。
export const slimTodo = ({
  description: _omit,
  ...item
}: TodoItem): Omit<TodoItem, 'description'> => item;
