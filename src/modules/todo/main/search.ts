import type { SearchProvider } from '../../search';
import { todoStatusLabels } from '../contract';
import { getTodoState } from './store';

export const todoSearch: SearchProvider = {
  id: 'todo',
  label: 'TODO / 作业',
  icon: 'check',
  search(query, limit) {
    const keyword = query.toLocaleLowerCase();
    return getTodoState()
      .items.filter((item) =>
        `${item.title} ${item.notes} ${item.courseName ?? ''}`
          .toLocaleLowerCase()
          .includes(keyword),
      )
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: `${item.courseName ?? '个人待办'} · ${todoStatusLabels[item.status]}${item.dueAt ? ` · ${item.dueAt}` : ''}`,
        target: { page: 'todo', todoId: item.id },
      }));
  },
};
