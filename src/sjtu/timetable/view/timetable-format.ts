import { classPeriods, type TimetableLesson } from '../contract';
import type { CSSProperties } from 'react';
import { addDays, dayMilliseconds, mondayOf } from '../../../modules/todo/view';

export const timelineStart = 8 * 60;
export const timelineEnd = 24 * 60;

/** 时间轴刻度：1rem 折 20 分钟。与块内文字同为 rem 以随字号缩放；
 *  写成固定 px 会让块高停在旧尺寸，行数阈值随之失效。 */
export function minutesToRem(minutes: number): number {
  return minutes / 20;
}

/** 事件块高度档位（rem）：twoRows、threeRows 起分别放第二、三行，
 *  对齐 55 / 75 分钟的课时边界。 */
export const blockHeights = { min: 1.75, twoRows: 2.75, threeRows: 3.75 } as const;

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function formatMinuteOfDay(minute: number): string {
  return `${`${Math.floor(minute / 60)}`.padStart(2, '0')}:${`${minute % 60}`.padStart(2, '0')}`;
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
