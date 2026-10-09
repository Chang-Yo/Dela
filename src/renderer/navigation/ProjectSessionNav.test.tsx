// @vitest-environment jsdom
// 侧栏高亮层级：会话行已可见地高亮时，项目行不再叠加底色；会话行看不见时
// （项目折叠、会话藏在「显示更多」后、焦点不在任何会话上），项目行仍标明当前项目。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceEntry, WorkspaceState } from '../../shared/api';
import { ProjectSessionNav, type NavSessionSummary } from './ProjectSessionNav';
import { useNavigationStore } from './store';
import { useWorkspaceStore } from '../workspace/store';

const project: WorkspaceEntry = {
  id: 'p-test',
  parentId: null,
  name: 'Test',
  kind: 'project',
  sourceId: null,
  path: 'D:/test',
  updatedAt: '2026-01-03T00:00:00.000Z',
};

const recent: NavSessionSummary[] = [
  { id: 's-1', title: 'kankan?', updatedAt: '2026-01-02T00:00:00.000Z' },
  { id: 's-2', title: '针对这个授权的JS脚本', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 's-3', title: '第三个对话', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 's-4', title: '第四个对话', updatedAt: '2026-01-01T00:00:00.000Z' },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useWorkspaceStore.setState({
    workspace: { entries: [project], views: {}, directory: '/tmp/dela' } as WorkspaceState,
    loaded: true,
    error: null,
  });
  useNavigationStore.setState({ openProjects: ['general', project.id] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(activeSessionId: string | null, sessions = recent) {
  await act(async () =>
    root.render(
      <ProjectSessionNav
        activeProjectId={project.id}
        activeSessionId={activeSessionId}
        onNewProject={() => {}}
        onOpenGeneralChat={() => {}}
        onOpenProject={() => {}}
        onOpenSession={() => {}}
        runBadge={() => null}
        sessionsByProject={{ [project.id]: sessions }}
      />,
    ),
  );
}

/** 行元素即按钮的父节点（项目行/会话行共用 nav-styles 的底色）。 */
function row(button: HTMLButtonElement): HTMLElement {
  if (!button.parentElement) throw new Error('row missing');
  return button.parentElement;
}

function projectRow(): HTMLElement {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.title === project.name,
  );
  if (!button) throw new Error('project row missing');
  return row(button);
}

function sessionRow(title: string): HTMLElement {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === title,
  );
  if (!button) throw new Error(`session row missing: ${title}`);
  return row(button);
}

const highlighted = (element: HTMLElement) => element.className.includes('bg-hover-2');

it('hides the project background while a listed session is highlighted', async () => {
  await render('s-1');
  expect(highlighted(sessionRow('kankan?'))).toBe(true);
  expect(highlighted(projectRow())).toBe(false);
});

it('keeps the project background while the project is collapsed', async () => {
  useNavigationStore.setState({ openProjects: ['general'] });
  await render('s-1');
  expect(highlighted(projectRow())).toBe(true);
});

it('keeps the project background when no session is highlighted', async () => {
  await render(null);
  expect(highlighted(projectRow())).toBe(true);
});

it('keeps the project background when the highlighted session is behind 显示更多', async () => {
  await render('s-4');
  expect(document.body.textContent).toContain('显示更多');
  expect(highlighted(projectRow())).toBe(true);
});

it('hides the project background while a pinned session is highlighted in 置顶', async () => {
  await render('s-1', [{ ...recent[0]!, pinned: true }, ...recent.slice(1)]);
  expect(highlighted(sessionRow('kankan?'))).toBe(true);
  expect(highlighted(projectRow())).toBe(false);
});
