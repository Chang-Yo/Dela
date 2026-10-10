import { beforeEach, describe, expect, it } from 'vitest';
import { unhideProjectInNav, useNavigationStore, useProjectNavPrefs } from './store';

describe('project session expansion', () => {
  beforeEach(() => useNavigationStore.setState({ openProjects: ['general'] }));

  it('opens a collapsed project and closes it on the next toggle', () => {
    useNavigationStore.getState().toggleProject('empty-project');
    expect(useNavigationStore.getState().openProjects).toEqual(['general', 'empty-project']);
    useNavigationStore.getState().toggleProject('empty-project');
    expect(useNavigationStore.getState().openProjects).toEqual(['general']);
  });

  it('honors explicit open and close without duplicating project ids', () => {
    useNavigationStore.getState().toggleProject('project', true);
    useNavigationStore.getState().toggleProject('project', true);
    expect(useNavigationStore.getState().openProjects).toEqual(['general', 'project']);
    useNavigationStore.getState().toggleProject('project', false);
    expect(useNavigationStore.getState().openProjects).toEqual(['general']);
  });
});

describe('project nav preferences', () => {
  beforeEach(() => useProjectNavPrefs.setState({ projects: {} }));

  it('drops the hidden preference when a project is registered again', () => {
    // 侧栏「移除项目入口」只是写下 hidden 偏好，条目还在：重新导入会把同一条加回来。
    useProjectNavPrefs.getState().setProject('p-1', { hidden: true });
    unhideProjectInNav('p-1');
    expect(useProjectNavPrefs.getState().projects['p-1']?.hidden).toBe(false);
  });

  it('leaves untouched projects alone instead of inventing preferences', () => {
    unhideProjectInNav('p-2');
    expect(useProjectNavPrefs.getState().projects).toEqual({});
  });
});
