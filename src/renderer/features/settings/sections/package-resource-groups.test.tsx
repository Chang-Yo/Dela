// @vitest-environment jsdom
// 设置页各分区里「来自 Pi Packages」的组：自定义指令列包的 prompt 模板（可逐个开关）与扩展命令（只读），
// MCP Server 列包注册的服务器；总开关关闭时整组不出现；包未启用时模板开关只读。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, PiPackageView } from '../../../../shared/api';
import { PackageCommandGroups, PackageMcpGroups } from './PackageResourceGroups';

let container: HTMLDivElement;
let root: Root;

const pkg: PiPackageView = {
  id: '00000000-0000-4000-8000-000000000001',
  source: 'npm:autoresearch@1.0.0',
  type: 'npm',
  name: 'autoresearch',
  version: '1.0.0',
  description: null,
  installedPath: '/data/pi/npm/node_modules/autoresearch',
  enabled: true,
  resources: { extensions: true, skills: true, prompts: true },
  counts: { extensions: 1, skills: 3, prompts: 1, themes: 0 },
  provides: {
    skills: [],
    prompts: [{ name: 'research', description: 'Research a topic', argumentHint: '<topic>' }],
    commands: [{ name: 'research-status', description: 'Show research jobs' }],
    tools: ['web_research'],
    mcpServers: [{ name: 'scholar', detail: 'npx scholar-mcp' }],
    extensionsInspected: true,
  },
  disabledPrompts: [],
  installedAt: '2026-10-23T00:00:00.000Z',
  diagnostics: [],
};

function api(enabled: boolean, list: PiPackageView[]) {
  const packages = {
    settings: vi.fn(async () => ({ enabled, registry: 'npmjs', runtime: { status: 'disabled' } })),
    list: vi.fn(async () => list),
    setPromptEnabled: vi.fn(async (name: string, on: boolean) =>
      list.map((item) => ({ ...item, disabledPrompts: on ? [] : [name] })),
    ),
  };
  window.dela = { packages } as unknown as DelaApi;
  return packages;
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

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

it('lists package prompt templates with a switch and extension commands read-only', async () => {
  const packages = api(true, [pkg]);
  await act(async () => root.render(<PackageCommandGroups />));
  await flush();
  expect(container.textContent).toContain('autoresearch');
  expect(container.textContent).toContain('/research<topic>');
  expect(container.textContent).toContain('/research-status');
  expect(container.textContent).toContain('扩展命令 · Show research jobs');
  const switches = container.querySelectorAll<HTMLButtonElement>('[role="switch"]');
  expect(switches).toHaveLength(1);

  await act(async () => switches[0]!.click());
  await flush();
  expect(packages.setPromptEnabled).toHaveBeenCalledWith('research', false);
  expect(switches[0]!.getAttribute('aria-checked')).toBe('false');
});

it('keeps template switches read-only while the package is disabled', async () => {
  api(true, [{ ...pkg, enabled: false }]);
  await act(async () => root.render(<PackageCommandGroups />));
  await flush();
  expect(container.textContent).toContain('Pi Package · 未启用');
  expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
});

it('lists package MCP servers', async () => {
  api(true, [pkg]);
  await act(async () => root.render(<PackageMcpGroups />));
  await flush();
  expect(container.textContent).toContain('scholar');
  expect(container.textContent).toContain('npx scholar-mcp');
  expect(container.textContent).toContain('打开会话时连接');
});

it('shows nothing while Pi Packages is switched off', async () => {
  const packages = api(false, [pkg]);
  await act(async () =>
    root.render(
      <>
        <PackageCommandGroups />
        <PackageMcpGroups />
      </>,
    ),
  );
  await flush();
  expect(packages.list).not.toHaveBeenCalled();
  expect(container.textContent).toBe('');
});
