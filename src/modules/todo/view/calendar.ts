// 日历的日期与配色：待办与课表共用。
import type { CSSProperties } from 'react';
import { calendarEventColors, type CalendarEventColor } from '../contract';

export const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export const dayMilliseconds = 86_400_000;

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

export function colorFor(value: string): CalendarEventColor {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return calendarEventColors[Math.abs(hash) % calendarEventColors.length]!;
}

export function calendarToneKey(color: string | null | undefined): CalendarEventColor {
  return color && calendarEventColors.includes(color as CalendarEventColor)
    ? (color as CalendarEventColor)
    : 'slate';
}

export function eventTone(color: string | null | undefined): CSSProperties {
  return eventColorStyle(calendarToneKey(color));
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

export function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
