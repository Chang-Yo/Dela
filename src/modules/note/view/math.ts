// 笔记里的数学公式：定位 `$…$` / `$$…$$` 并交给 KaTeX 渲染。
// Lezer 的 Markdown 语法没有公式节点，所以按文本扫描；代码区间由调用方排除。
import katex from 'katex';
import 'katex/dist/katex.min.css';

export interface MathRange {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

/* 行内 `$` 采用 Pandoc 规则：开 `$` 后紧跟非空白、闭 `$` 前紧挨非空白且后面不是数字。
   这样「花了 $5 和 $10」这类金额不会被当成公式。 */
const inlineRe = /(?<![\\$])\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![\d$])/g;
const blockRe = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g;

/** 在 text（文档中从 offset 开始的一段）里找公式；skip 判断某个位置是否落在代码里。 */
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

/* 公式里的中文：KaTeX 在数学模式下用数学斜体字体排字，中文会落到回退字体里、间距错乱，
   strict 模式还会逐字报警告。连续的 CJK 字符（含全角标点）包进 \text{} 用正文字体排；
   已经写在 \text{…} / \mathrm{…} 等文本命令里的不重复包。 */
// CJK 标点、扩展 A、基本汉字、兼容汉字、全角符号；不含拉丁与希腊字母，它们本就是数学符号。
const cjkRun = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]+/g;
const textCommand = /\\(?:text|textrm|textsf|textbf|textit|mathrm|mbox|operatorname)\s*\{[^{}]*\}/g;

export function wrapCjk(tex: string): string {
  let result = '';
  let last = 0;
  for (const match of tex.matchAll(textCommand)) {
    result += tex.slice(last, match.index).replace(cjkRun, (run) => `\\text{${run}}`) + match[0];
    last = match.index! + match[0].length;
  }
  return result + tex.slice(last).replace(cjkRun, (run) => `\\text{${run}}`);
}

/** 渲染为 HTML；语法错误时 KaTeX 把出错的原文标红显示，不抛异常打断编辑。 */
export function renderMath(tex: string, display: boolean): string {
  return katex.renderToString(wrapCjk(tex), {
    displayMode: display,
    throwOnError: false,
    // 中文与 unicode 字符是笔记里的常态，不当作需要警告的「非标准」输入。
    strict: 'ignore',
    output: 'html',
  });
}
