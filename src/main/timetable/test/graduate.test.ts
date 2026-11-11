import { describe, expect, it, vi } from 'vitest';
import {
  mapGraduateTimetable,
  type GraduateCourseRow,
  type GraduateScheduleRow,
} from '../graduate';

vi.mock('electron', () => ({}));

function mask(weeks: readonly number[]): string {
  return Array.from({ length: 30 }, (_, index) => (weeks.includes(index + 1) ? '1' : '0')).join('');
}

function schedule(overrides: Partial<GraduateScheduleRow>): GraduateScheduleRow {
  return {
    BJDM: 'class-a',
    BJMC: 'A-01',
    JASMC: '上院313',
    JSJCDM: 4,
    JSXM: '教师甲',
    KBBZ: null,
    KCDM: 'A100',
    KCMC: '课程甲',
    KSJCDM: 3,
    WID: 'row-a-1',
    XQ: 2,
    ZCBH: mask(Array.from({ length: 8 }, (_, index) => index + 1)),
    ZCMC: '1-8周',
    ...overrides,
  };
}

function course(overrides: Partial<GraduateCourseRow>): GraduateCourseRow {
  return {
    BJDM: 'class-a',
    BJMC: 'A-01',
    KCDM: 'A100',
    KCMC: '课程甲',
    RKJS: '教师甲',
    SCSKRQ: '2026-09-15',
    XKBZ: null,
    XQDM_DISPLAY: '闵行',
    ...overrides,
  };
}

describe('mapGraduateTimetable', () => {
  it('preserves separate schedules, classrooms, and courses sharing a time slot', () => {
    const weeks9To16 = Array.from({ length: 8 }, (_, index) => index + 9);
    const weeks2To17 = Array.from({ length: 16 }, (_, index) => index + 2);
    const result = mapGraduateTimetable(
      '2026-2027-1',
      [
        schedule({}),
        schedule({
          WID: 'row-a-2',
          XQ: 3,
          KSJCDM: 9,
          JSJCDM: 10,
          JASMC: '上院101',
          ZCBH: mask(weeks9To16),
          ZCMC: '9-16周',
        }),
        schedule({
          BJDM: 'class-b',
          BJMC: 'B-01',
          KCDM: 'B100',
          KCMC: '课程乙',
          WID: 'row-b-1',
          KSJCDM: 9,
          JSJCDM: 10,
          JASMC: '陈瑞球楼204',
          ZCBH: mask(weeks2To17),
          ZCMC: '2-17周',
        }),
        schedule({
          BJDM: 'class-c',
          BJMC: 'C-01',
          KCDM: 'C100',
          KCMC: '课程丙',
          WID: 'row-c-1',
          KSJCDM: 9,
          JSJCDM: 10,
          JASMC: null,
          ZCBH: mask([9]),
          ZCMC: '9周',
        }),
      ],
      [
        course({}),
        course({
          BJDM: 'class-b',
          BJMC: 'B-01',
          KCDM: 'B100',
          KCMC: '课程乙',
          RKJS: '教师乙',
          SCSKRQ: '2026-09-22',
        }),
        course({
          BJDM: 'class-c',
          BJMC: 'C-01',
          KCDM: 'C100',
          KCMC: '课程丙',
          RKJS: null,
          SCSKRQ: '2026-11-10',
        }),
      ],
    );

    expect(result.semesterStart).toBe('2026-09-14');
    expect(result.lessons).toHaveLength(4);
    expect(result.lessons[0]).toMatchObject({
      courseName: '课程甲',
      weekday: 2,
      startPeriod: 3,
      endPeriod: 4,
      classroom: '上院313',
      weekNumbers: JSON.stringify(Array.from({ length: 8 }, (_, index) => index + 1)),
    });
    expect(result.lessons[1]).toMatchObject({ weekday: 3, classroom: '上院101' });
    expect(result.lessons[2]).toMatchObject({ courseName: '课程乙', weekday: 2, startPeriod: 9 });
    expect(result.lessons[3]).toMatchObject({
      courseName: '课程丙',
      classroom: null,
      weekNumbers: JSON.stringify([9]),
    });
  });

  it('does not merge nonconsecutive periods', () => {
    const result = mapGraduateTimetable(
      '2026-2027-1',
      [
        schedule({ KSJCDM: 1, JSJCDM: 1, WID: 'row-1' }),
        schedule({ KSJCDM: 3, JSJCDM: 3, WID: 'row-3' }),
      ],
      [course({})],
    );
    expect(result.lessons.map((lesson) => lesson.periodsText)).toEqual(['1节', '3节']);
  });
});
