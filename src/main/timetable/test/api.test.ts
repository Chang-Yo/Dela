import { describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { deleteCalendarEvent, isConnected, parseSemesterStart, parseWeekNumbers } from '../api';
import { getCampusSession } from '../session';
import { getDatabase } from '../../database';
import { net, type Session } from 'electron';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {},
  session: {},
  net: { request: vi.fn() },
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../session', () => ({ getCampusSession: vi.fn() }));

function mockRequest(status: number | 'redirect' | 'error', body = '') {
  const request = Object.assign(new EventEmitter(), {
    setHeader: vi.fn(),
    abort: vi.fn(),
    end: vi.fn(() =>
      queueMicrotask(() => {
        if (status === 'redirect') {
          request.emit('redirect', 302);
          return;
        }
        if (status === 'error') {
          request.emit('error', new Error('network failed'));
          return;
        }
        const response = Object.assign(new EventEmitter(), { statusCode: status });
        request.emit('response', response);
        response.emit('data', Buffer.from(body));
        response.emit('end');
      }),
    ),
  });
  vi.mocked(net.request).mockReturnValue(request as unknown as ReturnType<typeof net.request>);
  return request;
}

describe('campus connection validation', () => {
  it.each([
    [200, '{"kbList":[]}', true],
    [302, '', false],
    ['error', '', false],
    [200, '<html>Login</html>', false],
  ] as const)(
    'handles response %s without constructing a Response',
    async (status, body, expected) => {
      const request = mockRequest(status, body);
      const campus = {
        cookies: { get: vi.fn().mockResolvedValue([{ name: 'JSESSIONID' }]) },
      } as unknown as Session;
      vi.mocked(getCampusSession).mockResolvedValue(campus);
      expect(await isConnected()).toBe(expected);
      expect(net.request).toHaveBeenLastCalledWith(
        expect.objectContaining({ session: campus, useSessionCookies: true, redirect: 'manual' }),
      );
      expect(request.end).toHaveBeenCalledWith(expect.stringContaining('kzlx=ck'));
      if (status !== 200) expect(request.abort).toHaveBeenCalled();
    },
  );

  it('does not request a disconnected browser', async () => {
    vi.mocked(net.request).mockClear();
    vi.mocked(getCampusSession).mockResolvedValue({
      cookies: { get: vi.fn().mockResolvedValue([]) },
    } as unknown as Session);
    expect(await isConnected()).toBe(false);
    expect(net.request).not.toHaveBeenCalled();
  });

  it('aborts a stalled request after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const request = mockRequest(200);
      request.end.mockImplementation(() => {});
      vi.mocked(getCampusSession).mockResolvedValue({
        cookies: { get: vi.fn().mockResolvedValue([{ name: 'JSESSIONID' }]) },
      } as unknown as Session);
      const connected = isConnected();
      await vi.advanceTimersByTimeAsync(15000);
      expect(await connected).toBe(false);
      expect(request.abort).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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
