// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findMath } from '../math';

const find = (text: string, skip: (pos: number) => boolean = () => false) =>
  findMath(text, 0, skip).map(({ tex, display }) => ({ tex, display }));

describe('findMath', () => {
  it('识别行内与块级公式，块级里的 $ 不被拆成行内', () => {
    expect(find('质能方程 $E=mc^2$，以及\n$$\n\\int_0^1 x\\,dx\n$$')).toEqual([
      { tex: 'E=mc^2', display: false },
      { tex: '\\int_0^1 x\\,dx', display: true },
    ]);
  });

  it('金额与转义的 $ 不是公式', () => {
    expect(find('花了 $5 和 $10')).toEqual([]);
    expect(find('价格 \\$3 到 \\$4')).toEqual([]);
    expect(find('$ x $')).toEqual([]);
  });

  it('紧挨中文的公式照样识别（中文没有空格分词）', () => {
    expect(find('设$x$为实数，则$x^2\\ge0$。')).toEqual([
      { tex: 'x', display: false },
      { tex: 'x^2\\ge0', display: false },
    ]);
  });

  it('代码里的 $ 跳过', () => {
    const text = '`$a$` 与 $b$';
    expect(find(text, (pos) => pos < 5)).toEqual([{ tex: 'b', display: false }]);
  });
});
