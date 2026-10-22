// 标签打开规则（workbench/open-target.ts 顶部那张表）的行为测试：每条规则在项目与资料两种
// 工作台下各验一遍。规则改了，这里先红。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutNode } from '../../../shared/layout';
import { createDefaultLayout, findGroup, walkGroups } from '../layout-schema';
import { useWorkbenchLayout } from '../layout-store';
import { openTarget } from '../open-target';

const project = '00000000-0000-4000-8000-000000000002';

function setLayout(projectId: string | null, root: LayoutNode = createDefaultLayout().root) {
  useWorkbenchLayout.setState({
    projectId,
    root,
    focus: walkGroups(root)[0]!.id,
    maximized: null,
    ready: true,
  });
}

const state = () => useWorkbenchLayout.getState();
const groups = () => walkGroups(state().root);
const primary = () => findGroup(state().root, 'primary')!;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dela: { layout: { get: vi.fn(async () => null), save: vi.fn(async () => {}) } } },
  });
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('项目工作台：文件是预览，单击就地替换', () => {
  beforeEach(() => setLayout(project));

  it('连续单击多个文件只占一个标签位，后一个替换前一个', () => {
    openTarget('note:a.ts');
    openTarget('note:b.ts');
    openTarget('preview:c.pdf');
    expect(primary().tabs).toEqual(['preview:c.pdf']);
    expect(primary().preview).toBe('preview:c.pdf');
  });

  it('替换发生在预览标签原来的位置，不挪到末尾', () => {
    openTarget('chat:s1');
    openTarget('note:a.ts');
    openTarget('chat:s2');
    openTarget('note:b.ts');
    expect(primary().tabs).toEqual(['chat:s1', 'note:b.ts', 'chat:s2']);
  });

  it('保留（编辑/双击/拖动）后不再被替换，下一个文件另开预览', () => {
    openTarget('note:a.ts');
    state().keepTab('note:a.ts');
    openTarget('note:b.ts');
    expect(primary().tabs).toEqual(['note:a.ts', 'note:b.ts']);
    expect(primary().preview).toBe('note:b.ts');
  });

  it('再次单击已打开的常驻文件只聚焦，不降级为预览', () => {
    openTarget('note:a.ts');
    state().keepTab('note:a.ts');
    openTarget('note:b.ts');
    openTarget('note:a.ts');
    expect(primary().active).toBe('note:a.ts');
    expect(primary().preview).toBe('note:b.ts');
  });

  it('会话、终端、审阅始终常驻，也不会顶掉预览', () => {
    openTarget('note:a.ts');
    openTarget('chat:s1');
    openTarget('terminal:p');
    expect(primary().tabs).toEqual(['note:a.ts', 'chat:s1', 'terminal:p']);
    expect(primary().preview).toBe('note:a.ts');
  });

  it('拖动预览标签即保留', () => {
    openTarget('note:a.ts');
    state().moveTab('note:a.ts', 'primary', 'primary', 0);
    expect(primary().preview).toBeUndefined();
  });

  it('关闭预览标签后清掉预览标记', () => {
    openTarget('note:a.ts');
    state().closeTab('note:a.ts', 'primary');
    openTarget('chat:s1');
    openTarget('note:b.ts');
    expect(primary().tabs).toEqual(['chat:s1', 'note:b.ts']);
  });

  it('组里满 30 个标签时，预览替换仍然可用（不占新位置）', () => {
    for (let i = 0; i < 29; i += 1) openTarget(`chat:s${i}`);
    openTarget('note:a.ts');
    expect(primary().tabs).toHaveLength(30);
    openTarget('note:b.ts');
    expect(primary().tabs).toHaveLength(30);
    expect(primary().tabs).toContain('note:b.ts');
  });
});

describe('资料（通用）工作台：课件与文件都常驻', () => {
  beforeEach(() => setLayout(null));

  it('每打开一个都多一个标签，方便并排比对', () => {
    openTarget('preview:source:file:1');
    openTarget('preview:source:file:2');
    openTarget('note:x.md');
    expect(primary().tabs).toEqual(['preview:source:file:1', 'preview:source:file:2', 'note:x.md']);
    expect(primary().preview).toBeUndefined();
  });
});

describe('落点：普通打开进焦点组，已打开就聚焦', () => {
  beforeEach(() => setLayout(project));

  it('已在别的组打开的会话去那里聚焦，不在焦点组再开一份', () => {
    openTarget('chat:s1');
    state().splitGroup('primary', 'vertical', true);
    const right = state().focus;
    openTarget('note:a.ts');
    openTarget('chat:s1');
    expect(state().focus).toBe('primary');
    expect(findGroup(state().root, right)!.tabs).toEqual(['note:a.ts']);
  });
});

describe('aside：放到焦点组右侧', () => {
  beforeEach(() => setLayout(project));

  it('单组时向右分出空新组', () => {
    openTarget('chat:s1');
    openTarget('review:x', { aside: true });
    expect(groups()).toHaveLength(2);
    expect(groups()[1]!.tabs).toEqual(['review:x']);
    expect(state().focus).toBe(groups()[1]!.id);
  });

  it('焦点组右边已有组时进那个组，不再分屏；跟焦点走，不是固定进最右组', () => {
    openTarget('chat:s1');
    state().splitGroup('primary', 'vertical', true);
    openTarget('chat:s2');
    state().splitGroup(state().focus, 'vertical', true);
    openTarget('chat:s3');
    const [left, middle, right] = groups().map((group) => group.id);
    state().focusGroup(left!);
    openTarget('note:a.ts', { aside: true });
    expect(groups()).toHaveLength(3);
    expect(findGroup(state().root, middle!)!.tabs).toContain('note:a.ts');
    expect(findGroup(state().root, right!)!.tabs).toEqual(['chat:s3']);
  });

  it('焦点组是空组时直接落进去', () => {
    openTarget('review:x', { aside: true });
    expect(groups()).toHaveLength(1);
    expect(primary().tabs).toEqual(['review:x']);
  });

  it('已打开的会话/审阅只聚焦，不在旁边开第二份', () => {
    openTarget('review:x');
    openTarget('chat:s1');
    openTarget('review:x', { aside: true });
    expect(groups()).toHaveLength(1);
    expect(primary().active).toBe('review:x');
  });

  it('文件可以在旁边再开一份（对照同一文件的两处）', () => {
    openTarget('note:a.ts');
    state().keepTab('note:a.ts');
    openTarget('note:a.ts', { aside: true });
    expect(groups()).toHaveLength(2);
    expect(groups().every((group) => group.tabs.includes('note:a.ts'))).toBe(true);
  });
});
