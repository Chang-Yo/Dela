import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../../contract';
import { timetableDomain } from '../index';

vi.mock('../../api', async () => {
  const { z } = await import('zod');
  return {
    scheduleQuerySchema: z.object({}).passthrough(),
    querySchedule: vi.fn(),
    createCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
    getCalendarEvent: vi.fn(),
  };
});

import { deleteCalendarEvent, getCalendarEvent, querySchedule } from '../../api';

const schedule = vi.mocked(querySchedule);
const deleteEvent = vi.mocked(deleteCalendarEvent);
const getEvent = vi.mocked(getCalendarEvent);

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
    const result = (await timetableDomain.commands.query_schedule.execute({
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

  it('rejects mixed, missing or unordered time inputs at the schema layer', () => {
    // schema 校验失败同步抛出（registry 映射为 INVALID_INPUT）。
    expect(() =>
      timetableDomain.commands.query_schedule.execute({
        startDate: '2026-09-28',
        endDate: '2026-09-29',
        startAt: '2026-09-27T16:00:00.000Z',
        endAt: '2026-09-28T16:00:00.000Z',
      }),
    ).toThrow('不能混用');
    expect(() => timetableDomain.commands.query_schedule.execute({})).toThrow('startDate/endDate');
    expect(() =>
      timetableDomain.commands.query_schedule.execute({ startDate: '2026-09-28' }),
    ).toThrow('成对提供');
    expect(() =>
      timetableDomain.commands.query_schedule.execute({
        startDate: '2026-09-30',
        endDate: '2026-09-28',
      }),
    ).toThrow('不能早于');
    expect(() =>
      timetableDomain.commands.query_schedule.execute({
        startDate: '2026-02-30',
        endDate: '2026-03-01',
      }),
    ).toThrow('日期不存在');
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
    expect(timetableDomain.commands.delete_event.execute({ id: 7 })).toEqual({ deleted: event });
    expect(deleteEvent).toHaveBeenCalledWith(7);
  });

  it('reports NOT_FOUND for unknown ids', () => {
    getEvent.mockReturnValue(null);
    let caught: unknown;
    try {
      timetableDomain.commands.delete_event.execute({ id: 404 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'NOT_FOUND' });
    expect(deleteEvent).not.toHaveBeenCalled();
  });
});
