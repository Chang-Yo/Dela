import { describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { deleteCalendarEvent, parseSemesterStart, parseWeekNumbers, syncTimetable } from '../api';
import { fetchGraduateTimetable } from '../graduate';
import { campusRequest, getCampusSession } from '../../campus';
import { getDatabase } from '../../database';

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {},
  session: {},
  net: { request: vi.fn() },
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../campus', () => ({
  CampusAuthError: class CampusAuthError extends Error {},
  campusRequest: vi.fn(),
  flushCampusSession: vi.fn(),
  getCampusSession: vi.fn(),
  openCampusLoginWindow: vi.fn(),
}));
vi.mock('../graduate', () => ({
  fetchGraduateTimetable: vi.fn(),
  GRADUATE_CAMPUS_ORIGIN: 'https://yjs.sjtu.edu.cn',
  GRADUATE_LOGIN_URL: 'https://yjs.sjtu.edu.cn/gsapp/sys/wdkbapp/*default/index.do#/xskcb',
}));

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

describe('syncTimetable', () => {
  it('keeps cached lessons when both sources are empty', async () => {
    vi.clearAllMocks();
    vi.mocked(getCampusSession).mockResolvedValue({} as never);
    vi.mocked(campusRequest).mockResolvedValue(JSON.stringify({ kbList: [] }));
    vi.mocked(fetchGraduateTimetable).mockResolvedValue({ lessons: [], semesterStart: null });

    await expect(syncTimetable('2026-2027-1')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('原有课表不会被清除'),
    });
    expect(getDatabase).not.toHaveBeenCalled();
  });
});
