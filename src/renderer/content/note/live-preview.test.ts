// @vitest-environment jsdom
// 即时渲染只加装饰：正文字节原样保留，光标所在行显示标记，其他行隐藏标记。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownImageInsert, markdownLivePreview } from './live-preview';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string, cursor: number, separator?: string) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      markdown({ base: markdownLanguage }),
      markdownLivePreview((src) => `resolved:${src}`),
      separator ? EditorState.lineSeparator.of(separator) : [],
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  view = new EditorView({ state, parent: document.body });
  return view;
}

describe('markdownLivePreview', () => {
  // 列表符号、转义、CRLF、尾部空行：所见即所得内核往返时都会改写，这里一个字节都不能变。
  const doc =
    '# 标题\r\n\r\n* 星号列表\r\n\r\n**粗体** \\*转义\\*\r\n\r\n![图](assets/a.png)\r\n\r\n';

  it('文档内容就是原文：装饰不进入 doc，CRLF 原样往返', () => {
    const editor = mount(doc, 0, '\r\n');
    expect(editor.state.sliceDoc()).toBe(doc);
  });

  it('光标不在的行隐藏标记，光标所在行显示原文', () => {
    const away = mount('# 标题\n\n**粗体**', 0);
    const boldLine = away.contentDOM.querySelectorAll('.cm-line')[2]!;
    expect(boldLine.textContent).toBe('粗体');
    expect(away.contentDOM.querySelector('.cm-md-h1')?.textContent).toBe('# 标题');
    away.destroy();

    const here = mount('# 标题\n\n**粗体**', '# 标题\n\n**'.length);
    expect(here.contentDOM.querySelectorAll('.cm-line')[2]!.textContent).toBe('**粗体**');
    expect(here.contentDOM.querySelector('.cm-md-h1')?.textContent).toBe('标题');
  });

  it('粘贴图片：落盘后在光标处插入相对路径引用，其余正文不动', async () => {
    const save = vi.fn(async () => 'assets/截图 1.png');
    const state = EditorState.create({
      doc: '前\n后',
      selection: EditorSelection.cursor(2),
      extensions: [markdown(), markdownImageInsert(save, () => {})],
    });
    view = new EditorView({ state, parent: document.body });
    const file = new File([new Uint8Array([1])], '截图 1.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [file] } });
    view.contentDOM.dispatchEvent(event);
    await vi.waitFor(() => expect(view!.state.sliceDoc()).toContain('!['));
    expect(save).toHaveBeenCalledWith(file);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.sliceDoc()).toBe('前\n![截图 1.png](assets/%E6%88%AA%E5%9B%BE%201.png)后');
  });

  it('公式与 mermaid：光标不在时显示渲染结果，光标移进去回到原文，正文不变', async () => {
    const doc =
      '行内 $x^2$ 公式\n\n$$\n\\frac{距离}{时间}\n$$\n\n```mermaid\ngraph TD; A-->B\n```\n\n末行';
    const editor = mount(doc, doc.length);
    expect(editor.contentDOM.querySelector('.cm-md-math .katex')).not.toBeNull();
    expect(editor.contentDOM.querySelector('.cm-md-math-block .katex-display')).not.toBeNull();
    expect(editor.contentDOM.querySelector('.cm-md-mermaid')).not.toBeNull();

    editor.dispatch({ selection: { anchor: doc.indexOf('x^2') } });
    expect(editor.contentDOM.querySelector('.cm-md-math')).toBeNull();
    expect(editor.contentDOM.textContent).toContain('$x^2$');

    editor.dispatch({ selection: { anchor: doc.indexOf('graph') } });
    expect(editor.contentDOM.querySelector('.cm-md-mermaid')).toBeNull();
    expect(editor.contentDOM.textContent).toContain('graph TD; A-->B');
    expect(editor.state.sliceDoc()).toBe(doc);
  });

  it('代码里的 $ 不渲染成公式', () => {
    const editor = mount('`$a$` 文字\n\n末行', '`$a$` 文字\n\n'.length);
    expect(editor.contentDOM.querySelector('.cm-md-math')).toBeNull();
  });

  it('图片在行下方按解析后的地址显示', () => {
    const editor = mount('![图](assets/a.png)\n\n文字', 0);
    const image = editor.contentDOM.querySelector<HTMLImageElement>('img.cm-md-image');
    expect(image?.getAttribute('src')).toBe('resolved:assets/a.png');
    expect(image?.alt).toBe('图');
  });

  it('表格：光标不在时渲染成表格（对齐、行内样式、空单元格），光标移进去回到原文', () => {
    const doc = '| 名称 | 值 |\n|:--|--:|\n| **粗** `码` | a\\|b |\n|  | 2 |\n\n末行';
    const editor = mount(doc, doc.length);
    const table = editor.contentDOM.querySelector('.cm-md-table table')!;
    const rows = [...table.querySelectorAll('tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ['名称', '值'],
      ['粗 码', 'a|b'],
      ['', '2'],
    ]);
    expect(table.querySelector('th')!.style.textAlign).toBe('left');
    expect(table.querySelectorAll('td')[1]!.style.textAlign).toBe('right');
    expect(table.querySelector('td .cm-md-strong')?.textContent).toBe('粗');
    expect(table.querySelector('td .cm-md-code')?.textContent).toBe('码');

    editor.dispatch({ selection: { anchor: doc.indexOf('2') } });
    expect(editor.contentDOM.querySelector('.cm-md-table')).toBeNull();
    expect(editor.contentDOM.textContent).toContain('|:--|--:|');
    expect(editor.state.sliceDoc()).toBe(doc);
  });

  it('引用与列表里的表格连同行首前缀一起渲染，单元格里的行内公式渲染成公式', () => {
    const doc =
      '> | a | b |\n> |---|---|\n> | $x^2$ | 2 |\n\n- 项\n\n  | c |\n  |---|\n  | 3 |\n\n末行';
    const editor = mount(doc, doc.length);
    const [quoted, listed] = editor.contentDOM.querySelectorAll('.cm-md-table');
    expect(quoted!.classList.contains('cm-md-quote')).toBe(true);
    expect([...quoted!.querySelectorAll('tr')].length).toBe(2);
    expect(quoted!.querySelector('td .cm-md-math .katex')).not.toBeNull();
    expect((listed as HTMLElement).style.marginLeft).toBe('2ch');
    expect(listed!.querySelector('td')?.textContent).toBe('3');
    expect(editor.state.sliceDoc()).toBe(doc);
  });

  it('分隔线：光标不在时整行画线，光标所在行显示原文', () => {
    const editor = mount('上\n\n---\n\n下', 0);
    expect(editor.contentDOM.querySelector('.cm-md-hr')?.textContent).toBe('');

    editor.dispatch({ selection: { anchor: '上\n\n'.length } });
    expect(editor.contentDOM.querySelector('.cm-md-hr')).toBeNull();
    expect(editor.contentDOM.querySelectorAll('.cm-line')[2]!.textContent).toBe('---');
  });

  it('无序列表符号按层级换成圆点，有序列表与光标所在行保持原文', () => {
    const doc = '- 一\n  * 二\n1. 三\n\n末行';
    const editor = mount(doc, doc.length);
    const lines = editor.contentDOM.querySelectorAll('.cm-line');
    expect(lines[0]!.textContent).toBe('• 一');
    expect(lines[1]!.textContent).toBe('  ◦ 二');
    expect(lines[2]!.textContent).toBe('1. 三');

    editor.dispatch({ selection: { anchor: 0 } });
    expect(editor.contentDOM.querySelectorAll('.cm-line')[0]!.textContent).toBe('- 一');
    expect(editor.state.sliceDoc()).toBe(doc);
  });

  it('任务列表显示复选框，点击只翻转勾选字符且不移动光标', () => {
    const doc = '- [ ] 待办\n1. [X] 完成\n\n末行';
    const editor = mount(doc, doc.length);
    const boxes = editor.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-md-task');
    expect([...boxes].map((box) => box.checked)).toEqual([false, true]);
    expect(editor.contentDOM.querySelectorAll('.cm-line')[0]!.textContent).toBe(' 待办');
    expect(editor.contentDOM.querySelectorAll('.cm-line')[1]!.textContent).toBe('1.  完成');

    boxes[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(editor.state.sliceDoc()).toBe('- [x] 待办\n1. [X] 完成\n\n末行');
    editor.contentDOM
      .querySelectorAll<HTMLInputElement>('input.cm-md-task')[1]!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(editor.state.sliceDoc()).toBe('- [x] 待办\n1. [ ] 完成\n\n末行');
    expect(editor.state.selection.main.head).toBe(doc.length);
  });
});
