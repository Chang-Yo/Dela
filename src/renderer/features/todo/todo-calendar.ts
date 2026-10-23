import type { CalendarEventColor, TodoItem } from '../../../shared/api';
import {
  addDays,
  colorFor,
  dateKey,
  dayMilliseconds,
  mondayOf,
} from '../timetable/timetable-format';

/**
 * Canvas 作业用课程代码作为颜色键，与课表的课程条走同一套 `colorFor`；
 * 课程代码缺失时才退回课程名。个人待办不是课程，沿用自身颜色或石墨色。
 */
export function todoCalendarColor(item: TodoItem): CalendarEventColor {
  if (item.source === 'personal') return item.color ?? 'slate';
  return colorFor(item.courseCode || item.courseName || `course:${item.courseId ?? 'canvas'}`);
}

/** 只把有有效截止时间的待办放入日格；同一天内按截止时刻、标题排序。 */
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

/** 月历固定从周一开始，补足到完整周；相邻月份的日期也保留在网格里。 */
export function monthGridDays(month: Date): Date[] {
  const first = mondayOf(new Date(month.getFullYear(), month.getMonth(), 1));
  const nextMonth = mondayOf(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const count = Math.round((addDays(nextMonth, 7).getTime() - first.getTime()) / dayMilliseconds);
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

export function monthLabel(month: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(month);
}
