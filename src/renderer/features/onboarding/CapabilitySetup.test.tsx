// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, SkillView } from '../../../shared/api';
import { CapabilitySetup } from './CapabilitySetup';

let host: HTMLDivElement;
let root: Root;
let skill: SkillView;
const api = {
  listSkills: vi.fn(),
  installSkillDependencies: vi.fn(),
  cancelSkillInstallation: vi.fn(),
  setSkillEnabled: vi.fn(),
  completeSetup: vi.fn(),
};
const done = vi.fn();
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)!;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  skill = {
    name: 'document-reading',
    description: '文档读取',
    enabled: false,
    path: '/skills/document-reading/SKILL.md',
    id: '/skills/document-reading/SKILL.md',
    origin: 'builtin',
    dependency: { status: 'missing' },
  };
  api.listSkills.mockImplementation(async () => [skill]);
  api.completeSetup.mockResolvedValue(undefined);
  window.dela = {
    capability: api,
    window: { minimize: vi.fn(), close: vi.fn() },
  } as unknown as DelaApi;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<CapabilitySetup onDone={done} />));

it('does not automatically install; allows completing with every component skipped', async () => {
  await render();
  expect(button('安装并启用')).toBeDefined();
  expect(api.installSkillDependencies).not.toHaveBeenCalled();
  await act(async () => button('完成配置').click());
  expect(api.completeSetup).toHaveBeenCalledOnce();
  expect(done).toHaveBeenCalledOnce();
});

it('installs and enables the component without finishing setup', async () => {
  api.installSkillDependencies.mockImplementation(async () => [
    { ...skill, enabled: true, dependency: { status: 'ready' } },
  ]);
  await render();
  const actionsBefore = host.querySelectorAll('button').length;
  await act(async () => button('安装并启用').click());
  expect(api.installSkillDependencies).toHaveBeenCalledWith('document-reading');
  // 就绪后动作按钮让位给状态标记，界面不能还停在「安装并启用」。
  expect(host.querySelectorAll('button')).toHaveLength(actionsBefore - 1);
  expect(done).not.toHaveBeenCalled();
});

it('enables an already installed component without downloading it again', async () => {
  skill.dependency = { status: 'ready' };
  api.setSkillEnabled.mockResolvedValue([{ ...skill, enabled: true }]);
  await render();
  await act(async () => button('启用').click());
  expect(api.setSkillEnabled).toHaveBeenCalledWith('/skills/document-reading/SKILL.md', true);
  expect(api.installSkillDependencies).not.toHaveBeenCalled();
});

it('shows download progress and cancels without surfacing an intentional cancellation as failure', async () => {
  let rejectInstall!: (error: Error) => void;
  api.installSkillDependencies.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectInstall = reject;
      }),
  );
  api.cancelSkillInstallation.mockImplementation(async () => {
    skill.dependency = { status: 'missing' };
    rejectInstall(new Error('cancelled'));
  });
  // 下载进度条只在拿到总量后出现（主进程从下载事件带回 received/total）。
  skill.dependency = { status: 'missing', total: 52428800 };
  await render();
  await act(async () => {
    button('安装并启用').click();
  });
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
  await act(async () => button('取消').click());
  expect(api.cancelSkillInstallation).toHaveBeenCalledWith('document-reading');
  // 用户主动取消不应被当成安装失败展示。
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(button('安装并启用')).toBeDefined();
});

it('keeps failed installs retryable and does not finish if the database marker cannot be saved', async () => {
  api.installSkillDependencies.mockImplementation(async () => {
    skill.dependency = { status: 'error', error: '下载失败' };
    throw new Error('下载失败');
  });
  await render();
  await act(async () => button('安装并启用').click());
  expect(host.textContent).toContain('下载失败');
  expect(button('重试')).toBeDefined();
  api.completeSetup.mockRejectedValueOnce(new Error('无法保存配置'));
  await act(async () => button('完成配置').click());
  expect(done).not.toHaveBeenCalled();
  expect(host.textContent).toContain('无法保存配置');
  await act(async () => button('完成配置').click());
  expect(done).toHaveBeenCalledOnce();
});

it('finishes while installation continues, without cancelling the background install', async () => {
  let resolveInstall!: (skills: SkillView[]) => void;
  api.installSkillDependencies.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveInstall = resolve;
      }),
  );
  await render();
  await act(async () => {
    button('安装并启用').click();
  });
  await act(async () => button('完成配置').click());
  expect(done).toHaveBeenCalledOnce();
  expect(api.cancelSkillInstallation).not.toHaveBeenCalled();
  await act(async () =>
    resolveInstall([{ ...skill, enabled: true, dependency: { status: 'ready' } }]),
  );
});
