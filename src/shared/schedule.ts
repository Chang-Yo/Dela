import type { TimetableLesson } from './api';

// 上海交大教务处公布的本科生节次表。第 13 节仅用于 11–13 节连上的课程。
export const classPeriods = [
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

export function lessonOccurrences(
  lessons: readonly TimetableLesson[],
  semesterStart: string | null,
  startAt: string,
  endAt: string,
) {
  const warnings: string[] = [];
  const items: {
    source: 'course';
    lessonId: number;
    title: string;
    startAt: string;
    endAt: string;
    location: string | null;
  }[] = [];
  if (!semesterStart) return { items, warnings: ['缺少学期开始日期，无法将课程转换为实际日期'] };
  const date = new Date(`${semesterStart}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== semesterStart)
    return { items, warnings: ['学期开始日期无效'] };
  const day = 86400000;
  const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * day - 8 * 3600000;
  const rangeStart = Date.parse(startAt),
    rangeEnd = Date.parse(endAt);
  for (const lesson of lessons) {
    const start = classPeriods[lesson.startPeriod - 1]?.[0];
    const end = classPeriods[lesson.endPeriod - 1]?.[1];
    if (
      !lesson.weekNumbers.length ||
      start === undefined ||
      end === undefined ||
      end <= start ||
      lesson.weekday < 1 ||
      lesson.weekday > 7
    ) {
      warnings.push(`${lesson.courseName}：缺少有效周次或节次，未计入时间安排`);
      continue;
    }
    for (const week of lesson.weekNumbers) {
      const base = monday + ((week - 1) * 7 + lesson.weekday - 1) * day;
      const begin = base + start * 60000,
        finish = base + end * 60000;
      if (finish > rangeStart && begin < rangeEnd)
        items.push({
          source: 'course',
          lessonId: lesson.id,
          title: lesson.courseName,
          startAt: new Date(begin).toISOString(),
          endAt: new Date(finish).toISOString(),
          location: lesson.classroom,
        });
    }
  }
  return { items, warnings };
}
