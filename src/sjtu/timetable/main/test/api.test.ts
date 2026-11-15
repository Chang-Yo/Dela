import { describe, expect, it, vi } from 'vitest';
import { parseSemesterStart, parseWeekNumbers } from '../api';
import { timetableModule } from '../..';
import { provideTestHostPorts } from '../../../../core/test/host-mock';

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {},
  session: {},
  net: { request: vi.fn() },
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

describe('deleteEvent', () => {
  it('deletes only from calendar_events with a validated id', () => {
    const run = vi.fn();
    const prepare = vi.fn(() => ({ run }));
    provideTestHostPorts({ database: () => ({ prepare }) as never });
    const deleteEvent = (id: unknown) => timetableModule.ipc!.call('deleteEvent', id);
    deleteEvent(7);
    expect(prepare).toHaveBeenCalledWith('DELETE FROM calendar_events WHERE id = ?');
    expect(run).toHaveBeenCalledWith(7);
    expect(() => deleteEvent(0)).toThrow();
    expect(() => deleteEvent(2.5)).toThrow();
    expect(() => deleteEvent('3')).toThrow();
    expect(prepare).toHaveBeenCalledOnce();
  });
});
