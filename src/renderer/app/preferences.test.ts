// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

async function loadPreferences() {
  vi.resetModules();
  return (await import('./preferences')).usePreferences;
}

beforeEach(() => localStorage.clear());

it('旧键的值并入新 store，之后旧键被删', async () => {
  localStorage.setItem('dela.shell.sidebar-collapsed', 'true');
  localStorage.setItem('dela.project.open-target', 'explorer');
  localStorage.setItem('dela.mail.folders-collapsed', 'false');
  localStorage.setItem('dela.todo.show-completed', 'false');
  localStorage.setItem('dela.classroom.sidebarWidth', '280');
  localStorage.setItem('dela.classroom.sidebarCollapsed', '1');
  localStorage.setItem('dela.workspace.sidebarWidth', '220');
  localStorage.setItem('dela.workspace.collapsed', 'true');
  localStorage.setItem('dela.nav-entries', '{"state":{"hidden":["mail"]},"version":0}');
  localStorage.setItem('dela.project-nav', '{"state":{"projects":{"p1":{"pinned":true}}}}');
  localStorage.setItem('dela.remote.lastDirectory', '{"gpu-box":"/home/me"}');

  const state = (await loadPreferences()).getState();

  expect(state).toMatchObject({
    shellSidebarCollapsed: true,
    projectOpenTarget: 'explorer',
    mailFoldersCollapsed: false,
    workspaceSidebarWidth: 220,
    workspaceSidebarCollapsed: true,
    hiddenNavEntries: ['mail'],
    projectNav: { p1: { pinned: true } },
    remoteLastDirectory: { 'gpu-box': '/home/me' },
  });
  expect(Object.keys(localStorage)).toEqual(['dela.preferences']);
});

it('旧值不合法时取默认值', async () => {
  localStorage.setItem('dela.workspace.sidebarWidth', 'abc');
  localStorage.setItem('dela.nav-entries', 'not json');
  localStorage.setItem('dela.remote.lastDirectory', '[1]');

  expect((await loadPreferences()).getState()).toMatchObject({
    workspaceSidebarWidth: 300,
    hiddenNavEntries: [],
    remoteLastDirectory: {},
  });
});

it('新键已存在时不再读旧键', async () => {
  localStorage.setItem('dela.preferences', '{"state":{"mailFoldersCollapsed":true},"version":1}');
  localStorage.setItem('dela.mail.folders-collapsed', 'false');

  const state = (await loadPreferences()).getState();

  expect(state.mailFoldersCollapsed).toBe(true);
  expect(localStorage.getItem('dela.mail.folders-collapsed')).toBe('false');
});
