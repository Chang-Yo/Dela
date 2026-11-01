import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../../../../shared/timetable';
import { timetableTools } from '../index';

vi.mock('../../../../timetable/api', async () => {
  const { z } = await import('zod');
  return {
    scheduleQuerySchema: z.object({}).passthrough(),
    querySchedule: vi.fn(),
    createCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
    getCalendarEvent: vi.fn(),
    getTimetableState: vi.fn(),
    setSemesterStart: vi.fn(),
    currentSemester: vi.fn(() => '2026-2027-1'),
  };
});

vi.mock('../../../../vsjtu/api', () => ({
  listCourses: vi.fn(),
  listVideos: vi.fn(),
}));

import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  getTimetableState,
  querySchedule,
  setSemesterStart,
} from '../../../../timetable/api';
import { listCourses, listVideos } from '../../../../vsjtu/api';

const schedule = vi.mocked(querySchedule);
const createEvent = vi.mocked(createCalendarEvent);
const deleteEvent = vi.mocked(deleteCalendarEvent);
const getEvent = vi.mocked(getCalendarEvent);
const state = vi.mocked(getTimetableState);
const writeStart = vi.mocked(setSemesterStart);
const courses = vi.mocked(listCourses);
const videos = vi.mocked(listVideos);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('query_schedule', () => {
  it('interprets YYYY-MM-DD pairs as Shanghai-timezone whole days', async () => {
    schedule.mockReturnValue({
      semester: '2026-2027-1',
      timezone: 'Asia/Shanghai',
      items: [],
      coverage: { courseSyncedAt: '2026-09-20T00:00:00.000Z', complete: true, warnings: [] },
    });
    const result = (await timetableTools.query_schedule.execute({
      startDate: '2026-09-28',
      endDate: '2026-09-28',
    })) as {
      freshness: unknown;
      coverage: { scope: string; complete: boolean };
    };
    // 上海时区 2026-09-28 全天 = UTC [09-27T16:00, 09-28T16:00)。
    expect(schedule).toHaveBeenCalledWith({
      startAt: '2026-09-27T16:00:00.000Z',
      endAt: '2026-09-28T16:00:00.000Z',
    });
    expect(result.freshness).toEqual({ kind: 'cached', syncedAt: '2026-09-20T00:00:00.000Z' });
    expect(result.coverage).toEqual({
      scope: 'cached_lessons_and_events:2026-2027-1',
      complete: true,
    });
  });

  it('keeps UTC ISO inputs as-is and forwards an explicit semester', async () => {
    schedule.mockReturnValue({
      semester: '2025-2026-2',
      timezone: 'Asia/Shanghai',
      items: [],
      coverage: {
        courseSyncedAt: null,
        complete: false,
        warnings: ['该学期课表尚未同步'],
      },
    });
    const result = (await timetableTools.query_schedule.execute({
      semester: '2025-2026-2',
      startAt: '2026-03-01T16:00:00.000Z',
      endAt: '2026-03-08T16:00:00.000Z',
    })) as { coverage: { complete: boolean; warnings: string[] } };
    expect(schedule).toHaveBeenCalledWith({
      semester: '2025-2026-2',
      startAt: '2026-03-01T16:00:00.000Z',
      endAt: '2026-03-08T16:00:00.000Z',
    });
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.warnings[0]).toContain('请提示用户到课表页面');
  });

  it('turns a missing semester start date into the next step instead of a bare gap', async () => {
    schedule.mockReturnValue({
      semester: '2026-2027-1',
      timezone: 'Asia/Shanghai',
      items: [],
      coverage: {
        courseSyncedAt: '2026-10-28T15:59:27.788Z',
        complete: false,
        warnings: ['已缓存 20 条课程安排，但缺少学期开始日期，无法换算成具体日期'],
      },
    });
    const result = (await timetableTools.query_schedule.execute({
      startDate: '2026-11-02',
      endDate: '2026-11-08',
    })) as { coverage: { complete: boolean; warnings: string[] } };
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.warnings[0]).toContain('已缓存 20 条课程安排');
    expect(result.coverage.warnings[0]).toContain('infer_semester_start');
    expect(result.coverage.warnings[0]).toContain('set_semester_start');
  });

  it('rejects mixed, missing or unordered time inputs at the schema layer', () => {
    // schema 校验失败同步抛出（registry 映射为 INVALID_INPUT）。
    expect(() =>
      timetableTools.query_schedule.execute({
        startDate: '2026-09-28',
        endDate: '2026-09-29',
        startAt: '2026-09-27T16:00:00.000Z',
        endAt: '2026-09-28T16:00:00.000Z',
      }),
    ).toThrow('不能混用');
    expect(() => timetableTools.query_schedule.execute({})).toThrow('startDate/endDate');
    expect(() => timetableTools.query_schedule.execute({ startDate: '2026-09-28' })).toThrow(
      '成对提供',
    );
    expect(() =>
      timetableTools.query_schedule.execute({ startDate: '2026-09-30', endDate: '2026-09-28' }),
    ).toThrow('不能早于');
    expect(() =>
      timetableTools.query_schedule.execute({ startDate: '2026-02-30', endDate: '2026-03-01' }),
    ).toThrow('日期不存在');
  });
});

describe('semester start', () => {
  beforeEach(() => {
    state.mockReturnValue({
      semester: '2026-2027-1',
      lastSyncedAt: '2026-10-28T15:59:27.788Z',
      semesterStart: null,
    });
  });

  it('infers a candidate from the earliest recordings without writing it', async () => {
    courses.mockResolvedValue([
      { id: 1, code: 'CHN2800J', name: '中国现代文学概述' },
      { id: 2, code: 'PHYS2500J', name: '普通物理（2）' },
    ]);
    videos.mockImplementation(async (courseId: number) =>
      courseId === 1
        ? [{ id: 11, start: '2026-09-14 11:50:20', end: '', room: '', period: '5' }]
        : [{ id: 21, start: '2026-09-15 16:00:00', end: '', room: '', period: '9' }],
    );
    const result = (await timetableTools.infer_semester_start.execute({})) as {
      candidate: string | null;
      confidence: string;
      written: boolean;
      checkedCourses: number;
    };
    expect(result.candidate).toBe('2026-09-14');
    expect(result.confidence).toBe('high');
    expect(result.written).toBe(false);
    expect(result.checkedCourses).toBe(2);
    expect(writeStart).not.toHaveBeenCalled();
  });

  it('fails loudly when every course recording cannot be read', async () => {
    courses.mockResolvedValue([{ id: 1, code: 'CHN2800J', name: '中国现代文学概述' }]);
    videos.mockRejectedValue(new Error('登录已失效，请重新登录'));
    await expect(timetableTools.infer_semester_start.execute({})).rejects.toThrow(
      '无法推断开学日期',
    );
  });

  it('writes a confirmed date and flags a non-Monday input', () => {
    const result = timetableTools.set_semester_start.execute({ date: '2026-09-15' }) as {
      written: boolean;
      weekday: number;
      weekOne: { start: string; end: string };
      warning?: string;
    };
    expect(writeStart).toHaveBeenCalledWith('2026-2027-1', '2026-09-15');
    expect(result.written).toBe(true);
    expect(result.weekday).toBe(2);
    expect(result.weekOne).toEqual({ start: '2026-09-14', end: '2026-09-20' });
    expect(result.warning).toContain('不是周一');
  });

  it('rejects impossible calendar dates', () => {
    expect(() => timetableTools.set_semester_start.execute({ date: '2026-02-30' })).toThrow(
      '日期不存在',
    );
  });
});

describe('create_event', () => {
  it('passes the optional color through to the calendar API', () => {
    const event: CalendarEvent = {
      id: 7,
      title: '组会',
      startAt: '2026-09-30T02:00:00.000Z',
      endAt: '2026-09-30T03:00:00.000Z',
      location: null,
      color: 'teal',
    };
    createEvent.mockReturnValue(event);
    const input = {
      title: '组会',
      startAt: '2026-09-30T02:00:00.000Z',
      endAt: '2026-09-30T03:00:00.000Z',
      color: 'teal' as const,
    };
    expect(timetableTools.create_event.execute(input)).toEqual(event);
    expect(createEvent).toHaveBeenCalledWith(input);
  });
});

describe('delete_event', () => {
  it('deletes a self-created event after an existence check', () => {
    const event: CalendarEvent = {
      id: 7,
      title: '组会',
      startAt: '2026-09-30T02:00:00.000Z',
      endAt: '2026-09-30T03:00:00.000Z',
      location: null,
      color: null,
    };
    getEvent.mockReturnValue(event);
    expect(timetableTools.delete_event.execute({ id: 7 })).toEqual({ deleted: event });
    expect(deleteEvent).toHaveBeenCalledWith(7);
  });

  it('reports NOT_FOUND for unknown ids', () => {
    getEvent.mockReturnValue(null);
    let caught: unknown;
    try {
      timetableTools.delete_event.execute({ id: 404 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'NOT_FOUND' });
    expect(deleteEvent).not.toHaveBeenCalled();
  });
});
