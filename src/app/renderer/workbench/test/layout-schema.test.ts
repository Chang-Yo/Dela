import { describe, expect, it } from 'vitest';
import type { GroupNode, LayoutNode } from '../../../../modules/workspace/contract';
import { countNodes, createDefaultLayout, parseWorkbenchLayout } from '../layout-schema';

const group = (id: string, tabs: string[] = [], active: string | null = null): GroupNode => ({
  type: 'group',
  id,
  tabs: tabs as GroupNode['tabs'],
  active: active as GroupNode['active'],
});
const split = (children: LayoutNode[], ratio = 0.5): LayoutNode => ({
  type: 'split',
  orientation: 'vertical',
  ratio,
  children,
});

describe('布局 schema 校验', () => {
  it('接受合法布局', () => {
    const layout = createDefaultLayout();
    expect(parseWorkbenchLayout(layout)).toEqual(layout);
  });

  it('拒绝组内重复标签', () => {
    const layout = { root: group('a', ['note:1', 'note:1']), focus: 'a', maximized: null };
    expect(parseWorkbenchLayout(layout)).toBeNull();
  });

  it('拒绝非法 TabId 与越界 ratio', () => {
    expect(
      parseWorkbenchLayout({ root: group('a', ['unknown:1']), focus: 'a', maximized: null }),
    ).toBeNull();
    expect(
      parseWorkbenchLayout({ root: group('a', ['note:']), focus: 'a', maximized: null }),
    ).toBeNull();
    expect(
      parseWorkbenchLayout({
        root: split([group('a'), group('b')], 0.01),
        focus: 'a',
        maximized: null,
      }),
    ).toBeNull();
    expect(
      parseWorkbenchLayout({
        root: split([group('a'), group('b')], 0.99),
        focus: 'a',
        maximized: null,
      }),
    ).toBeNull();
  });

  it('拒绝活动标签不在组内', () => {
    const layout = { root: group('a', ['note:1'], 'note:2'), focus: 'a', maximized: null };
    expect(parseWorkbenchLayout(layout)).toBeNull();
  });

  it('拒绝焦点/最大化指向不存在的组', () => {
    const root = group('a');
    expect(parseWorkbenchLayout({ root, focus: 'missing', maximized: null })).toBeNull();
    expect(parseWorkbenchLayout({ root, focus: 'a', maximized: 'missing' })).toBeNull();
  });

  it('拒绝超过节点数上限的树', () => {
    let deep: LayoutNode = group('leaf');
    for (let i = 0; i < 16; i += 1) deep = split([deep, group(`sib${i}`)]);
    expect(countNodes(deep)).toBeGreaterThan(31);
    expect(parseWorkbenchLayout({ root: deep, focus: 'leaf', maximized: null })).toBeNull();
  });

  it('接受 pinned 字段并在载入时归一：排序、去重、过滤失效引用', () => {
    const parsed = parseWorkbenchLayout({
      root: {
        type: 'group',
        id: 'a',
        tabs: ['note:b', 'note:a', 'note:c'],
        active: 'note:c',
        pinned: ['note:a', 'note:gone', 'note:a'],
      },
      focus: 'a',
      maximized: null,
    });
    expect(parsed?.root).toEqual({
      type: 'group',
      id: 'a',
      tabs: ['note:a', 'note:b', 'note:c'],
      active: 'note:c',
      pinned: ['note:a'],
    });
  });
});
