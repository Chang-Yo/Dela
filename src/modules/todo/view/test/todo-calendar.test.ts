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
    time: { kind: 'due', at: new Date(2026, 9, 21, 23, 59).toISOString() },
    status: 'open',
    completedAt: null,
    readAt: null,
    createdAt: new Date(2026, 9, 1).toISOString(),
    ...overrides,
  };
}

const due = (hour: number, day = 21) => ({
  kind: 'due' as const,
  at: new Date(2026, 9, day, hour).toISOString(),
});

describe('TODO 月历', () => {
  it('按本地日期分组、按开始时刻排序，全天铺满起止之间的每一天', () => {
    const grouped = groupTodosByDay([
      todo({ id: 'late', time: due(9) }),
      todo({ id: 'early', time: due(8) }),
      todo({ id: 'next-day', time: due(8, 22) }),
      todo({
        id: 'trip',
        time: { kind: 'allDay', startDate: '2026-10-21', endDate: '2026-10-23' },
      }),
      todo({ id: 'undated', time: null }),
    ]);

    const ids = (day: number) =>
      grouped.get(dateKey(new Date(2026, 9, day)))?.map((item) => item.id);
    expect(ids(21)).toEqual(['trip', 'early', 'late']);
    expect(ids(22)).toEqual(['trip', 'next-day']);
    expect(ids(23)).toEqual(['trip']);
    expect(grouped.size).toBe(3);
  });

  it('月历从周一开始并补齐完整周', () => {
    const days = monthGridDays(new Date(2026, 9, 1));

    expect(days).toHaveLength(35);
    expect(days[0]!.getDay()).toBe(1);
    expect(dateKey(days[0]!)).toBe('2026-09-28');
    expect(days.some((day) => dateKey(day) === '2026-10-31')).toBe(true);
  });
});
