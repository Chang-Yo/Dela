// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findMath, renderMath, wrapCjk } from './math';

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

describe('wrapCjk', () => {
  it('公式里的中文包进 \\text，已在文本命令里的不重复包', () => {
    expect(wrapCjk('v=\\frac{距离}{时间}')).toBe('v=\\frac{\\text{距离}}{\\text{时间}}');
    expect(wrapCjk('\\text{速度} = 距离，单位')).toBe('\\text{速度} = \\text{距离，单位}');
    expect(wrapCjk('\\alpha+\\beta')).toBe('\\alpha+\\beta');
  });
});

describe('renderMath', () => {
  it('中文按文本排版，不报错；语法错误显示为红字而不是抛异常', () => {
    const html = renderMath('面积 = \\pi r^2', false);
    expect(html).toContain('katex');
    expect(html).not.toContain('katex-error');
    expect(html).toContain('面积');
    expect(renderMath('\\frac{1', true)).toContain('katex-error');
  });
});
