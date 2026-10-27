// @vitest-environment jsdom
// 输入框上方的项目浮岛：项目与分支各一个可点胶囊，项目列表来自工作区，分支来自 main。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspaceEntry } from '../../../shared/api';
import { useWorkspaceStore } from '../../workspace/store';
import { ComposerContextBar } from './composer-context-bar';

let host: HTMLDivElement;
let root: Root;

const entry = (id: string, name: string, patch: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  id,
  parentId: null,
  name,
  kind: 'project',
  sourceId: null,
  path: `E:/repo/${name}`,
  updatedAt: '2026-10-09T00:00:00.000Z',
  ...patch,
});

const bar = (context: { projectId: string | null; name: string; remote: boolean }) =>
  root.render(<ComposerContextBar context={context} />);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useWorkspaceStore.setState({
    workspace: {
      entries: [
        entry('p1', 'Dela'),
        entry('p2', 'MAD-Producer'),
        entry('p3', 'ChangYo', { remoteId: 'r1' }),
      ],
      directory: 'E:/repo',
    },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('项目胶囊列出全部项目（含远端）', async () => {
  window.dela = {
    workspace: { projectBranch: async () => 'main' },
  } as unknown as DelaApi;
  await act(async () => bar({ projectId: 'p1', name: 'Dela', remote: false }));
  const pill = host.querySelector<HTMLButtonElement>('button[aria-label="切换项目"]')!;
  expect(pill.textContent).toContain('Dela');
  await act(async () => pill.click());
  const text = document.body.textContent!;
  expect(text).toContain('MAD-Producer');
  expect(text).toContain('ChangYo');
});

it('分支胶囊显示当前分支，选中另一个就切换', async () => {
  const projectBranches = vi.fn(async () => ['feat/x', 'main']);
  const switchProjectBranch = vi.fn(async () => {});
  window.dela = {
    workspace: { projectBranch: async () => 'main', projectBranches, switchProjectBranch },
  } as unknown as DelaApi;
  await act(async () => bar({ projectId: 'p1', name: 'Dela', remote: false }));
  await act(async () => {});
  const pill = host.querySelector<HTMLButtonElement>('button[aria-label="切换分支"]')!;
  expect(pill.textContent).toContain('main');
  await act(async () => pill.click());
  expect(projectBranches).toHaveBeenCalledWith('p1');
  const target = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'feat/x',
  )!;
  await act(async () => target.click());
  expect(switchProjectBranch).toHaveBeenCalledWith('p1', 'feat/x');
});

it('远端项目的仓库在另一台机器上，不显示分支胶囊', async () => {
  window.dela = {
    workspace: { projectBranch: async () => 'main' },
  } as unknown as DelaApi;
  await act(async () => bar({ projectId: 'p3', name: 'ChangYo', remote: true }));
  await act(async () => {});
  expect(host.querySelector('button[aria-label="切换分支"]')).toBeNull();
});
