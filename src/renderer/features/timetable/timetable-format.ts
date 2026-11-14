import { classPeriods } from '../../../shared/schedule';
import type { CSSProperties } from 'react';
import type { CalendarEvent, TimetableLesson } from '../../../shared/api';
import {
  addDays,
  dateKey,
  dayMilliseconds,
  formatMonthDay,
  formatTime,
  mondayOf,
  startOfDay,
  weekdayName,
} from '../../../modules/todo/view';

export const timelineStart = 8 * 60;
export const timelineEnd = 24 * 60;

/** 时间轴刻度：1rem 折 20 分钟（默认 16px 根字号下即原来的 0.8px/分）。刻度与块内的文字、内边距
 *  同为 rem，字号设置一变一起缩放；若写成固定 px，块高会停在旧尺寸，块内行数阈值随之失效。 */
export function minutesToRem(minutes: number): number {
  return minutes / 20;
}

/** 事件块的高度档位（rem）：min 是块的下限（再短的时段也要容下标题行与内边距），
 *  twoRows 起可放第二行文案，threeRows 起可放第三行——对齐 55 / 75 分钟的课时边界。 */
export const blockHeights = { min: 1.75, twoRows: 2.75, threeRows: 3.75 } as const;

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
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
    top: `${minutesToRem(startMinute - timelineStart)}rem`,
    height: `max(${blockHeights.min}rem, ${minutesToRem(endMinute - startMinute)}rem)`,
  };
}

// 日列内并排布局的结果：left/width 是相对日列宽度的 0–100 百分比数值，
// 供 style.left / style.width 拼接 % 使用。
export type DayColumnLayout = { left: number; width: number };

// 按簇 first-fit 分列：项宽 = 100 / 簇内最大列数，left = 列号 × 项宽。
// 仅严格相交算重叠，首尾相接（前项的 end 等于后项的 start）不算，两项都占满整列。
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
