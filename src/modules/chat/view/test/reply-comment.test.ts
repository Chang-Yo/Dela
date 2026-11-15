// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { commentRange, placeFloating } from './reply-comment';

const view = { width: 600, height: 400 };
const box = { width: 120, height: 32 };
const edge = 8;
const anchor = (top: number, bottom: number, center = 300) => ({
  top,
  bottom,
  topCenter: center,
  bottomCenter: center,
});

describe('placeFloating', () => {
  it('优先放在选区上方，水平居中于首行', () => {
    expect(placeFloating(anchor(200, 220), box, view, edge, false)).toEqual({
      top: 200 - edge - box.height,
      left: 300 - box.width / 2,
      side: 'top',
    });
  });

  it('上方放不下翻到下方，不压上方会话栏', () => {
    expect(placeFloating(anchor(20, 40), box, view, edge, false)).toMatchObject({
      top: 40 + edge,
      side: 'bottom',
    });
  });

  it('选区高过视口时贴上沿，不压下方输入框', () => {
    const spot = placeFloating(anchor(-500, 900), box, view, edge, false)!;
    expect(spot.top).toBe(edge);
    expect(spot.top + box.height).toBeLessThanOrEqual(view.height - edge);
  });

  it('选区滚出视口：提示隐藏，正在写的评论贴在最近的边缘', () => {
    expect(placeFloating(anchor(-80, -40), box, view, edge, false)).toBeNull();
    expect(placeFloating(anchor(450, 480), box, view, edge, false)).toBeNull();
    expect(placeFloating(anchor(-80, -40), box, view, edge, true)?.top).toBe(edge);
    expect(placeFloating(anchor(450, 480), box, view, edge, true)?.top).toBe(
      view.height - edge - box.height,
    );
  });

  it('靠近左右边缘时水平夹在视口内', () => {
    expect(placeFloating(anchor(200, 220, 10), box, view, edge, false)?.left).toBe(edge);
    expect(placeFloating(anchor(200, 220, 595), box, view, edge, false)?.left).toBe(
      view.width - edge - box.width,
    );
  });
});

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
