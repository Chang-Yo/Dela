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
    // init 对已就绪的同项目布局早退；测试统一从未就绪起步，保证每个用例都走真实加载路径。
    ready: false,
  });
}

const groups = () => walkGroups(useWorkbenchLayout.getState().root);
const state = () => useWorkbenchLayout.getState();

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  // 先让在途防抖回调跑完再清：clearAllTimers 不会触发回调置空 store 的 persistTimer，
  // 残留句柄会让下一个用例的 init 冲刷误判有在途保存。
  vi.runAllTimers();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('init', () => {
  it('布局加载期间关闭 ready，防止导航提前消费聊天标签', async () => {
    installLayoutApi(() => null);
    let finish!: (layout: WorkbenchLayout | null) => void;
    const pending = new Promise<WorkbenchLayout | null>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(window.dela!.layout, 'get').mockReturnValue(pending);
    const loading = state().init(uuid);
    expect(state().ready).toBe(false);
    finish(null);
    await loading;
    expect(state().ready).toBe(true);
    expect(state().projectId).toBe(uuid);
  });

  it('按项目恢复有内容的标签，合并旧空组并修复焦点', async () => {
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
    expect(state().root).toEqual({
      type: 'group',
      id: 'primary',
      tabs: ['note:a'],
      active: 'note:a',
    });
    expect(state().focus).toBe('primary');
    expect(state().ready).toBe(true);
  });

  it('损坏的保存数据回退到空布局', async () => {
    installLayoutApi(
      () =>
        ({ root: groupOf('broken'), focus: 'nope', maximized: 'x' }) as unknown as WorkbenchLayout,
    );
    await state().init(uuid);
    expect(groups()).toHaveLength(1);
    expect(findGroup(state().root, 'primary')).toEqual({
      type: 'group',
      id: 'primary',
      tabs: [],
      active: null,
    });
  });

  it('无保存数据 → 默认空单组', async () => {
    installLayoutApi(() => null);
    await state().init(null);
    expect(state().root).toEqual(createDefaultLayout().root);
    expect(state().projectId).toBeNull();
  });

  it('旧布局全为空组时收敛为一个空根组并清除最大化', async () => {
    installLayoutApi(() => ({
      root: {
        type: 'split',
        orientation: 'vertical',
        ratio: 0.5,
        children: [
          { type: 'group', id: 'primary', tabs: [], active: null },
          { type: 'group', id: 'secondary', tabs: [], active: null },
        ],
      },
      focus: 'secondary',
      maximized: 'secondary',
    }));
    await state().init(uuid);
    expect(groups()).toHaveLength(1);
    expect(groups()[0]!.tabs).toEqual([]);
    expect(state().focus).toBe('primary');
    expect(state().maximized).toBeNull();
  });
});

describe('relocatePaths', () => {
  it('移动 Mac 目录只更新所属标签与固定状态，保留同前缀兄弟文件', () => {
    installLayoutApi(() => null);
    useWorkbenchLayout.setState({
      root: {
        type: 'group',
        id: 'primary',
        tabs: ['note:/repo/a/note.md', 'preview:/repo/a\\sibling.md'],
        active: 'note:/repo/a/note.md',
        pinned: ['preview:/repo/a\\sibling.md'],
      },
    });
    state().relocatePaths('/repo/a', '/repo/b');
    expect(groups()[0]).toEqual({
      type: 'group',
      id: 'primary',
      tabs: ['note:/repo/b/note.md', 'preview:/repo/a\\sibling.md'],
      active: 'note:/repo/b/note.md',
      pinned: ['preview:/repo/a\\sibling.md'],
    });
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
});

describe('closeTab / closeTabs', () => {
  beforeEach(() => installLayoutApi(() => null));

  it('Terminal 的最后一处标签关闭才结束项目终端，切换/分屏不结束', () => {
    const closeProject = vi.fn(async () => {});
    Object.assign(window.dela!, { terminal: { closeProject } });
    const tab = `terminal:${uuid}` as const;
    state().openTab(tab);
    state().splitGroup('primary', 'vertical');
    const side = groups()[1]!;
    state().closeTab(tab, 'primary');
    expect(closeProject).not.toHaveBeenCalled();
    state().closeTab(tab, side.id);
    expect(closeProject).toHaveBeenCalledExactlyOnceWith(uuid);
  });

  it('关闭活动标签后激活滑入位置或前一个', () => {
    state().openTab('note:a');
    state().openTab('note:b');
    state().openTab('note:c');
    state().openTab('note:a');
    state().closeTab('note:a');
    expect(findGroup(state().root, 'primary')?.active).toBe('note:b');
    state().closeTab('note:c');
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
    state().openTab('note:b');
    state().moveTabToEdge('note:a', 'primary', 'primary', 'bottom');
    const root = state().root;
    expect(root.type).toBe('split');
    if (root.type === 'split') expect(root.orientation).toBe('horizontal');
  });

  it('移走最后一个标签时移除来源组，保留目标的内容与焦点', () => {
    state().openTab('note:a');
    state().splitGroup('primary', 'vertical');
    const side = groups()[1]!;
    state().moveTab('note:a', 'primary', side.id, 0);
    expect(groups()).toHaveLength(1);
    expect(state().root).toMatchObject({ id: side.id, tabs: ['note:a'] });
    expect(state().focus).toBe(side.id);
  });

  it('唯一标签拖到自己的边缘不留下空组', () => {
    state().openTab('note:a');
    state().moveTabToEdge('note:a', 'primary', 'primary', 'bottom');
    expect(groups()).toHaveLength(1);
    expect(groups()[0]!.tabs).toEqual(['note:a']);
  });
});

describe('splitGroup / setMaximized / setRatio', () => {
  beforeEach(() => installLayoutApi(() => null));

  it('空组不能继续分屏', () => {
    state().splitGroup('primary', 'vertical');
    expect(groups()).toHaveLength(1);
  });

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

  it('非法路径的 ratio 变更无效', () => {
    state().openTab('note:a');
    state().splitGroup('primary', 'vertical');
    const root = state().root;
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
    await state().init(uuid);
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

  it('800ms 去抖窗口内切换项目：init 冲刷在途保存并按旧项目键控', async () => {
    const other = '00000000-0000-4000-8000-000000000003';
    const { save } = installLayoutApi(() => null);
    await state().init(uuid);
    await vi.advanceTimersByTimeAsync(800); // init 自身的种子写回
    expect(save).toHaveBeenCalledTimes(1);
    state().openTab('note:z');
    await state().init(other);
    // 在途保存立即按旧项目落库；否则去抖结束后快照已是新项目状态，旧项目丢失该次变更。
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, uuid, {
      root: { type: 'group', id: 'primary', tabs: ['note:z'], active: 'note:z' },
      focus: 'primary',
      maximized: null,
    });
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenNthCalledWith(3, other, {
      root: { type: 'group', id: 'primary', tabs: [], active: null },
      focus: 'primary',
      maximized: null,
    });
  });
});

describe('togglePin / 固定区', () => {
  beforeEach(() => installLayoutApi(() => null));

  it('固定挪入固定区末尾，取消固定落到未固定区开头', () => {
    for (const tab of ['note:a', 'note:b', 'note:c'] as const) state().openTab(tab);

    state().togglePin('note:b', 'primary');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:b', 'note:a', 'note:c']);
    expect(findGroup(state().root, 'primary')?.pinned).toEqual(['note:b']);

    state().togglePin('note:c', 'primary');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:b', 'note:c', 'note:a']);

    state().togglePin('note:b', 'primary');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:c', 'note:b', 'note:a']);
    expect(findGroup(state().root, 'primary')?.pinned).toEqual(['note:c']);
  });

  it('批量关闭跳过固定标签，固定标签只能显式逐个关闭', () => {
    for (const tab of ['note:a', 'note:b', 'note:c'] as const) state().openTab(tab);
    state().togglePin('note:a', 'primary');

    // 关闭右侧不受固定区保护语义影响：锚点右侧全是未固定标签时照常关闭。
    state().closeTabs('primary', 'right', 'note:a');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a']);

    state().openTab('note:b');
    state().togglePin('note:b', 'primary');
    state().openTab('note:c');
    state().closeTabs('primary', 'others', 'note:c');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a', 'note:b', 'note:c']);
    state().closeTabs('primary', 'all');
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a', 'note:b']);
  });

  it('拖拽排序钳制在各自区域内：未固定进不了固定区，双固定可换位', () => {
    for (const tab of ['note:a', 'note:b', 'note:c'] as const) state().openTab(tab);
    state().togglePin('note:a', 'primary');
    state().togglePin('note:b', 'primary');

    // 未固定 c 想插到最前：被钳到固定区之后，位置不变。
    state().moveTab('note:c', 'primary', 'primary', 0);
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a', 'note:b', 'note:c']);

    // 固定 a 拖到 b 的右半段（targetIndex=2 → 钳到固定区末尾）：可换位，不会越出固定区。
    state().moveTab('note:a', 'primary', 'primary', 2);
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:b', 'note:a', 'note:c']);

    state().moveTab('note:a', 'primary', 'primary', 0);
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a', 'note:b', 'note:c']);
  });

  it('跨组移动保留固定状态（仿 VS Code），源组固定记录同步清理', () => {
    state().openTab('note:a');
    state().openTab('note:b');
    state().togglePin('note:a', 'primary');
    state().splitGroup('primary', 'vertical', true);
    const side = groups()[1]!;
    state().moveTab('note:a', 'primary', side.id);
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:b']);
    expect(findGroup(state().root, 'primary')?.pinned).toBeUndefined();
    expect(findGroup(state().root, side.id)?.tabs).toEqual(['note:a']);
    expect(findGroup(state().root, side.id)?.pinned).toEqual(['note:a']);
  });

  it('跨组拖入未固定副本时，目标组同 id 的陈旧固定引用被剔除', () => {
    state().openTab('note:b');
    state().openTab('note:a');
    state().togglePin('note:b', 'primary');
    state().splitGroup('primary', 'vertical', true);
    const side = groups()[1]!;
    state().openTab('note:a', side.id);
    state().togglePin('note:a', side.id);
    state().openTab('note:c', side.id);
    expect(findGroup(state().root, side.id)?.tabs).toEqual(['note:a', 'note:c']);
    // primary 里未固定的 a 拖到 side 尾部：合并后的 a 不能保持固定，否则
    // pinned 不再是 tabs 的前缀。
    state().moveTab('note:a', 'primary', side.id, 2);
    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:b']);
    expect(findGroup(state().root, 'primary')?.pinned).toEqual(['note:b']);
    expect(findGroup(state().root, side.id)?.tabs).toEqual(['note:c', 'note:a']);
    expect(findGroup(state().root, side.id)?.pinned).toBeUndefined();
  });

  it('closeTab 同步清理固定记录，清空后字段收敛为缺省', () => {
    for (const tab of ['note:a', 'note:b'] as const) state().openTab(tab);
    state().togglePin('note:b', 'primary');

    state().closeTab('note:b', 'primary');

    expect(findGroup(state().root, 'primary')?.tabs).toEqual(['note:a']);
    expect(findGroup(state().root, 'primary')?.pinned).toBeUndefined();
  });
});

function groupOf(id: string) {
  return { type: 'group', id, tabs: [], active: null };
}
