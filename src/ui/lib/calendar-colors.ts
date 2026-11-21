import type { CSSProperties } from 'react';

// 与 tokens.css 的 --cal-* 一一对应；名字会存进数据库，只能新增。
export const calendarColors = [
  'rose',
  'peach',
  'sand',
  'sage',
  'teal',
  'blue',
  'lilac',
  'slate',
] as const;

export type CalendarColor = (typeof calendarColors)[number];

export const calendarColorLabels: Record<CalendarColor, string> = {
  rose: '玫红',
  peach: '杏橙',
  sand: '沙黄',
  sage: '草绿',
  teal: '湖青',
  blue: '雾蓝',
  lilac: '藕紫',
  slate: '石墨',
};

export function calendarColorStyle(key: CalendarColor): CSSProperties {
  return {
    backgroundColor: `var(--cal-${key}-bg)`,
    color: `var(--cal-${key}-text)`,
  };
}

/** 同一个名字总是落到同一种颜色，用于课程、分组这类没有自选颜色的条目。 */
export function colorFor(value: string): CalendarColor {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return calendarColors[Math.abs(hash) % calendarColors.length]!;
}
