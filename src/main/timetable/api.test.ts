import { describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { deleteCalendarEvent, isConnected, parseSemesterStart, parseWeekNumbers } from './api';
import { getCampusSession } from './session';
import { getDatabase } from '../database';
import type { Session } from 'electron';

vi.mock('electron', () => ({ BrowserWindow: {}, ipcMain: {}, session: {} }));
vi.mock('../database', () => ({ getDatabase: vi.fn() }));
vi.mock('./session', () => ({ getCampusSession: vi.fn() }));

describe('campus connection validation', () => {
  it.each([
    [200, '{"kbList":[]}', true],
    [302, '', false],
    [200, '<html>Login</html>', false],
    [200, '{"error":"expired"}', false],
  ])('checks the response rather than cookie presence (%s, %s)', async (status, body, expected) => {
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status }));
    vi.mocked(getCampusSession).mockResolvedValue({
      cookies: { get: vi.fn().mockResolvedValue([{ name: 'JSESSIONID' }]) },
      fetch,
    } as unknown as Session);
    expect(await isConnected()).toBe(expected);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not probe a disconnected browser', async () => {
    const fetch = vi.fn();
    vi.mocked(getCampusSession).mockResolvedValue({
      cookies: { get: vi.fn().mockResolvedValue([]) },
      fetch,
    } as unknown as Session);
    expect(await isConnected()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

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
