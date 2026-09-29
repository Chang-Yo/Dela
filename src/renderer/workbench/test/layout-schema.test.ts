import { describe, expect, it } from 'vitest';
import type { GroupNode, LayoutNode } from '../../../shared/layout';
import {
  clampRatio,
  countNodes,
  createDefaultLayout,
  findGroup,
  mapLegacyTabKey,
  nextGroupId,
  parseWorkbenchLayout,
  removeGroup,
  seedLayoutFromLegacy,
  splitDepth,
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

  it('walkGroups / splitDepth / countNodes', () => {
    const tree = split([group('a'), split([group('b'), group('c')])]);
    expect(walkGroups(tree).map((g) => g.id)).toEqual(['a', 'b', 'c']);
    expect(splitDepth(tree)).toBe(2);
    expect(countNodes(tree)).toBe(5);
  });
});

describe('旧数据种子迁移', () => {
  const uuid = '00000000-0000-4000-8000-000000000002';

  it('旧双组 split → depth-1 split，保留方向/比例/焦点', () => {
    const layout = seedLayoutFromLegacy({
      scope: uuid,
      viewTabs: [],
      viewActive: null,
      stored: {
        split: true,
        orientation: 'horizontal',
        ratio: 0.7,
        focus: 'secondary',
        groups: {
          primary: { tabs: ['n1'], active: 'n1' },
          secondary: { tabs: ['n2', 'source:9'], active: 'n2' },
        },
      },
    });
    expect(layout.root).toEqual({
      type: 'split',
      orientation: 'horizontal',
      ratio: 0.7,
      children: [
        { type: 'group', id: 'primary', tabs: ['note:n1'], active: 'note:n1' },
        {
          type: 'group',
          id: 'secondary',
          tabs: ['note:n2', 'preview:source:9'],
          active: 'note:n2',
        },
      ],
    });
    expect(layout.focus).toBe('secondary');
    expect(layout.maximized).toBeNull();
    expect(splitDepth(layout.root)).toBe(1);
  });

  it('tab 键映射：source: → preview:，entryId 默认 note:，resolveEntryKind 可判 preview', () => {
    expect(mapLegacyTabKey('source:12')).toBe('preview:source:12');
    expect(mapLegacyTabKey('entry-1')).toBe('note:entry-1');
    expect(mapLegacyTabKey('entry-1', () => 'preview')).toBe('preview:entry-1');
    expect(mapLegacyTabKey('')).toBeNull();
  });

  it('无存储 → view tabs 单组（去重、保序）', () => {
    const layout = seedLayoutFromLegacy({
      scope: uuid,
      viewTabs: ['a', 'source:b', 'a'],
      viewActive: 'source:b',
    });
    expect(layout.root).toEqual({
      type: 'group',
      id: 'primary',
      tabs: ['note:a', 'preview:source:b'],
      active: 'preview:source:b',
    });
    expect(layout.focus).toBe('primary');
  });

  it('组数据缺失时保留旧扁平 active', () => {
    const layout = seedLayoutFromLegacy({
      scope: uuid,
      viewTabs: ['a', 'b'],
      viewActive: 'a',
      stored: { ratio: 0.5 },
    });
    expect(findGroup(layout.root, 'primary')?.active).toBe('note:a');
  });

  it('旧 ratio 越界收敛到新边界；split 但副组为空 → 单组', () => {
    const clamped = seedLayoutFromLegacy({
      scope: uuid,
      viewTabs: [],
      viewActive: null,
      stored: {
        split: true,
        ratio: 0.99,
        groups: { primary: { tabs: ['a'] }, secondary: { tabs: [] } },
      },
    });
    expect(clamped.root.type).toBe('group');
    const wide = seedLayoutFromLegacy({
      scope: uuid,
      viewTabs: [],
      viewActive: null,
      stored: {
        split: true,
        ratio: 0.99,
        groups: { primary: { tabs: ['a'] }, secondary: { tabs: ['b'] } },
      },
    });
    expect(wide.root.type === 'split' ? wide.root.ratio : null).toBe(0.95);
  });
});
