// @vitest-environment jsdom
// 设置 › 工作区：隐藏项目在独立分组列出，可恢复导航入口。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProjectNavPrefs } from '../../../navigation/store';
import { useWorkspaceStore } from '../../../workspace/store';
import { WorkspaceSection } from './WorkspaceSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  useProjectNavPrefs.setState({ projects: {} });
  useWorkspaceStore.setState({ workspace: { entries: [], views: {}, directory: '' } });
  vi.unstubAllGlobals();
});

it('lists hidden projects in their own group and restores the nav entry', async () => {
  useWorkspaceStore.setState({
    workspace: {
      entries: [
        {
          id: 'p-1',
          parentId: null,
          name: 'ChangYo',
          kind: 'project',
          sourceId: null,
          path: 'D:/code/ChangYo',
          updatedAt: '2026-10-08T00:00:00.000Z',
        },
        {
          id: 'p-2',
          parentId: null,
          name: 'lab',
          kind: 'project',
          sourceId: null,
          path: '/root/lab',
          remoteId: 'r-1',
          updatedAt: '2026-10-08T00:00:00.000Z',
        },
      ],
      views: {},
      directory: '/tmp/dela',
    },
  });
  useProjectNavPrefs.setState({
    projects: { 'p-1': { hidden: true }, 'p-2': { hidden: true } },
  });

  await act(async () => root.render(<WorkspaceSection />));
  const group = container.querySelector('[data-setting-id="hidden-projects"]')!;
  expect(group.textContent).toContain('ChangYo');
  expect(group.textContent).toContain('D:/code/ChangYo');
  expect(group.textContent).toContain('/root/lab');
  // 远程行带云朵标记，本地行不带。
  expect(group.querySelectorAll('svg.lucide-cloud')).toHaveLength(1);

  const restore = [...group.querySelectorAll('button')].find(
    (item) => item.textContent === '恢复入口',
  )!;
  await act(async () => restore.click());
  expect(useProjectNavPrefs.getState().projects['p-1']?.hidden).toBe(false);
});
