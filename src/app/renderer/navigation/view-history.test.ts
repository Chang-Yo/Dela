// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceEntry, WorkspaceState } from '../../../modules/workspace/contract';
import { useWorkspaceStore } from '../../../modules/workspace/view';
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

function seed(view: 'home' | 'workbench' | 'settings', projectId: string | null): void {
  useNavigationStore.setState({ view, target: null, projectId, backStack: [], forwardStack: [] });
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
    useNavigationStore.getState().navigate('settings');
    useNavigationStore.getState().goBack();
    useNavigationStore.getState().goForward();
    expect(useNavigationStore.getState()).toMatchObject({ view: 'settings', projectId: 'p1' });
  });

  it('后退回到模块页面时带回离开时的跳转参数', () => {
    seed('home', null);
    useNavigationStore.getState().navigate({ page: 'todo', todoId: 't1' });
    useNavigationStore.getState().navigate('settings');
    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({
      view: 'todo',
      target: { page: 'todo', todoId: 't1' },
    });
  });

  it('当前项目已删除时换池不记历史', () => {
    seed('workbench', 'p1');
    useWorkspaceStore.setState({ workspace: { ...workspace, entries: [] }, loaded: true });
    useNavigationStore.getState().openProject('');
    expect(useNavigationStore.getState().backStack).toEqual([]);
    expect(useNavigationStore.getState().projectId).toBeNull();
  });
});
