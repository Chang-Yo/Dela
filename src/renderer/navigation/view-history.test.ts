// @vitest-environment jsdom
// 历史栈记「视图 + 项目」：从项目面板离开后，后退必须回到同一个项目面板（只记视图会退成通用池）。
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceEntry, WorkspaceState } from '../../shared/api';
import { useWorkspaceStore } from '../workspace/store';
import { useNavigationStore } from './view';

const project: WorkspaceEntry = {
  id: 'p1',
  parentId: null,
  name: 'ChangYo',
  kind: 'project',
  sourceId: null,
  path: 'D:/code/ChangYo',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const workspace: WorkspaceState = { entries: [project], directory: 'D:/code' };

function seed(view: 'home' | 'workbench' | 'mail', projectId: string | null): void {
  useNavigationStore.setState({ view, projectId, backStack: [], forwardStack: [] });
  localStorage.clear();
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspace, loaded: true, error: null });
});

describe('导航历史', () => {
  it('离开项目工作台后，后退回到同一项目', () => {
    seed('workbench', 'p1');
    useNavigationStore.getState().navigate('home');
    expect(useNavigationStore.getState()).toMatchObject({ view: 'home', projectId: null });

    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: 'p1' });
    expect(localStorage.getItem('dela.workspace.project')).toBe('p1');
  });

  it('同视图切到通用池（资料）也记历史', () => {
    seed('workbench', 'p1');
    useNavigationStore.getState().openProject('');
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: null });

    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({ view: 'workbench', projectId: 'p1' });
  });

  it('前进回到离开后的视图，项目随之恢复', () => {
    seed('workbench', 'p1');
    useNavigationStore.getState().navigate('mail');
    useNavigationStore.getState().goBack();
    useNavigationStore.getState().goForward();
    expect(useNavigationStore.getState()).toMatchObject({ view: 'mail', projectId: 'p1' });
  });

  it('当前项目已删除时换池不记历史', () => {
    seed('workbench', 'p1');
    useWorkspaceStore.setState({ workspace: { ...workspace, entries: [] }, loaded: true });
    useNavigationStore.getState().openProject('');
    expect(useNavigationStore.getState().backStack).toEqual([]);
    expect(useNavigationStore.getState().projectId).toBeNull();
  });
});
