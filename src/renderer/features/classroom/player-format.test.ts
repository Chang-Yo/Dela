import { describe, expect, it } from 'vitest';
import type { ClassroomVideo } from '../../../shared/vsjtu';
import { formatBytes, formatTime, lectureFileName } from './player-format';

const video = (overrides: Partial<ClassroomVideo> = {}): ClassroomVideo => ({
  id: 1,
  start: '2026-10-08 14:00:00',
  end: '2026-10-08 15:35:00',
  room: '东上院405',
  period: '3',
  ...overrides,
});

describe('formatTime', () => {
  it('格式化分秒与时分秒', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(59)).toBe('0:59');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(3599)).toBe('59:59');
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3283.777)).toBe('54:43');
  });
  it('无效值回退 0:00', () => {
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});

describe('formatBytes', () => {
  it('选择合适单位', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(424_277_175)).toBe('405 MB');
    expect(formatBytes(2 ** 31)).toBe('2 GB');
  });
  it('非正数回退 null', () => {
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
    expect(formatBytes(Number.NaN)).toBeNull();
  });
});

describe('lectureFileName', () => {
  it('课程名 + 紧凑日期 + 节次', () => {
    expect(lectureFileName('计算理论', video())).toBe('计算理论 20261008 第3节');
  });
  it('缺节次时省略', () => {
    expect(lectureFileName('计算理论', video({ period: '' }))).toBe('计算理论 20261008');
  });
});
