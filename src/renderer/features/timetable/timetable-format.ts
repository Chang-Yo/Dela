import { classPeriods } from '../../../shared/schedule';
import type { CSSProperties } from 'react';
import {
  calendarEventColors,
  type CalendarEvent,
  type CalendarEventColor,
  type TimetableLesson,
} from '../../../shared/api';

export const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const dayMilliseconds = 86_400_000;
export const timelineStart = 8 * 60;
export const timelineEnd = 24 * 60;
export const pixelsPerMinute = 0.8;

// 候选配色与 globals.css 的 --cal-* token 对应：低饱和灰调，明暗主题各自成对。
export const eventPalette: readonly { key: CalendarEventColor; label: string }[] = [
  { key: 'rose', label: '玫红' },
  { key: 'peach', label: '杏橙' },
  { key: 'sand', label: '沙黄' },
  { key: 'sage', label: '草绿' },
  { key: 'teal', label: '湖青' },
  { key: 'blue', label: '雾蓝' },
  { key: 'lilac', label: '藕紫' },
  { key: 'slate', label: '石墨' },
];

export function eventColorStyle(key: CalendarEventColor): CSSProperties {
  return {
    backgroundColor: `var(--cal-${key}-bg)`,
    color: `var(--cal-${key}-text)`,
  };
}

// 课程块按课程号或课程名稳定分配候选色。
export function colorFor(value: string): CalendarEventColor {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return calendarEventColors[Math.abs(hash) % calendarEventColors.length]!;
}

// 手动事件未选色时用石墨中性色，与自动配色的课程区分。
export function calendarToneKey(color: string | null | undefined): CalendarEventColor {
  return color && calendarEventColors.includes(color as CalendarEventColor)
    ? (color as CalendarEventColor)
    : 'slate';
}

export function eventTone(color: string | null | undefined): CSSProperties {
  return eventColorStyle(calendarToneKey(color));
}

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function roundToMinute(date: Date): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);
  return next;
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function mondayOf(date: Date): Date {
  const day = date.getDay() || 7;
  return addDays(startOfDay(date), 1 - day);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function weekdayName(date: Date): string {
  return weekDays[(date.getDay() + 6) % 7]!;
}

export function formatMinuteOfDay(minute: number): string {
  return `${`${Math.floor(minute / 60)}`.padStart(2, '0')}:${`${minute % 60}`.padStart(2, '0')}`;
}

// 事件的完整起止时间：同日只写一个日期，跨日两端各带日期与星期。
export function formatEventRange(event: Pick<CalendarEvent, 'startAt' | 'endAt'>): string {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const startText = `${formatMonthDay(start)}（${weekdayName(start)}）${formatTime(start)}`;
  return dateKey(start) === dateKey(end)
    ? `${startText} – ${formatTime(end)}`
    : `${startText} – ${formatMonthDay(end)}（${weekdayName(end)}）${formatTime(end)}`;
}

// 事件在某天的首末段标志：只有事件真实起止日才是 start/end，
// 被周视图切割的延续日不算；结束恰为午夜时与 localEventsByDay 一致记为前一天。
export function eventDayEdges(
  event: Pick<CalendarEvent, 'startAt' | 'endAt'>,
  day: Date,
): { isStart: boolean; isEnd: boolean } {
  const dayTime = startOfDay(day).getTime();
  const end = new Date(event.endAt);
  const endDay = startOfDay(new Date(end.getTime() - (end.getHours() || end.getMinutes() ? 0 : 1)));
  return {
    isStart: startOfDay(new Date(event.startAt)).getTime() === dayTime,
    isEnd: endDay.getTime() === dayTime,
  };
}

export function semesterLabel(semester: string): string {
  const [start, end, term] = semester.split('-');
  const names: Record<string, string> = { '1': '秋季学期', '2': '春季学期', '3': '夏季学期' };
  return `${start}-${end} ${names[term ?? ''] ?? `第 ${term} 学期`}`;
}

export function semesterOptions(current: string): string[] {
  const [startText, , termText] = current.split('-');
  const start = Number(startText);
  const term = Number(termText);
  if (!Number.isInteger(start) || !Number.isInteger(term)) return [current];
  const options = [current];
  let year = start;
  let semester = term;
  while (options.length < 6) {
    semester -= 1;
    if (semester === 0) {
      semester = 3;
      year -= 1;
    }
    options.push(`${year}-${year + 1}-${semester}`);
  }
  return options;
}

export function formatSyncTime(value: string | null): string {
  if (!value) return '尚未同步';
  return `同步于 ${new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))}`;
}

export function periodBoundary(period: number, edge: 'start' | 'end'): number {
  const known = classPeriods[period - 1];
  if (known) return edge === 'start' ? known[0] : known[1];
  const start = timelineStart + (period - 1) * 55;
  return edge === 'start' ? start : start + 45;
}

export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function eventStyle(startMinute: number, endMinute: number): CSSProperties {
  return {
    top: (startMinute - timelineStart) * pixelsPerMinute,
    height: Math.max(28, (endMinute - startMinute) * pixelsPerMinute),
  };
}

// 日列内并排布局的结果：left/width 是相对日列宽度的 0–100 百分比数值，
// 供 style.left / style.width 拼接 % 使用。
export type DayColumnLayout = { left: number; width: number };

// 把时间重叠的项聚成簇，簇内按开始时间排序后贪心分配列（first-fit）：
// 每项宽度 = 100 / 簇内最大列数，left = 列号 × 每项宽度。
// 仅严格相交（start < other.end 且 other.start < end）算重叠；
// 首尾相接（前一项的 end 等于后一项的 start）不算，各项仍占满整列。
export function layoutDayColumns(
  items: readonly { id: string; start: number; end: number }[],
): Map<string, DayColumnLayout> {
  const layout = new Map<string, DayColumnLayout>();
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  let index = 0;
  while (index < sorted.length) {
    // 已按开始时间排序，簇通过严格相交传递扩张：下一项开始早于簇内最晚结束时刻即并入。
    let clusterEnd = sorted[index]!.end;
    let clusterEndIndex = index + 1;
    while (clusterEndIndex < sorted.length && sorted[clusterEndIndex]!.start < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, sorted[clusterEndIndex]!.end);
      clusterEndIndex += 1;
    }
    // 每列记录最后一项的结束时刻，放入第一个不冲突的列，放不下则新开一列。
    const columns: number[] = [];
    const placed = sorted.slice(index, clusterEndIndex).map((item) => {
      let column = columns.findIndex((end) => end <= item.start);
      if (column === -1) {
        column = columns.length;
        columns.push(item.end);
      } else {
        columns[column] = item.end;
      }
      return { item, column };
    });
    for (const { item, column } of placed) {
      layout.set(item.id, { left: (column / columns.length) * 100, width: 100 / columns.length });
    }
    index = clusterEndIndex;
  }
  return layout;
}

export function weekStartFor(semesterStart: string | null, week: number): Date | null {
  if (!semesterStart) return null;
  return addDays(mondayOf(parseDate(semesterStart)), (week - 1) * 7);
}

export function weekForDate(semesterStart: string | null, date: Date): number | null {
  if (!semesterStart) return null;
  return (
    Math.floor(
      (mondayOf(date).getTime() - mondayOf(parseDate(semesterStart)).getTime()) /
        (7 * dayMilliseconds),
    ) + 1
  );
}

export function activeInWeek(lesson: TimetableLesson, week: number): boolean {
  return lesson.weekNumbers.length === 0 || lesson.weekNumbers.includes(week);
}

export function localEventsByDay(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const start = startOfDay(new Date(event.startAt));
    const end = new Date(event.endAt);
    // 结束时刻恰为午夜时归属前一天，避免跨天任务多占一天。
    const last = startOfDay(new Date(end.getTime() - (end.getHours() || end.getMinutes() ? 0 : 1)));
    for (let day = start; day.getTime() <= last.getTime(); day = addDays(day, 1)) {
      const key = dateKey(day);
      const current = grouped.get(key);
      if (current) current.push(event);
      else grouped.set(key, [event]);
    }
  }
  return grouped;
}

export function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
