import { beforeEach, describe, expect, it } from 'vitest';
import { useNavigationStore } from './store';

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
