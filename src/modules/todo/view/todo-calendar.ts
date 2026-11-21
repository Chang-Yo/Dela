import { todoTimeRange, type CalendarEventColor, type TodoItem, type TodoTime } from '../contract';
import { addDays, colorFor, dateKey, dayMilliseconds, formatTime, mondayOf } from './calendar';

/** 来源条目按分组配色，同一分组颜色固定；个人待办沿用自身颜色。 */
export function todoCalendarColor(item: TodoItem): CalendarEventColor {
  if (item.source === 'personal') return item.color ?? 'slate';
  return colorFor(`${item.source}:${item.group?.id ?? ''}`);
}

/** 截止与时段落在当天，全天铺满起止之间的每一天。 */
function timeDays(time: TodoTime): string[] {
  if (time.kind === 'due') return [dateKey(new Date(time.at))];
  if (time.kind === 'span') return [dateKey(new Date(time.start))];
  const days: string[] = [];
  for (
    let day = new Date(`${time.startDate}T00:00:00`);
    dateKey(day) <= time.endDate;
    day = addDays(day, 1)
  )
    days.push(dateKey(day));
  return days;
}

/** 日格里显示的时刻：截止时刻或时段开始，全天不显示。 */
export function todoChipTime(time: TodoTime | null): string {
  if (!time || time.kind === 'allDay') return '';
  return formatTime(new Date(time.kind === 'due' ? time.at : time.start));
}

export function groupTodosByDay(items: readonly TodoItem[]): Map<string, TodoItem[]> {
  const grouped = new Map<string, TodoItem[]>();
  for (const item of items) {
    if (!item.time) continue;
    for (const key of timeDays(item.time)) {
      const current = grouped.get(key);
      if (current) current.push(item);
      else grouped.set(key, [item]);
    }
  }
  const start = (item: TodoItem) => todoTimeRange(item.time!)[0];
  for (const dayItems of grouped.values())
    dayItems.sort((a, b) => start(a) - start(b) || a.title.localeCompare(b.title));
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
