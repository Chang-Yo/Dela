import { describe, expect, it } from 'vitest';
import { layoutDayColumns } from './timetable-format';

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
