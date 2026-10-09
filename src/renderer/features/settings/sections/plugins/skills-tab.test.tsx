// @vitest-environment jsdom
// 设置 › Skills 的上传入口：目标只列远端项目，冲突（远端已存在）转覆盖确认后用 overwrite 重试。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WorkspaceEntry, WorkspaceState } from '../../../../../shared/api';
import { useWorkspaceStore } from '../../../../workspace/store';
import { SkillsTab } from './SkillsTab';

let container: HTMLDivElement;
let root: Root;

const skill = {
  name: 'lint',
  description: '代码检查',
  enabled: true,
  path: '/home/u/.dela/skills/lint/SKILL.md',
  scope: 'global' as const,
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
  views: {},
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
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

async function openDialog(
  uploadSkillToRemote: (n: string, p: string, o: boolean) => Promise<unknown>,
) {
  useWorkspaceStore.setState({ workspace: state([remoteProject, localProject]), loaded: true });
  window.dela = {
    capability: { listSkills: async () => [skill], uploadSkillToRemote },
  } as unknown as DelaApi;
  await act(async () => root.render(<SkillsTab />));
  const open = container.querySelector<HTMLButtonElement>('[aria-label="上传 lint 到远端项目"]')!;
  expect(open.getAttribute('title')).toBe('上传到远端项目');
  await act(async () => open.click());
}

it('empty state without remote projects', async () => {
  useWorkspaceStore.setState({ workspace: state([localProject]), loaded: true });
  window.dela = {
    capability: { listSkills: async () => [skill], uploadSkillToRemote: vi.fn() },
  } as unknown as DelaApi;
  await act(async () => root.render(<SkillsTab />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="上传 lint 到远端项目"]')!.click(),
  );
  expect(document.body.textContent).toContain('还没有远端项目。');
  expect(buttonByText('上传').disabled).toBe(true);
});

it('uploads to the selected remote project', async () => {
  const call = vi.fn(async () => ({ path: '/root/proj/.dela/skills/lint', files: 3 }));
  await openDialog(call);
  expect(document.body.textContent).toContain('上传到远端项目');
  expect(document.body.textContent).toContain(
    '把技能 lint 的目录（含附属文件）上传到远端项目的 .dela/skills/lint/，远端会话即可使用。',
  );
  await act(async () => buttonByText('远端课题').click());
  await act(async () => buttonByText('上传').click());
  expect(call).toHaveBeenCalledWith('lint', '/root/proj', false);
  expect(document.body.textContent).toContain('已上传 3 个文件到 /root/proj/.dela/skills/lint');
});

it('asks for overwrite when the remote skill exists', async () => {
  const call = vi
    .fn()
    .mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'capabilities:upload-skill-to-remote': Error: 远端已存在：/root/proj/.dela/skills/lint",
      ),
    )
    .mockResolvedValueOnce({ path: '/root/proj/.dela/skills/lint', files: 2 });
  await openDialog(call);
  await act(async () => buttonByText('远端课题').click());
  await act(async () => buttonByText('上传').click());
  expect(document.body.textContent).toContain('远端已有同名技能，覆盖吗？');
  await act(async () => buttonByText('覆盖').click());
  expect(call).toHaveBeenLastCalledWith('lint', '/root/proj', true);
  expect(document.body.textContent).toContain('已上传 2 个文件到 /root/proj/.dela/skills/lint');
});

it('shows other errors directly', async () => {
  const call = vi.fn().mockRejectedValue(new Error('ssh 连接失败'));
  await openDialog(call);
  await act(async () => buttonByText('远端课题').click());
  await act(async () => buttonByText('上传').click());
  expect(document.body.textContent).toContain('ssh 连接失败');
  expect(document.body.textContent).not.toContain('覆盖吗？');
});
