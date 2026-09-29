import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchLayout } from '../../../shared/layout';
import { createDefaultLayout, findGroup, splitDepth, walkGroups } from '../layout-schema';
import { useWorkbenchLayout } from '../layout-store';

const uuid = '00000000-0000-4000-8000-000000000002';

function installLayoutApi(get: (projectId: string | null) => WorkbenchLayout | null) {
  const save = vi.fn(async () => {});
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: { layout: { get: vi.fn(async (projectId: string | null) => get(projectId)), save } },
    },
  });
  return { save };
}

function resetStore() {
  useWorkbenchLayout.setState({
    projectId: null,
    root: createDefaultLayout().root,
    focus: 'primary',
    maximized: null,
    ready: true,
  });
}

const groups = () => walkGroups(useWorkbenchLayout.getState().root);
const state = () => useWorkbenchLayout.getState();

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('init', () => {
  it('使用已保存布局（按项目键控）', async () => {
    const saved: WorkbenchLayout = {
      root: {
        type: 'split',
        orientation: 'horizontal',
        ratio: 0.6,
        children: [
          { type: 'group', id: 'primary', tabs: ['note:a'], active: 'note:a' },
          { type: 'group', id: 'secondary', tabs: [], active: null },
        ],
      },
      focus: 'secondary',
      maximized: null,
    };
    const seen: (string | null)[] = [];
    installLayoutApi((projectId) => {
      seen.push(projectId);
      return saved;
    });
    await state().init(uuid);
    expect(seen).toEqual([uuid]);
    expect(state().root).toEqual(saved.root);
    expect(state().focus).toBe('secondary');
    expect(state().ready).toBe(true);
  });

  it('损坏的保存数据回退到旧数据种子', async () => {
    installLayoutApi(
      () =>
        ({ root: groupOf('broken'), focus: 'nope', maximized: 'x' }) as unknown as WorkbenchLayout,
    );
    await state().init(uuid, { scope: uuid, viewTabs: ['a', 'source:b'], viewActive: 'a' });
    expect(groups()).toHaveLength(1);
    expect(findGroup(state().root, 'primary')).toEqual({
      type: 'group',
      id: 'primary',
      tabs: ['note:a', 'preview:source:b'],
      active: 'note:a',
    });
  });

  it('无保存且无旧数据 → 默认空单组', async () => {
    installLayoutApi(() => null);
    await state().init(null);
    expect(state().root).toEqual(createDefaultLayout().root);
    expect(state().projectId).toBeNull();
  });
});

describe('openTab', () => {
  beforeEach(() => installLayoutApi(() => null));

  it('新标签进入焦点组并激活', () => {
    state().openTab('note:a');
    state().openTab('note:b');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a', 'note:b']);
    expect(findGroup(state().root, 'primary')?.active).toBe('note:b');
  });

  it('已打开的标签聚焦已有出现处，不新建', () => {
    state().openTab('note:a');
    state().splitGroup('primary', 'vertical');
    const before = groups().length;
    state().openTab('note:a');
    expect(groups()).toHaveLength(before);
    // splitGroup 后焦点在新组；再次 openTab 定位回 primary 的已有标签。
    expect(state().focus).toBe('primary');
    expect(findGroup(state().root, 'primary')?.active).toBe('note:a');
  });

  it('显式目标组允许跨组重复打开（并排第二视图）', () => {
    state().openTab('note:a');
    state().openTab('note:a', 'primary');
    state().splitGroup('primary', 'vertical');
    const side = groups()[1]!;
    state().openTab('note:a', side.id);
    expect(side.tabs.filter((tab) => tab === 'note:a')).toHaveLength(1);
    expect(findGroup(state().root, 'primary')?.tabs).toContain('note:a');
    expect(side.tabs).toContain('note:a');
  });
});

describe('closeTab / closeTabs', () => {
  beforeEach(() => installLayoutApi(() => null));

  it('关闭活动标签后激活滑入位置或前一个', () => {
    state().openTab('note:a');
    state().openTab('note:b');
    state().openTab('note:c');
    state().openTab('note:a'); // 激活 a（首个）
    state().closeTab('note:a');
    expect(findGroup(state().root, 'primary')?.active).toBe('note:b');
    state().closeTab('note:c'); // 激活 c（末尾）
    expect(findGroup(state().root, 'primary')?.active).toBe('note:b');
  });

  it('空组删除、split 收敛、焦点回到相邻组', () => {
    state().openTab('note:a');
    state().splitGroup('primary', 'vertical');
    const side = groups()[1]!;
    expect(side.tabs).toEqual(['note:a']);
    state().closeTab('note:a', side.id);
    expect(state().root.type).toBe('group');
    expect(groups()).toHaveLength(1);
    expect(state().focus).toBe('primary');
  });

  it('根组保留空态，不删除', () => {
    state().openTab('note:a');
    state().closeTab('note:a');
    expect(state().root).toEqual({ type: 'group', id: 'primary', tabs: [], active: null });
  });

  it('closeTabs others/right 按锚点批量关闭', () => {
    for (const tab of ['note:a', 'note:b', 'note:c'] as const) state().openTab(tab);
    state().closeTabs('primary', 'right', 'note:a');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a']);
    state().openTab('note:b');
    state().closeTabs('primary', 'others', 'note:b');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:b']);
  });
});

describe('moveTab / moveTabToEdge', () => {
  beforeEach(() => installLayoutApi(() => null));

  it('组内排序保持激活态', () => {
    for (const tab of ['note:a', 'note:b', 'note:c'] as const) state().openTab(tab);
    state().moveTab('note:c', 'primary', 'primary', 0);
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:c', 'note:a', 'note:b']);
    expect(findGroup(state().root, 'primary')?.active).toBe('note:c');
  });

  it('跨组移动去重：目标组已有同 id 标签时合并为一个', () => {
    state().openTab('note:a');
    state().openTab('note:b');
    state().splitGroup('primary', 'vertical'); // 新组复制活动标签 note:b
    const side = groups()[1]!;
    state().moveTab('note:b', 'primary', side.id, 0);
    expect(side.tabs).toEqual(['note:b']);
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a']);
    expect(state().focus).toBe(side.id);
    expect(side.active).toBe('note:b');
  });

  it('边缘拖放在目标侧创建新组并移入（左缘 → 新组在前）', () => {
    state().openTab('note:a');
    state().openTab('note:b');
    state().moveTabToEdge('note:a', 'primary', 'primary', 'left');
    const root = state().root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.orientation).toBe('vertical');
    expect(root.children[0]).toMatchObject({ type: 'group', tabs: ['note:a'] });
    expect(root.children[1]).toMatchObject({ type: 'group', id: 'primary', tabs: ['note:b'] });
    // 移动而非复制：原组不再持有该标签。
    expect(walkGroups(root).flatMap((g) => g.tabs)).toEqual(['note:a', 'note:b']);
  });

  it('下缘拖放产生横向 split', () => {
    state().openTab('note:a');
    state().moveTabToEdge('note:a', 'primary', 'primary', 'bottom');
    const root = state().root;
    expect(root.type).toBe('split');
    if (root.type === 'split') expect(root.orientation).toBe('horizontal');
  });
});

describe('splitGroup / setMaximized / setRatio', () => {
  beforeEach(() => installLayoutApi(() => null));

  it('split 包裹目标组、复制活动标签、焦点落到新组', () => {
    state().openTab('note:a');
    state().splitGroup('primary', 'vertical');
    const root = state().root;
    expect(root.type).toBe('split');
    expect(splitDepth(root)).toBe(1);
    const side = groups()[1]!;
    expect(side.tabs).toEqual(['note:a']);
    expect(state().focus).toBe(side.id);
  });

  it('三屏 = 嵌套 split（depth 2），横纵组合', () => {
    state().openTab('note:a');
    state().splitGroup('primary', 'vertical');
    state().splitGroup(groups()[1]!.id, 'horizontal');
    expect(groups()).toHaveLength(3);
    expect(splitDepth(state().root)).toBe(2);
    const root = state().root;
    if (root.type === 'split') {
      expect(root.orientation).toBe('vertical');
      const inner = root.children[1];
      expect(inner?.type === 'split' && inner.orientation).toBe('horizontal');
    }
  });

  it('ratio 拖拽收敛到 0.05–0.95；非法路径无效', () => {
    state().openTab('note:a');
    state().splitGroup('primary', 'vertical');
    state().setRatio([], 0.001);
    let root = state().root;
    expect(root.type === 'split' ? root.ratio : null).toBe(0.05);
    state().setRatio([], 2);
    root = state().root;
    expect(root.type === 'split' ? root.ratio : null).toBe(0.95);
    state().setRatio([9], 0.5);
    expect(state().root).toBe(root);
  });

  it('最大化与还原；最大化组被关闭时清除最大化态', () => {
    state().openTab('note:a');
    state().splitGroup('primary', 'vertical');
    const side = groups()[1]!;
    state().setMaximized(side.id);
    expect(state().maximized).toBe(side.id);
    expect(state().focus).toBe(side.id);
    state().closeTabs(side.id, 'all');
    expect(state().maximized).toBeNull();
    expect(state().root.type).toBe('group');
  });
});

describe('持久化', () => {
  it('变更防抖 800ms 合并为一次 layout:save（按当前项目键控）', async () => {
    const { save } = installLayoutApi(() => null);
    await state().init(uuid, { scope: uuid, viewTabs: [], viewActive: null });
    state().openTab('note:z');
    state().openTab('note:w');
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(uuid, {
      root: { type: 'group', id: 'primary', tabs: ['note:z', 'note:w'], active: 'note:w' },
      focus: 'primary',
      maximized: null,
    });
  });

  it('首次保存成功后清除旧视图 localStorage 键；保存失败保留', async () => {
    const storage = new Map<string, string>([
      [`dela.editor.layout.${uuid}`, '{"split":false}'],
      ['dela.workspace.agentOpen', 'true'],
      ['dela.workspace.agentWidth', '360'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => void storage.delete(key),
    });
    // 先失败：旧键必须保留（下次变更重试，期间旧数据仍是回退种子）。
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error('db busy');
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dela: { layout: { get: vi.fn(async () => null), save } },
      },
    });
    await state().init(uuid, { scope: uuid, viewTabs: [], viewActive: null });
    await vi.advanceTimersByTimeAsync(800);
    expect(storage.has(`dela.editor.layout.${uuid}`)).toBe(true);
    // 成功后：旧布局键与助手面板死键一并清除。
    fail = false;
    state().openTab('note:z');
    await vi.advanceTimersByTimeAsync(800);
    expect(storage.has(`dela.editor.layout.${uuid}`)).toBe(false);
    expect(storage.has('dela.workspace.agentOpen')).toBe(false);
    expect(storage.has('dela.workspace.agentWidth')).toBe(false);
  });
});

function groupOf(id: string) {
  return { type: 'group', id, tabs: [], active: null };
}
