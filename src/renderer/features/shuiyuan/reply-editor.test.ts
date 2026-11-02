// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { shuiyuanReplyDecorations } from './reply-editor';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

const doc = '[quote="alice, post:3, topic:9"]\n原话\n[/quote]\n\n正文';

function mount(cursor: number) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: shuiyuanReplyDecorations(),
    }),
    parent: document.body,
  });
  return [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent);
}

describe('shuiyuanReplyDecorations', () => {
  it('光标在引用块外：首尾标记行换成署名与楼层，正文保留', () => {
    expect(mount(doc.length)).toEqual(['@alice · 第 3 楼', '原话', '', '', '正文']);
    expect(view!.state.sliceDoc()).toBe(doc);
  });

  it('光标进入引用块即回到原文，便于修改署名', () => {
    expect(mount(doc.indexOf('原话'))).toEqual([
      '[quote="alice, post:3, topic:9"]',
      '原话',
      '[/quote]',
      '',
      '正文',
    ]);
  });

  it('未闭合的 [quote] 不渲染成引用', () => {
    view = new EditorView({
      state: EditorState.create({ doc: '[quote]\n还在写', extensions: shuiyuanReplyDecorations() }),
      parent: document.body,
    });
    expect(view.contentDOM.querySelector('.cm-sy-quote')).toBeNull();
  });
});
