import type { SearchProvider } from '../../search';
import { todoStatusLabel } from '../contract';
import { getTodoState } from './store';

export const todoSearch: SearchProvider = {
  id: 'todo',
  label: 'TODO',
  icon: 'check',
  search(query, limit) {
    const keyword = query.toLocaleLowerCase();
    return getTodoState()
      .items.filter((item) =>
        `${item.title} ${item.notes} ${item.group?.label ?? ''}`
          .toLocaleLowerCase()
          .includes(keyword),
      )
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: `${item.group?.label ?? '个人待办'} · ${todoStatusLabel(item)}${item.dueAt ? ` · ${item.dueAt}` : ''}`,
        target: { page: 'todo', todoId: item.id },
      }));
  },
};
