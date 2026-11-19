import type { CalendarEventColor, TodoItem } from '../contract';
import { addDays, colorFor, dateKey, dayMilliseconds, mondayOf } from './calendar';

/** Canvas 作业以课程代码为颜色键，与课表同走 `colorFor`，缺失时退回课程名；个人待办沿用自身颜色。 */
export function todoCalendarColor(item: TodoItem): CalendarEventColor {
  if (item.source === 'personal') return item.color ?? 'slate';
  return colorFor(item.courseCode || item.courseName || `course:${item.courseId ?? 'canvas'}`);
}

export function groupTodosByDay(items: readonly TodoItem[]): Map<string, TodoItem[]> {
  const grouped = new Map<string, TodoItem[]>();
  for (const item of items) {
    if (!item.dueAt) continue;
    const due = new Date(item.dueAt);
    if (Number.isNaN(due.getTime())) continue;
    const key = dateKey(due);
    const current = grouped.get(key);
    if (current) current.push(item);
    else grouped.set(key, [item]);
  }
  for (const dayItems of grouped.values()) {
    dayItems.sort(
      (a, b) =>
        Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? '') || a.title.localeCompare(b.title),
    );
  }
  return grouped;
}

export function monthGridDays(month: Date): Date[] {
  const first = mondayOf(new Date(month.getFullYear(), month.getMonth(), 1));
  const nextMonth = mondayOf(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const count = Math.round((addDays(nextMonth, 7).getTime() - first.getTime()) / dayMilliseconds);
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

export function monthLabel(month: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(month);
}
