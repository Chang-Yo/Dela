// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { commentRange } from '../reply-comment';

describe('commentRange', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  const mount = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.append(root);
    return root;
  };
  const select = (start: Node, startOffset: number, end: Node, endOffset: number) => {
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    const range = document.createRange();
    range.setStart(start, startOffset);
    range.setEnd(end, endOffset);
    selection.addRange(range);
    return selection;
  };
  const text = (root: HTMLElement, selector: string) => root.querySelector(selector)!.firstChild!;

  it('同一段已完成回复正文内的选区可评论', () => {
    const root = mount(
      '<div data-assistant-body><p id="a">第一段回复</p><p id="b">第二段</p></div>',
    );
    const range = commentRange(select(text(root, '#a'), 1, text(root, '#b'), 2), root);
    expect(range?.toString()).toBe('一段回复第二');
  });

  it('跨两段正文、流式中的回复、正文之外的选区都不可评论', () => {
    const root = mount(
      '<div data-assistant-body><p id="a">回复一</p></div>' +
        '<div data-assistant-body><p id="b">回复二</p></div>' +
        '<div data-reply-live><div data-assistant-body><p id="c">生成中</p></div></div>' +
        '<p id="d">用户消息</p>',
    );
    expect(commentRange(select(text(root, '#a'), 0, text(root, '#b'), 2), root)).toBeNull();
    expect(commentRange(select(text(root, '#c'), 0, text(root, '#c'), 2), root)).toBeNull();
    expect(commentRange(select(text(root, '#d'), 0, text(root, '#d'), 2), root)).toBeNull();
    const outside = mount('<div data-assistant-body><p id="e">别处</p></div>');
    expect(commentRange(select(text(outside, '#e'), 0, text(outside, '#e'), 2), root)).toBeNull();
  });

  it('三击选段时终点落在下一块开头，收回到正文末尾', () => {
    const root = mount(
      '<div data-assistant-body><p id="a">整段回复</p></div><div><p id="b">工具调用</p></div>',
    );
    const range = commentRange(select(text(root, '#a'), 0, text(root, '#b'), 0), root);
    expect(range?.toString()).toBe('整段回复');
  });
});
