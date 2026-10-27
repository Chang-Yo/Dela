// @vitest-environment jsdom
// 设置 › Skills 的上传入口：目标只列远端项目，冲突（远端已存在）转覆盖确认后用 overwrite 重试。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, SkillView, WorkspaceEntry, WorkspaceState } from '../../../../../shared/api';
import { useToastStore } from '../../../../app/toasts';
import { useWorkspaceStore } from '../../../../workspace/store';
import { SkillsTab } from './SkillsTab';

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
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useToastStore.setState({ toasts: [] });
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
  expect(buttonByText('上传').disabled).toBe(true);
});

it('uploads to the selected remote project', async () => {
  const call = vi.fn(async () => ({ path: '/root/proj/.dela/skills/lint', files: 3 }));
  await openDialog(call);
  await act(async () => buttonByText('远端课题').click());
  await act(async () => buttonByText('上传').click());
  expect(call).toHaveBeenCalledWith(skill.id, '/root/proj', false);
  expect(document.body.textContent).toContain('/root/proj/.dela/skills/lint');
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
  expect(call).toHaveBeenLastCalledWith(skill.id, '/root/proj', true);
  expect(document.body.textContent).toContain('/root/proj/.dela/skills/lint');
});

it('reports other errors as a toast', async () => {
  const call = vi.fn().mockRejectedValue(new Error('ssh 连接失败'));
  await openDialog(call);
  await act(async () => buttonByText('远端课题').click());
  await act(async () => buttonByText('上传').click());
  expect(useToastStore.getState().toasts[0]).toMatchObject({
    variant: 'error',
    description: 'ssh 连接失败',
  });
  expect(document.body.textContent).not.toContain('覆盖吗？');
});

it('requires dependency installation before enabling document reading', async () => {
  const missing: SkillView = {
    ...skill,
    name: 'document-reading',
    enabled: false,
    dependency: { status: 'missing' },
  };
  const ready: SkillView = { ...missing, enabled: true, dependency: { status: 'ready' } };
  const installSkillDependencies = vi.fn(async () => [ready]);
  window.dela = {
    capability: { listSkills: async () => [missing], installSkillDependencies },
  } as unknown as DelaApi;
  await act(async () => root.render(<SkillsTab />));
  expect(container.querySelector('[role="switch"]')).toBeNull();
  await act(async () => buttonByText('安装并启用').click());
  expect(installSkillDependencies).toHaveBeenCalledWith('document-reading');
  expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
});

it('keeps a failed dependency disabled and offers retry', async () => {
  const failed: SkillView = {
    ...skill,
    name: 'document-reading',
    enabled: false,
    dependency: { status: 'error', error: '下载失败' },
  };
  const installSkillDependencies = vi.fn().mockRejectedValue(new Error('下载失败'));
  window.dela = {
    capability: { listSkills: async () => [failed], installSkillDependencies },
  } as unknown as DelaApi;
  await act(async () => root.render(<SkillsTab />));
  await act(async () => buttonByText('重试安装').click());
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(buttonByText('重试安装').disabled).toBe(false);
});

it('cancels installation without presenting the user action as a failure', async () => {
  const missing: SkillView = {
    ...skill,
    name: 'document-reading',
    enabled: false,
    dependency: { status: 'missing' },
  };
  let rejectInstall: (error: Error) => void = () => {};
  const pending = new Promise<SkillView[]>((_resolve, reject) => {
    rejectInstall = reject;
  });
  const cancelSkillInstallation = vi.fn(async () => {
    rejectInstall(new Error('aborted'));
  });
  window.dela = {
    capability: {
      listSkills: async () => [missing],
      installSkillDependencies: () => pending,
      cancelSkillInstallation,
    },
  } as unknown as DelaApi;
  await act(async () => root.render(<SkillsTab />));
  await act(async () => buttonByText('安装并启用').click());
  await act(async () => buttonByText('取消安装').click());
  expect(cancelSkillInstallation).toHaveBeenCalledWith('document-reading');
  expect(useToastStore.getState().toasts).toHaveLength(0);
  expect(buttonByText('安装并启用')).toBeTruthy();
});

it('groups skills by where they come from and toggles them by id', async () => {
  const at = (path: string) => ({ id: path, path, description: '', enabled: true });
  const skills: SkillView[] = [
    { ...at('/home/u/.dela/skills/canvas/SKILL.md'), name: 'canvas', origin: 'builtin' },
    { ...at('/home/u/.agents/skills/notes/SKILL.md'), name: 'notes', origin: 'user' },
    {
      ...at('/data/pi/npm/node_modules/autoresearch/skills/search/SKILL.md'),
      name: 'search',
      origin: 'package',
      group: { id: 'pkg-1', label: 'autoresearch' },
      enabled: false,
      lockedReason: '所属包未启用',
    },
    {
      ...at('/work/alpha/.agents/skills/lint/SKILL.md'),
      name: 'lint',
      origin: 'project',
      group: { id: 'p-alpha', label: 'alpha' },
    },
    {
      ...at('/work/beta/.agent/skills/lint/SKILL.md'),
      name: 'lint',
      origin: 'project',
      group: { id: 'p-beta', label: 'beta' },
    },
  ];
  const setSkillEnabled = vi.fn(async (id: string, enabled: boolean) =>
    skills.map((item) => (item.id === id ? { ...item, enabled } : item)),
  );
  window.dela = {
    capability: { listSkills: async () => skills, setSkillEnabled },
  } as unknown as DelaApi;
  await act(async () => root.render(<SkillsTab />));

  const titles = [...container.querySelectorAll('section')].map(
    (section) => section.firstElementChild?.textContent ?? '',
  );
  expect(titles.map((title) => title.split(/随|~|Pi|项目里/)[0])).toEqual([
    'Dela 内置',
    '本机',
    'autoresearch',
    'alpha',
    'beta',
  ]);
  expect(container.textContent).toContain('所属包未启用');
  const switchFor = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].filter(
      (item) => item.getAttribute('aria-label') === label,
    );
  expect(switchFor('启用 search')[0]?.disabled).toBe(true);

  // 两个项目的 lint 同名：只动 beta 那一个。
  await act(async () => switchFor('启用 lint')[1]!.click());
  expect(setSkillEnabled).toHaveBeenCalledWith('/work/beta/.agent/skills/lint/SKILL.md', false);

  await act(async () => buttonByText('项目').click());
  expect(container.textContent).not.toContain('canvas');
  expect(container.textContent).toContain('alpha');
});
