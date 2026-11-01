import { describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { deleteCalendarEvent, parseSemesterStart, parseWeekNumbers } from '../api';
import { getDatabase } from '../../database';

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {},
  session: {},
  net: { request: vi.fn() },
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));

describe('parseWeekNumbers', () => {
  it('expands ranges and comma-separated weeks', () => {
    expect(parseWeekNumbers('1-4,7周')).toEqual([1, 2, 3, 4, 7]);
  });

  it('respects odd and even week markers', () => {
    expect(parseWeekNumbers('1-8周(单)')).toEqual([1, 3, 5, 7]);
    expect(parseWeekNumbers('2-8周(双)')).toEqual([2, 4, 6, 8]);
  });
});

describe('parseSemesterStart', () => {
  it('finds the earliest valid date in the weekly date labels', () => {
    expect(parseSemesterStart(['第2周 2026/09/21', '第1周 2026-09-14'])).toBe('2026-09-14');
  });

  it('normalizes to the Monday of that week', () => {
    expect(parseSemesterStart(['2026-09-15'], '2026-2027-1')).toBe('2026-09-14');
  });

  it('accepts compact YYYYMMDD dates from the timetable payload', () => {
    expect(parseSemesterStart([{ RQ: '20260914' }], '2026-2027-1')).toBe('2026-09-14');
  });

  it('completes month-day dates from the semester label', () => {
    expect(parseSemesterStart(['2026-2027-1', { RQ: '09-14' }], '2026-2027-1')).toBe('2026-09-14');
    // 春学期落在学年后半：2025-2026-2 的 03-02 属于 2026 年。
    expect(parseSemesterStart([{ RQ: '03-02' }], '2025-2026-2')).toBe('2026-03-02');
  });

  it('does not mistake week ranges for dates', () => {
    expect(parseSemesterStart(['第1周 1-16周'], '2026-2027-1')).toBeNull();
  });

  it('ignores malformed dates', () => {
    expect(parseSemesterStart(['第1周', '2026-02-30'])).toBeNull();
  });
});

describe('deleteCalendarEvent', () => {
  it('deletes only from calendar_events with a validated id', () => {
    const run = vi.fn();
    const prepare = vi.fn(() => ({ run }));
    vi.mocked(getDatabase).mockReturnValue({ prepare } as unknown as Database);
    deleteCalendarEvent(7);
    expect(prepare).toHaveBeenCalledWith('DELETE FROM calendar_events WHERE id = ?');
    expect(run).toHaveBeenCalledWith(7);
    expect(() => deleteCalendarEvent(0)).toThrow();
    expect(() => deleteCalendarEvent(2.5)).toThrow();
    expect(() => deleteCalendarEvent('3')).toThrow();
    expect(prepare).toHaveBeenCalledOnce();
  });
});
