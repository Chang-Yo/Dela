import type { CSSProperties } from 'react';
import type { CalendarEvent, TimetableLesson } from '../../../shared/api';

export const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const dayMilliseconds = 86_400_000;
export const timelineStart = 8 * 60;
export const timelineEnd = 20 * 60 + 20;
export const pixelsPerMinute = 0.8;

// 上海交大教务处公布的本科生节次表。第 13 节仅用于 11–13 节连上的课程。
const classPeriods = [
  [8 * 60, 8 * 60 + 45],
  [8 * 60 + 55, 9 * 60 + 40],
  [10 * 60, 10 * 60 + 45],
  [10 * 60 + 55, 11 * 60 + 40],
  [12 * 60, 12 * 60 + 45],
  [12 * 60 + 55, 13 * 60 + 40],
  [14 * 60, 14 * 60 + 45],
  [14 * 60 + 55, 15 * 60 + 40],
  [16 * 60, 16 * 60 + 45],
  [16 * 60 + 55, 17 * 60 + 40],
  [18 * 60, 18 * 60 + 45],
  [18 * 60 + 55, 19 * 60 + 40],
  [19 * 60 + 50, 20 * 60 + 20],
] as const;

// 课程块配色与首页项目卡片的粉彩一致：实色浅底深字，暗色模式反转。
const lessonTones = [
  'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
];

// 手动事件不占用课程色，用中性色与课程区分。
export const localEventTone = 'bg-secondary text-secondary-foreground';

export function toneFor(value: string): string {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return lessonTones[Math.abs(hash) % lessonTones.length]!;
}

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

export function timeInput(date: Date): string {
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
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
    const key = dateKey(new Date(event.startAt));
    const current = grouped.get(key);
    if (current) current.push(event);
    else grouped.set(key, [event]);
  }
  return grouped;
}
