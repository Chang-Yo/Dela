// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LlmProviderView, LlmSaveInput, LlmVerifyResult } from '../../../../core/protocol/llm';

// 契约客户端在模块加载时取 bridge，须先于导入页面装好；设置用例替换 invoke 的实现，
// 模型用例经 stubLlm 按通道登记 handler。
const { api, bridge, invoke } = vi.hoisted(() => {
  const api: Record<string, (input: never) => unknown> = {};
  const invoke = vi.fn();
  const bridge = { invoke, subscribe: () => () => {} };
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
  return { api, bridge, invoke };
});
import { LlmSection } from '../agent/LlmSection';
import { GeneralSection } from '../GeneralSection';
import { useToastStore } from '../../../../renderer/app/toasts';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string, input: never) => api[channel]!(input));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const channel of Object.keys(api)) delete api[channel];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
  delete window.dela;
  vi.unstubAllGlobals();
});

it('登录项等待系统批准时保持关闭、说明原因，批准后可重试开启', async () => {
  const message = '请在 macOS「系统设置 › 通用 › 登录项」中允许 Dela，然后返回重试。';
  const setOpenAtLogin = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue(true);
  const routes: Record<string, (input: unknown) => unknown> = {
    'settings:openAtLogin': () => false,
    'settings:setOpenAtLogin': setOpenAtLogin,
    'settings:campusNotifications': () => true,
    'settings:taskNotifications': () => ({ failed: true, completed: false }),
  };
  invoke.mockImplementation(async (channel: string, input: unknown) => routes[channel]?.(input));
  window.dela = { platform: 'darwin' } as unknown as NonNullable<typeof window.dela>;
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <GeneralSection navEntries={null} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="开机自启动"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(toggle.disabled).toBe(false);
  expect(useToastStore.getState().toasts).toEqual([
    expect.objectContaining({ variant: 'error', description: message }),
  ]);
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(setOpenAtLogin).toHaveBeenNthCalledWith(1, true);
  expect(setOpenAtLogin).toHaveBeenNthCalledWith(2, true);
});

function button(text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

function stubLlm(handlers: Record<string, (input: never) => unknown>) {
  for (const [name, handler] of Object.entries(handlers)) api[`llm:${name}`] = handler;
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function renderLlm() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <LlmSection />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('searches detected models before adding one and saves per-model settings', async () => {
  const provider: LlmProviderView = {
    id: 'a',
    name: 'Provider A',
    baseUrl: 'https://example.com',
    models: ['existing'],
    piProvider: null,
    enabled: true,
  };
  let saved: LlmSaveInput | undefined;
  stubLlm({
    catalog: async () => [],
    list: async () => [provider],
    verify: async () => ({
      ok: true,
      message: '连接成功',
      models: ['gpt-a', 'claude-a'],
    }),
    save: async (input: LlmSaveInput) => {
      saved = input;
      return { ...provider, ...input };
    },
  });
  await renderLlm();
  await act(async () => button('添加模型').click());
  await fill(document.querySelector<HTMLInputElement>('[aria-label="搜索或输入模型 ID"]')!, 'gpt');
  expect(document.querySelector('[aria-label="添加模型 claude-a"]')).toBeNull();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="添加模型 gpt-a"]')!.click(),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="关闭添加模型"]')!.click(),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="编辑模型 gpt-a"]')!.click(),
  );
  await fill(document.querySelector<HTMLInputElement>('[aria-label="上下文窗口"]')!, '1000000');
  await fill(document.querySelector<HTMLInputElement>('[aria-label="最大输出"]')!, '128000');
  const high = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (item) => item.textContent === 'high',
  )!;
  await act(async () => high.click());
  const apply = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (item) => item.textContent === '应用',
  )!;
  // 编辑态即时保存：模型设置「应用」后立即整体写入，无需再点保存。
  await act(async () => apply.click());
  expect(saved?.models).toEqual(['existing', 'gpt-a']);
  expect(saved?.modelConfigs?.['gpt-a']).toEqual({
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    effortLevels: ['high'],
    effort: 'high',
  });
});

it('discards model detection results after the API address changes', async () => {
  const provider: LlmProviderView = {
    id: 'a',
    name: 'Provider A',
    baseUrl: 'https://example.com',
    models: ['existing'],
    piProvider: null,
    enabled: true,
  };
  let finish!: (result: LlmVerifyResult) => void;
  stubLlm({
    catalog: async () => [],
    list: async () => [provider],
    verify: () =>
      new Promise<LlmVerifyResult>((resolve) => {
        finish = resolve;
      }),
  });
  await renderLlm();
  await act(async () => button('检测模型').click());
  await fill(
    container.querySelector<HTMLInputElement>('input[type="url"]')!,
    'https://other.example',
  );
  await act(async () => finish({ ok: true, message: 'old result', models: ['old-model'] }));
  expect(container.textContent).not.toContain('old result');
});

it('caps model import at 64 and reports the omitted count', async () => {
  const provider: LlmProviderView = {
    id: 'a',
    name: 'Provider A',
    baseUrl: 'https://example.com',
    models: ['existing'],
    piProvider: null,
    enabled: true,
  };
  stubLlm({
    catalog: async () => [],
    list: async () => [provider],
    save: async (input: LlmSaveInput) => ({ ...provider, ...input }),
    verify: async () => ({
      ok: true,
      message: '连接成功',
      models: Array.from({ length: 70 }, (_, i) => `model-${i}`),
    }),
  });
  await renderLlm();
  await act(async () => button('检测模型').click());
  await settle();
  await act(async () => button('一键导入').click());
  expect(container.querySelectorAll('[aria-label^="编辑模型 "]')).toHaveLength(64);
  expect(container.textContent).toContain('7 个未导入');
});

it('keeps the current provider and its draft when an earlier save finishes', async () => {
  const provider = (id: string, name: string): LlmProviderView => ({
    id,
    name,
    baseUrl: 'https://example.com',
    models: ['model'],
    piProvider: null,
    enabled: true,
  });
  const a = provider('a', 'Provider A');
  const b = provider('b', 'Provider B');
  let finishSave!: (saved: LlmProviderView) => void;
  stubLlm({
    catalog: async () => [],
    list: async () => [a, b],
    save: () =>
      new Promise<LlmProviderView>((resolve) => {
        finishSave = resolve;
      }),
  });
  await renderLlm();
  // 编辑态即时保存：名称失焦触发保存并挂起，此时切换提供商并输入草稿。
  const nameA = container.querySelector<HTMLInputElement>('input')!;
  await act(async () => nameA.focus());
  await fill(nameA, 'A renamed');
  await act(async () => nameA.blur());
  // 列表行按钮含首字母块，按包含匹配提供商名。
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((item) => item.textContent?.includes('Provider B'))!
      .click(),
  );
  const nameInput = container.querySelector<HTMLInputElement>('input')!;
  await fill(nameInput, 'B draft');
  expect(nameInput.value).toBe('B draft');
  await act(async () => finishSave(a));
  expect(container.querySelector('button[aria-current="true"]')?.textContent).toContain(
    'Provider B',
  );
  expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('B draft');
});

it('adopts the versioned API base discovered while creating a provider', async () => {
  let saved: LlmSaveInput | undefined;
  stubLlm({
    catalog: async () => [],
    list: async () => [],
    verify: async () => ({
      ok: true,
      message: '连接成功，发现 1 个模型',
      models: ['mimo-v2.6-flash'],
      baseUrl: 'http://192.168.60.110:13000/v1',
    }),
    save: async (input: LlmSaveInput) => {
      saved = input;
      return { ...input, id: 'new', piProvider: null, enabled: true };
    },
  });
  await renderLlm();
  await act(async () => button('添加提供商').click());
  await fill(container.querySelector<HTMLInputElement>('input')!, '自建网关');
  await fill(
    container.querySelector<HTMLInputElement>('input[type="url"]')!,
    'http://192.168.60.110:13000/',
  );
  await fill(container.querySelector<HTMLInputElement>('input[type="password"]')!, 'test-only');
  await act(async () => button('检测模型').click());
  expect(container.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe(
    'http://192.168.60.110:13000/v1',
  );
  await act(async () => button('一键导入').click());
  await act(async () => button('保存').click());
  expect(saved?.baseUrl).toBe('http://192.168.60.110:13000/v1');
});

it('rewrites an existing provider to the API base the service actually serves', async () => {
  const provider: LlmProviderView = {
    id: 'a',
    name: '自建网关',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat'],
    piProvider: null,
    enabled: true,
  };
  stubLlm({
    catalog: async () => [],
    list: async () => [provider],
    save: async (input: LlmSaveInput) => ({ ...provider, ...input }),
    verify: async () => ({
      ok: true,
      message: '连接成功',
      models: [],
      baseUrl: 'https://api.deepseek.com/v1',
    }),
  });
  await renderLlm();
  await act(async () => button('检测模型').click());
  // 沿用已存密钥即可，改地址不再要求重填，所以编辑态也直接校正到位。
  expect(container.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe(
    'https://api.deepseek.com/v1',
  );
});
