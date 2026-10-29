// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, WebSearchEntryInput } from '../../../../shared/api';
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
  window.dela = {
    capability: {
      listWebSearchEntries: async () => [],
      listWebSearchKeySources: async () => [{ id: 'deepseek-model', name: '学校账号' }],
      readWebSearchKey,
      saveWebSearchEntry,
    },
  } as unknown as DelaApi;

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
