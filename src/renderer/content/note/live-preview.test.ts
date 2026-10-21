// @vitest-environment jsdom
// 即时渲染只加装饰：正文字节原样保留，光标所在行显示标记，其他行隐藏标记。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdown } from '@codemirror/lang-markdown';
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
      markdown(),
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

  it('图片在行下方按解析后的地址显示', () => {
    const editor = mount('![图](assets/a.png)\n\n文字', 0);
    const image = editor.contentDOM.querySelector<HTMLImageElement>('img.cm-md-image');
    expect(image?.getAttribute('src')).toBe('resolved:assets/a.png');
    expect(image?.alt).toBe('图');
  });
});
