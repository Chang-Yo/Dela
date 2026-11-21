import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../../contract';
import { dateKey } from '../calendar';
import { groupTodosByDay, monthGridDays } from '../todo-calendar';

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    source: 'canvas',
    title: '作业',
    notes: '',
    dueAt: new Date(2026, 9, 21, 23, 59).toISOString(),
    status: 'open',
    completedAt: null,
    readAt: null,
    createdAt: new Date(2026, 9, 1).toISOString(),
    ...overrides,
  };
}

describe('TODO 月历', () => {
  it('按本地日期分组、按截止时刻排序，并跳过没有有效截止时间的待办', () => {
    const grouped = groupTodosByDay([
      todo({ id: 'late', title: '晚交', dueAt: new Date(2026, 9, 21, 9).toISOString() }),
      todo({ id: 'early', title: '早交', dueAt: new Date(2026, 9, 21, 8).toISOString() }),
      todo({ id: 'next-day', dueAt: new Date(2026, 9, 22, 8).toISOString() }),
      todo({ id: 'undated', dueAt: null }),
      todo({ id: 'invalid', dueAt: 'not-a-date' }),
    ]);

    expect(grouped.get(dateKey(new Date(2026, 9, 21)))?.map((item) => item.id)).toEqual([
      'early',
      'late',
    ]);
    expect(grouped.get(dateKey(new Date(2026, 9, 22)))?.map((item) => item.id)).toEqual([
      'next-day',
    ]);
    expect(grouped.size).toBe(2);
  });

  it('月历从周一开始并补齐完整周', () => {
    const days = monthGridDays(new Date(2026, 9, 1));

    expect(days).toHaveLength(35);
    expect(days[0]!.getDay()).toBe(1);
    expect(dateKey(days[0]!)).toBe('2026-09-28');
    expect(days.some((day) => dateKey(day) === '2026-10-31')).toBe(true);
  });
});
