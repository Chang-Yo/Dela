// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../preload/api';
import type { WorkspaceEntry } from '../../../../modules/workspace/contract';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好；会话镜像也在加载时订阅推送。
const { api, desktop } = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => unknown> = {};
  const subscribe = () => () => {};
  const desktop = {
    bridge: {
      invoke: async (channel: string, input: never) =>
        handlers[channel.slice('workspace:'.length)]!(input),
      subscribe,
    },
  } as unknown as DelaApi;
  window.dela = desktop;
  return { api: handlers, desktop };
});
import { EntryDialogs } from '../entry-dialogs';
import { useWorkspaceStore } from '../../../../modules/workspace/view';

function entry(
  id: string,
  kind: WorkspaceEntry['kind'],
  parentId: string | null = null,
): WorkspaceEntry {
  return { id, name: id, kind, parentId, sourceId: null, updatedAt: '2026-10-19' };
}

const workspace = {
  directory: '/tmp/dela',
  entries: [
    entry('课程项目', 'project'),
    entry('子文件夹', 'folder', '课程项目'),
    entry('附件目录', 'folder', '子文件夹'),
    entry('嵌套项目', 'project', '子文件夹'),
    entry('嵌套笔记', 'file', '嵌套项目'),
    entry('第二项目', 'project'),
    entry('隐藏项目', 'project'),
    { ...entry('远程项目', 'project'), remoteId: 'ssh-1' },
    entry('普通文件夹', 'folder'),
  ],
};
let root: Root;
let container: HTMLDivElement;
const create = vi.fn(async (input) => ({ ...entry('created', input.kind), ...input }));
const state = vi.fn(async () => workspace);

Object.assign(api, { create, state });
const scrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useWorkspaceStore.setState({ workspace, loaded: true, error: null });
  window.dela = desktop;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.unstubAllGlobals();
});

async function render(initialTarget?: string) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <EntryDialogs
          request={{ action: 'link', id: 'source:file:123', initialTarget }}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
}

async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

it.each([
  ['附件目录', '课程项目'],
  ['嵌套笔记', '嵌套项目'],
  ['第二项目', '第二项目'],
])('links from %s to its nearest project root %s', async (initialTarget, parentId) => {
  await render(initialTarget);
  expect(document.querySelector('[role="combobox"]')?.textContent).toBe(parentId);
  await submit();
  expect(create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      kind: 'source',
      parentId,
      sourceId: 'file:123',
    }),
  );
});

it.each([undefined, '普通文件夹', 'missing', '远程项目'])(
  'requires a project choice for initial target %s',
  async (initialTarget) => {
    await render(initialTarget);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await submit();
    expect(create).not.toHaveBeenCalled();
  },
);

it('clears an unavailable project target instead of silently using the workspace root', async () => {
  await render('课程项目');
  // 目标项目从镜像里消失（如刚被移除）时清空选择，不静默落到工作区根。
  await act(async () =>
    useWorkspaceStore.setState({
      workspace: {
        ...workspace,
        entries: workspace.entries.filter((item) => item.id !== '课程项目'),
      },
    }),
  );
  await submit();
  expect(create).not.toHaveBeenCalled();
});
