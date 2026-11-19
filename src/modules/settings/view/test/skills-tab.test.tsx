// @vitest-environment jsdom
// 设置 › Skills 的上传入口：目标只列远端项目，冲突（远端已存在）转覆盖确认后用 overwrite 重试。
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceEntry, WorkspaceState } from '../../../workspace/contract';

// 契约客户端在模块加载时取 bridge，须先于导入装好；用例经 stubCapabilities 登记 handler。
const { api, bridge } = vi.hoisted(() => {
  const api: Record<string, (input: never) => unknown> = {};
  const bridge = {
    invoke: async (channel: string, input: never) => api[channel]!(input),
    subscribe: () => () => {},
  };
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
  return { api, bridge };
});
import { dismissToast, toasts } from '../../../../ui/toast';
import { useWorkspaceStore } from '../../../workspace/view';
import { SkillsTab } from '../agent/SkillsTab';

let container: HTMLDivElement;
let root: Root;

const skill = {
  name: 'lint',
  description: '代码检查',
  enabled: true,
  path: '/home/u/.dela/skills/lint/SKILL.md',
  id: '/home/u/.dela/skills/lint/SKILL.md',
  origin: 'user' as const,
};

const remoteProject: WorkspaceEntry = {
  id: 'p-r',
  parentId: null,
  name: '远端课题',
  kind: 'project',
  sourceId: null,
  path: '/root/proj',
  remoteId: 'r-1',
  updatedAt: '2026-10-08T00:00:00.000Z',
};

const localProject: WorkspaceEntry = {
  ...remoteProject,
  id: 'p-l',
  name: '本地项目',
  remoteId: null,
};

const state = (entries: WorkspaceEntry[]): WorkspaceState => ({
  entries,
  directory: '/tmp/dela',
});

function buttonByText(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const channel of Object.keys(api)) delete api[channel];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const toast of toasts()) dismissToast(toast.id);
  delete window.dela;
  vi.unstubAllGlobals();
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function renderTab() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <SkillsTab />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

function stubCapabilities(handlers: Record<string, (input: never) => unknown>) {
  for (const [name, handler] of Object.entries(handlers)) api[`capabilities:${name}`] = handler;
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
}

async function openDialog(
  uploadSkillToRemote: (input: {
    id: string;
    remotePath: string;
    overwrite: boolean;
  }) => Promise<unknown>,
) {
  useWorkspaceStore.setState({ workspace: state([remoteProject, localProject]), loaded: true });
  stubCapabilities({ listSkills: async () => [skill], uploadSkillToRemote });
  await renderTab();
  const open = container.querySelector<HTMLButtonElement>('[aria-label="上传 lint 到远端项目"]')!;
  await act(async () => open.click());
}

it('asks for overwrite when the remote skill exists', async () => {
  const call = vi
    .fn()
    .mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'capabilities:upload-skill-to-remote': Error: 远端已存在：/root/proj/.agents/skills/lint",
      ),
    )
    .mockResolvedValueOnce({ path: '/root/proj/.agents/skills/lint', files: 2 });
  await openDialog(call);
  await act(async () => buttonByText('远端课题').click());
  await act(async () => buttonByText('上传').click());
  expect(document.body.textContent).toContain('远端已有同名技能，覆盖吗？');
  await act(async () => buttonByText('覆盖').click());
  expect(call).toHaveBeenLastCalledWith({
    id: skill.id,
    remotePath: '/root/proj',
    overwrite: true,
  });
  expect(document.body.textContent).toContain('/root/proj/.agents/skills/lint');
});
