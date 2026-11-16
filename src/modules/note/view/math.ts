// Lezer 的 Markdown 语法没有公式节点，按文本扫描定位 `$…$` / `$$…$$` 交给 KaTeX；代码区间由调用方排除。
import katex from 'katex';
import 'katex/dist/katex.min.css';

export interface MathRange {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

/* 行内 `$` 采用 Pandoc 规则，「花了 $5 和 $10」这类金额不会被当成公式。 */
const inlineRe = /(?<![\\$])\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![\d$])/g;
const blockRe = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g;

export function findMath(
  text: string,
  offset: number,
  skip: (pos: number) => boolean,
): MathRange[] {
  const ranges: MathRange[] = [];
  const taken: [number, number][] = [];
  for (const match of text.matchAll(blockRe)) {
    const from = offset + match.index!;
    if (skip(from)) continue;
    const to = from + match[0].length;
    ranges.push({ from, to, tex: match[1]!.trim(), display: true });
    taken.push([from, to]);
  }
  for (const match of text.matchAll(inlineRe)) {
    const from = offset + match.index!;
    const to = from + match[0].length;
    if (skip(from) || taken.some(([a, b]) => from < b && to > a)) continue;
    ranges.push({ from, to, tex: match[1]!, display: false });
  }
  return ranges.sort((a, b) => a.from - b.from);
}

/* 公式里的中文：KaTeX 数学字体会让中文落到回退字体、间距错乱，连续 CJK 字符包进 \text{}。 */
const cjkRun = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]+/g;
const textCommand = /\\(?:text|textrm|textsf|textbf|textit|mathrm|mbox|operatorname)\s*\{[^{}]*\}/g;

function wrapCjk(tex: string): string {
  let result = '';
  let last = 0;
  for (const match of tex.matchAll(textCommand)) {
    result += tex.slice(last, match.index).replace(cjkRun, (run) => `\\text{${run}}`) + match[0];
    last = match.index! + match[0].length;
  }
  return result + tex.slice(last).replace(cjkRun, (run) => `\\text{${run}}`);
}

/** 语法错误时 KaTeX 把出错的原文标红显示，不抛异常打断编辑。 */
export function renderMath(tex: string, display: boolean): string {
  return katex.renderToString(wrapCjk(tex), {
    displayMode: display,
    throwOnError: false,
    strict: 'ignore',
    output: 'html',
  });
}
