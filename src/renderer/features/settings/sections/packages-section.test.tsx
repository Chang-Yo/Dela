// @vitest-environment jsdom
// 设置 › Pi Packages：总开关关闭时不列包；安装要先勾选风险告知；装好的包按列表展示来源、
// 资源数与诊断，启停与按类开关原样交给主进程，失败走 toast。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, PackageSettings, PiPackageView } from '../../../../shared/api';
import { useToastStore } from '../../../app/toasts';
import { PackagesSection } from './PackagesSection';

let container: HTMLDivElement;
let root: Root;

const ready: PackageSettings = {
  enabled: true,
  registry: 'npmjs',
  runtime: { status: 'ready', npm: 'npm', version: '11.6.0', origin: 'system' },
};

const view: PiPackageView = {
  id: '00000000-0000-4000-8000-000000000001',
  source: 'npm:pi-demo@1.0.0',
  type: 'npm',
  name: 'pi-demo',
  version: '1.0.0',
  description: 'Demo package',
  installedPath: '/data/pi/npm/node_modules/pi-demo',
  enabled: false,
  resources: { extensions: true, skills: true, prompts: true },
  counts: { extensions: 1, skills: 2, prompts: 0, themes: 1 },
  provides: {
    skills: [
      { name: 'research', description: '', path: '/p/skills/research/SKILL.md' },
      { name: 'cite', description: '', path: '/p/skills/cite/SKILL.md' },
    ],
    prompts: [],
    commands: [],
    tools: [],
    mcpServers: [],
    extensionsInspected: false,
  },
  disabledPrompts: [],
  installedAt: '2026-10-23T00:00:00.000Z',
  diagnostics: ['extensions/index.ts：Cannot find module foo'],
};

function api(settings: PackageSettings, overrides: Partial<DelaApi['packages']> = {}) {
  const packages = {
    settings: vi.fn(async () => settings),
    onSettingsChanged: () => () => {},
    list: vi.fn(async () => [view]),
    enable: vi.fn(async () => ready),
    disable: vi.fn(async () => ({ ...ready, enabled: false })),
    install: vi.fn(async () => [view]),
    setEnabled: vi.fn(async (_id: string, enabled: boolean) => [{ ...view, enabled }]),
    setResources: vi.fn(async () => [view]),
    onProgress: () => () => {},
    pickLocal: vi.fn(async () => null),
    ...overrides,
  };
  window.dela = { packages } as unknown as DelaApi;
  return packages;
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const byLabel = <T extends HTMLElement>(label: string) =>
  document.querySelector<T>(`[aria-label="${label}"]`)!;
function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}
function setValue(target: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value);
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

it('stays closed until the master switch is turned on, then lists packages', async () => {
  const packages = api({ enabled: false, registry: 'npmjs', runtime: { status: 'disabled' } });
  await act(async () => root.render(<PackagesSection />));
  await flush();
  expect(packages.list).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('安装包');

  await act(async () => byLabel<HTMLButtonElement>('启用 Pi Packages').click());
  await flush();
  expect(packages.enable).toHaveBeenCalled();
  expect(packages.list).toHaveBeenCalled();
  expect(document.body.textContent).toContain('npm 11.6.0（本机）');
});

it('shows source, resource counts and load diagnostics; themes are marked as not applicable', async () => {
  api(ready);
  await act(async () => root.render(<PackagesSection />));
  await flush();
  const text = document.body.textContent ?? '';
  expect(text).toContain('npm:pi-demo@1.0.0');
  expect(text).toContain('扩展 1');
  expect(text).toContain('Skills 2');
  expect(text).not.toContain('提示模板 0');
  expect(text).toContain('主题 1（不适用）');
  // 装进来的东西去了哪儿：Skill 名字直接列出，扩展未启用时说明启用后可见。
  expect(text).toContain('research · cite');
  expect(text).toContain('启用后显示它注册的命令、工具与 MCP 服务器');
  expect(text).toContain('Cannot find module foo');
});

it('requires the risk acknowledgement before installing', async () => {
  const packages = api(ready);
  await act(async () => root.render(<PackagesSection />));
  await flush();
  await act(async () => button('安装包').click());
  await act(async () => setValue(byLabel<HTMLInputElement>('包来源'), 'npm:pi-demo@1.0.0'));
  expect(button('安装').disabled).toBe(true);

  const consent = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (input) => input.closest('label')?.textContent?.includes('信任这个来源'),
  )!;
  await act(async () => consent.click());
  await act(async () => button('安装').click());
  await flush();
  expect(packages.install).toHaveBeenCalledWith('npm:pi-demo@1.0.0');
  expect(document.querySelector('[aria-label="包来源"]')).toBeNull();
});

it('keeps the install dialog open with the reason when installing fails', async () => {
  api(ready, { install: vi.fn(async () => Promise.reject(new Error('npm ERR! 404'))) });
  await act(async () => root.render(<PackagesSection />));
  await flush();
  await act(async () => button('安装包').click());
  await act(async () => setValue(byLabel<HTMLInputElement>('包来源'), 'npm:nope'));
  const consent = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(
    -1,
  )!;
  await act(async () => consent.click());
  await act(async () => button('安装').click());
  await flush();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('npm ERR! 404');
  expect(byLabel('包来源')).not.toBeNull();
});

it('toggles a package and a resource kind through the main process', async () => {
  const packages = api(ready);
  await act(async () => root.render(<PackagesSection />));
  await flush();
  await act(async () => byLabel<HTMLButtonElement>('启用 pi-demo').click());
  await flush();
  expect(packages.setEnabled).toHaveBeenCalledWith(view.id, true);

  const skills = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (input) => input.closest('label')?.textContent?.startsWith('Skills'),
  )!;
  await act(async () => skills.click());
  await flush();
  expect(packages.setResources).toHaveBeenCalledWith(view.id, {
    extensions: true,
    skills: false,
    prompts: true,
  });
});

it('reports a failed toggle as a toast', async () => {
  api(ready, { setEnabled: vi.fn(async () => Promise.reject(new Error('包不存在'))) });
  await act(async () => root.render(<PackagesSection />));
  await flush();
  await act(async () => byLabel<HTMLButtonElement>('启用 pi-demo').click());
  await flush();
  expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
    variant: 'error',
    description: expect.stringContaining('包不存在'),
  });
});
