import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchLayout } from '../../../shared/layout';
import { findGroup, walkGroups } from '../layout-schema';
import { useWorkbenchLayout } from '../layout-store';
import { openTabAside, prepareAsideGroup } from '../open-aside';

const uuid = '00000000-0000-4000-8000-000000000002';

function installLayoutApi(get: (projectId: string | null) => WorkbenchLayout | null) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: {
        layout: { get: vi.fn(async (p: string | null) => get(p)), save: vi.fn(async () => {}) },
      },
    },
  });
}

function resetStore() {
  useWorkbenchLayout.setState({
    projectId: null,
    root: { type: 'group', id: 'primary', tabs: [], active: null },
    focus: 'primary',
    maximized: null,
    ready: false,
  });
}

const state = () => useWorkbenchLayout.getState();
const groups = () => walkGroups(state().root);

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  vi.runAllTimers();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('openTabAside', () => {
  it('单组时向右分出空新组，标签落进新组', async () => {
    installLayoutApi(() => ({
      root: { type: 'group', id: 'primary', tabs: ['chat:a'], active: 'chat:a' },
      focus: 'primary',
      maximized: null,
    }));
    await state().init(uuid);
    openTabAside('preview:E:\\dir\\file.py');
    expect(groups()).toHaveLength(2);
    const target = groups()[1]!;
    expect(target.tabs).toEqual(['preview:E:\\dir\\file.py']);
    expect(state().focus).toBe(target.id);
  });

  it('多组时进最右组，不新开分屏', async () => {
    installLayoutApi(() => ({
      root: {
        type: 'split',
        orientation: 'vertical',
        ratio: 0.5,
        children: [
          { type: 'group', id: 'left', tabs: ['chat:a'], active: 'chat:a' },
          { type: 'group', id: 'right', tabs: ['note:b'], active: 'note:b' },
        ],
      },
      focus: 'left',
      maximized: null,
    }));
    await state().init(uuid);
    openTabAside(
      'review:00000000-0000-4000-8000-00000000000a:00000000-0000-4000-8000-00000000000b:src/a.ts',
    );
    expect(groups()).toHaveLength(2);
    expect(findGroup(state().root, 'right')!.tabs).toContain(
      'review:00000000-0000-4000-8000-00000000000a:00000000-0000-4000-8000-00000000000b:src/a.ts',
    );
    expect(state().focus).toBe('right');
  });

  it('布局未就绪时退化为普通打开', () => {
    useWorkbenchLayout.setState({ ready: false });
    openTabAside('preview:x');
    expect(findGroup(state().root, 'primary')!.tabs).toEqual(['preview:x']);
  });
});

describe('prepareAsideGroup', () => {
  it('单组分出空新组并聚焦，不代开标签（开标签归调用方的机制）', async () => {
    installLayoutApi(() => ({
      root: { type: 'group', id: 'primary', tabs: ['chat:a'], active: 'chat:a' },
      focus: 'primary',
      maximized: null,
    }));
    await state().init(uuid);
    prepareAsideGroup();
    expect(groups()).toHaveLength(2);
    expect(groups()[1]!.tabs).toEqual([]);
    expect(state().focus).toBe(groups()[1]!.id);
  });
});
