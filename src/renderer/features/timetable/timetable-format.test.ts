import { describe, expect, it } from 'vitest';
import { eventDayEdges, formatEventRange, layoutDayColumns } from './timetable-format';

// 时间用一天内的分钟数表示，样例不对应任何真实课程。
describe('layoutDayColumns', () => {
  it('给不重叠的项各自整列', () => {
    const layout = layoutDayColumns([
      { id: 'a', start: 8 * 60, end: 9 * 60 },
      { id: 'b', start: 10 * 60, end: 11 * 60 },
    ]);
    expect(layout.get('a')).toEqual({ left: 0, width: 100 });
    expect(layout.get('b')).toEqual({ left: 0, width: 100 });
  });

  it('两块重叠时并排各占一半', () => {
    const layout = layoutDayColumns([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
    ]);
    expect(layout.get('a')).toEqual({ left: 0, width: 50 });
    expect(layout.get('b')).toEqual({ left: 50, width: 50 });
  });

  it('三块链式重叠只分两列，首尾共用一列', () => {
    // a 与 b 重叠、b 与 c 重叠，a 与 c 仅首尾相接，通过 b 传递成同一簇。
    const layout = layoutDayColumns([
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
      { id: 'c', start: 60, end: 120 },
    ]);
    expect(layout.get('a')).toEqual({ left: 0, width: 50 });
    expect(layout.get('b')).toEqual({ left: 50, width: 50 });
    expect(layout.get('c')).toEqual({ left: 0, width: 50 });
  });

  it('首尾相接不算重叠，各自占满整列', () => {
    const layout = layoutDayColumns([
      { id: 'a', start: 0, end: 30 },
      { id: 'b', start: 30, end: 60 },
    ]);
    expect(layout.get('a')).toEqual({ left: 0, width: 100 });
    expect(layout.get('b')).toEqual({ left: 0, width: 100 });
  });

  it('跨簇的项互不影响宽度', () => {
    const layout = layoutDayColumns([
      { id: 'a', start: 0, end: 30 },
      { id: 'b', start: 10, end: 20 },
      { id: 'c', start: 30, end: 60 },
      { id: 'd', start: 35, end: 55 },
    ]);
    expect(layout.get('a')).toEqual({ left: 0, width: 50 });
    expect(layout.get('b')).toEqual({ left: 50, width: 50 });
    expect(layout.get('c')).toEqual({ left: 0, width: 50 });
    expect(layout.get('d')).toEqual({ left: 50, width: 50 });
  });

  it('同一时刻的三块平分三列', () => {
    const layout = layoutDayColumns([
      { id: 'a', start: 60, end: 120 },
      { id: 'b', start: 60, end: 120 },
      { id: 'c', start: 60, end: 120 },
    ]);
    expect(layout.get('a')?.left).toBeCloseTo(0);
    expect(layout.get('b')?.left).toBeCloseTo(100 / 3);
    expect(layout.get('c')?.left).toBeCloseTo(200 / 3);
    for (const id of ['a', 'b', 'c']) {
      expect(layout.get(id)?.width).toBeCloseTo(100 / 3);
    }
  });

  it('空输入返回空布局', () => {
    expect(layoutDayColumns([]).size).toBe(0);
  });
});

describe('eventDayEdges', () => {
  // 2026-09-14 是周一。跨天事件：周一 22:00 起，周三 10:00 止。
  const event = {
    startAt: new Date(2026, 8, 14, 22, 0).toISOString(),
    endAt: new Date(2026, 8, 16, 10, 0).toISOString(),
  };

  it('只有事件真实起止日才是首末段', () => {
    expect(eventDayEdges(event, new Date(2026, 8, 14))).toEqual({ isStart: true, isEnd: false });
    expect(eventDayEdges(event, new Date(2026, 8, 15))).toEqual({ isStart: false, isEnd: false });
    expect(eventDayEdges(event, new Date(2026, 8, 16))).toEqual({ isStart: false, isEnd: true });
  });

  it('结束恰为午夜时归属前一天，与 localEventsByDay 一致', () => {
    const event = {
      startAt: new Date(2026, 8, 14, 9, 0).toISOString(),
      endAt: new Date(2026, 8, 16).toISOString(),
    };
    expect(eventDayEdges(event, new Date(2026, 8, 15)).isEnd).toBe(true);
    expect(eventDayEdges(event, new Date(2026, 8, 16)).isEnd).toBe(false);
  });
});

describe('formatEventRange', () => {
  it('同日事件只写一个日期', () => {
    expect(
      formatEventRange({
        startAt: new Date(2026, 8, 14, 9, 0).toISOString(),
        endAt: new Date(2026, 8, 14, 10, 0).toISOString(),
      }),
    ).toBe('9月14日（周一）09:00 – 10:00');
  });

  it('跨天事件两端各带日期与星期', () => {
    expect(
      formatEventRange({
        startAt: new Date(2026, 8, 12, 22, 0).toISOString(),
        endAt: new Date(2026, 8, 16, 10, 0).toISOString(),
      }),
    ).toBe('9月12日（周六）22:00 – 9月16日（周三）10:00');
  });
});
