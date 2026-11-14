// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WebSearchEntryInput } from '../../../../shared/api';

// 契约客户端在模块加载时取 bridge，须先于导入装好；用例按通道登记 handler。
const { api, bridge } = vi.hoisted(() => {
  const api: Record<string, (input: never) => unknown> = {};
  const bridge = {
    invoke: async (channel: string, input: never) => api[channel]!(input),
    subscribe: () => () => {},
  };
  window.dela = { bridge } as unknown as NonNullable<typeof window.dela>;
  return { api, bridge };
});
import { SearchConfigDialog } from './SearchConfigDialog';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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

function button(text: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => element.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

it('导入 DeepSeek 密钥后切换到 Brave，不应把 DeepSeek 密钥保存给 Brave', async () => {
  const importedKey = 'sk-deepseek-regression-test-only';
  const saveWebSearchEntry = vi.fn(async (_entry: WebSearchEntryInput) => []);
  const readWebSearchKey = vi.fn(async () => importedKey);
  api['capabilities:listWebSearchEntries'] = async () => [];
  api['capabilities:listWebSearchKeySources'] = async () => [
    { id: 'deepseek-model', name: '学校账号' },
  ];
  api['capabilities:readWebSearchKey'] = readWebSearchKey;
  api['capabilities:saveWebSearchEntry'] = saveWebSearchEntry;
  window.dela = { bridge } as unknown as DelaApi;

  await act(async () => root.render(<SearchConfigDialog onClose={() => {}} />));
  await act(async () => button('添加搜索服务').click());
  const name = document.querySelector<HTMLInputElement>('input[placeholder^="区分用途"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(name, '学校搜索');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('导入已有 API').click());
  expect(readWebSearchKey).toHaveBeenCalledExactlyOnceWith('deepseek-model');
  expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe(
    importedKey,
  );

  await act(async () => button('Brave Search API').click());
  const braveKey = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(braveKey.value).toBe('');
  await act(async () => document.querySelector<HTMLFormElement>('form')!.requestSubmit());

  expect(saveWebSearchEntry).not.toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'brave', apiKey: importedKey }),
  );
  await act(async () => {
    setValue.call(braveKey, 'BSA-regression-test-only');
    braveKey.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => document.querySelector<HTMLFormElement>('form')!.requestSubmit());
  expect(saveWebSearchEntry).toHaveBeenCalledExactlyOnceWith({
    name: '学校搜索',
    id: undefined,
    provider: 'brave',
    apiKey: 'BSA-regression-test-only',
  });
});
