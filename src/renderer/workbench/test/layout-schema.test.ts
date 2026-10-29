import { describe, expect, it } from 'vitest';
import type { GroupNode, LayoutNode } from '../../../shared/layout';
import {
  clampRatio,
  countNodes,
  createDefaultLayout,
  nextGroupId,
  parseWorkbenchLayout,
  removeGroup,
  walkGroups,
} from '../layout-schema';

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

  it('接受嵌套 split（depth ≥ 2）', () => {
    const layout = {
      root: split([group('a', ['note:1']), split([group('b'), group('c')], 0.3)]),
      focus: 'b',
      maximized: null,
    };
    expect(parseWorkbenchLayout(layout)).not.toBeNull();
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

  it('没有固定标签的组不带 pinned 字段', () => {
    const parsed = parseWorkbenchLayout({
      root: group('a', ['note:x'], 'note:x'),
      focus: 'a',
      maximized: null,
    });
    expect(parsed?.root).toEqual({ type: 'group', id: 'a', tabs: ['note:x'], active: 'note:x' });
  });
});

describe('树操作', () => {
  it('removeGroup 删除组并收敛单子 split', () => {
    const tree = split([group('a'), split([group('b'), group('c')])]);
    // 删 c：内层 split 只剩 b → 上提；外层回到 [a, b]。
    expect(removeGroup(tree, 'c')).toEqual(split([group('a'), group('b')]));
    // 删 a：外层只剩内层 split → 上提为根。
    expect(removeGroup(tree, 'a')).toEqual(split([group('b'), group('c')]));
    // 根组不删除。
    expect(removeGroup(group('root'), 'root')).toEqual(group('root'));
  });

  it('clampRatio 收敛到 [0.05, 0.95]', () => {
    expect(clampRatio(0.001)).toBe(0.05);
    expect(clampRatio(1)).toBe(0.95);
    expect(clampRatio(Number.NaN)).toBe(0.5);
    expect(clampRatio(0.42)).toBe(0.42);
  });

  it('nextGroupId 避开已占用 id', () => {
    const tree = split([group('g1'), split([group('g2'), group('primary')])]);
    expect(nextGroupId(tree)).toBe('g3');
  });

  it('walkGroups / countNodes', () => {
    const tree = split([group('a'), split([group('b'), group('c')])]);
    expect(walkGroups(tree).map((g) => g.id)).toEqual(['a', 'b', 'c']);
    expect(countNodes(tree)).toBe(5);
  });
});
