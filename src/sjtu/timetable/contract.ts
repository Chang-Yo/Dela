import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export interface TimetableLesson {
  readonly id: number;
  readonly semester: string;
  readonly courseCode: string;
  readonly courseName: string;
  readonly className: string | null;
  readonly teacher: string | null;
  readonly campus: string | null;
  readonly classroom: string | null;
  readonly weekday: number;
  readonly startPeriod: number;
  readonly endPeriod: number;
  readonly periodsText: string;
  readonly weeksText: string;
  readonly weekNumbers: readonly number[];
  readonly credits: number | null;
  readonly note: string | null;
}

export interface TimetableState {
  readonly semester: string;
  readonly lastSyncedAt: string | null;
  readonly semesterStart: string | null;
}

export interface TimetableResult {
  readonly ok: boolean;
  readonly error?: string;
  /** 非空表示失败原因是登录失效，界面据此引导重新登录而非当作普通失败。 */
  readonly reason?: 'auth';
}

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

export const semesterSchema = z.string().regex(/^\d{4}-\d{4}-[123]$/);

const result = z.custom<TimetableResult>();
const state = z.custom<TimetableState>();

export const timetableContract = defineContract('timetable', {
  state: { input: semesterSchema.optional(), output: state },
  lessons: { input: semesterSchema.optional(), output: z.custom<TimetableLesson[]>() },
  setSemesterStart: {
    input: z.object({
      semester: semesterSchema,
      value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    output: z.void(),
  },
  sync: { input: semesterSchema.optional(), output: result },
  connect: { input: z.undefined(), output: result },
});

declare module '../../app/module' {
  interface NavTargets {
    timetable: {};
  }
}
