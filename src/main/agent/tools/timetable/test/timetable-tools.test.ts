import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, TimetableLesson } from '../../../../../shared/timetable';
import { timetableTools } from '../index';

vi.mock('../../../../timetable/api', async () => {
  const { z } = await import('zod');
  return {
    isConnected: vi.fn(),
    listSyncedSemesters: vi.fn(),
    currentSemesterInfo: vi.fn(),
    scheduleQuerySchema: z.object({}).passthrough(),
    querySchedule: vi.fn(),
    syncTimetable: vi.fn(),
    listLessons: vi.fn(),
    createCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
    getCalendarEvent: vi.fn(),
  };
});

import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  isConnected,
  listLessons,
  listSyncedSemesters,
  currentSemesterInfo,
  querySchedule,
  syncTimetable,
} from '../../../../timetable/api';

const connected = vi.mocked(isConnected);
const semesters = vi.mocked(listSyncedSemesters);
const currentInfo = vi.mocked(currentSemesterInfo);
const schedule = vi.mocked(querySchedule);
const sync = vi.mocked(syncTimetable);
const lessons = vi.mocked(listLessons);
const createEvent = vi.mocked(createCalendarEvent);
const deleteEvent = vi.mocked(deleteCalendarEvent);
const getEvent = vi.mocked(getCalendarEvent);

beforeEach(() => {
  vi.clearAllMocks();
  connected.mockResolvedValue(true);
  currentInfo.mockReturnValue({
    semester: '2026-2027-1',
    basis: '按本机时钟 2026-09-29 推断：9 月及以后属第一学期',
  });
});

describe('get_timetable_status', () => {
  it('reports the online probe, clock-inferred semester and synced semesters', async () => {
    semesters.mockReturnValue([
      {
        semester: '2025-2026-2',
        lastSyncedAt: '2026-03-01T00:00:00.000Z',
        semesterStart: '2026-02-23',
      },
      { semester: '2026-2027-1', lastSyncedAt: '2026-09-20T00:00:00.000Z', semesterStart: null },
    ]);
    const result = (await timetableTools.get_timetable_status.execute({})) as {
      connected: boolean;
      currentSemester: { semester: string; basis: string };
      semesters: { semester: string; isCurrent: boolean }[];
      warnings: string[];
    };
    expect(result.connected).toBe(true);
    expect(result.currentSemester).toEqual({
      semester: '2026-2027-1',
      basis: '按本机时钟 2026-09-29 推断：9 月及以后属第一学期',
    });
    expect(result.semesters).toEqual([
      {
        semester: '2025-2026-2',
        lastSyncedAt: '2026-03-01T00:00:00.000Z',
        semesterStart: '2026-02-23',
        isCurrent: false,
      },
      {
        semester: '2026-2027-1',
        lastSyncedAt: '2026-09-20T00:00:00.000Z',
        semesterStart: null,
        isCurrent: true,
      },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('2026-2027-1 缺少学期开始日期');
  });

  it('reports a disconnected campus session as a state, not an error', async () => {
    connected.mockResolvedValue(false);
    semesters.mockReturnValue([]);
    const result = (await timetableTools.get_timetable_status.execute({})) as {
      connected: boolean;
      warnings: string[];
    };
    expect(result.connected).toBe(false);
    expect(result.warnings[0]).toContain('未登录教学信息服务网');
  });
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
    expect(result.coverage.warnings[0]).toContain('请先调用 refresh_timetable');
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

describe('refresh_timetable', () => {
  it('syncs one semester and reports the resulting rows', async () => {
    sync.mockResolvedValue({ ok: true });
    semesters.mockReturnValue([
      {
        semester: '2026-2027-1',
        lastSyncedAt: '2026-09-29T00:00:00.000Z',
        semesterStart: '2026-09-14',
      },
    ]);
    lessons.mockReturnValue([{}, {}, {}] as TimetableLesson[]);
    const result = await timetableTools.refresh_timetable.execute({ semester: '2026-2027-1' });
    expect(sync).toHaveBeenCalledWith('2026-2027-1');
    expect(result).toEqual({
      semester: '2026-2027-1',
      lastSyncedAt: '2026-09-29T00:00:00.000Z',
      semesterStart: '2026-09-14',
      lessonCount: 3,
    });
  });

  it('warns when the registrar did not return a semester start date', async () => {
    sync.mockResolvedValue({ ok: true });
    semesters.mockReturnValue([
      { semester: '2026-2027-1', lastSyncedAt: '2026-09-29T00:00:00.000Z', semesterStart: null },
    ]);
    lessons.mockReturnValue([]);
    const result = (await timetableTools.refresh_timetable.execute({
      semester: '2026-2027-1',
    })) as { warnings: string[] };
    expect(result.warnings[0]).toContain('学期开始日期');
  });

  it('maps sync failures to contract error codes', async () => {
    sync.mockResolvedValue({ ok: false, error: '登录已失效，请重新登录' });
    await expect(
      timetableTools.refresh_timetable.execute({ semester: '2026-2027-1' }),
    ).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });

    sync.mockResolvedValue({ ok: false, error: '课表请求超时，请稍后重试' });
    await expect(
      timetableTools.refresh_timetable.execute({ semester: '2026-2027-1' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    sync.mockResolvedValue({ ok: false, error: '课表接口返回 503' });
    await expect(
      timetableTools.refresh_timetable.execute({ semester: '2026-2027-1' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('requires an explicit semester', () => {
    expect(() => timetableTools.refresh_timetable.execute({})).toThrow();
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
    expect(createEvent).toHaveBeenCalledWith(input, {});
  });

  it('rejects unknown color values', () => {
    expect(() =>
      timetableTools.create_event.execute({
        title: '组会',
        startAt: '2026-09-30T02:00:00.000Z',
        endAt: '2026-09-30T03:00:00.000Z',
        color: 'purple',
      }),
    ).toThrow();
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
