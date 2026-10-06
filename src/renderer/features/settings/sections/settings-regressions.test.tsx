// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, LlmProviderView } from '../../../../shared/api';
import { defaultKeybindings } from '../../../../shared/keybindings';
import { useShortcuts } from '../../../app/shortcuts';
import { LlmSection } from './LlmSection';
import { ShortcutsSection } from './ShortcutsSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useShortcuts.setState({ bindings: defaultKeybindings() });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

it('keeps the current provider and its draft when an earlier save finishes', async () => {
  const provider = (id: string, name: string): LlmProviderView => ({
    id,
    name,
    baseUrl: 'https://example.com',
    models: ['model'],
    model: 'model',
    effortLevels: [],
    effort: null,
    presetId: null,
    active: false,
  });
  const a = provider('a', 'Provider A');
  const b = provider('b', 'Provider B');
  let finishSave!: (saved: LlmProviderView) => void;
  window.dela = {
    llm: {
      list: async () => [a, b],
      save: () =>
        new Promise<LlmProviderView>((resolve) => {
          finishSave = resolve;
        }),
    },
  } as unknown as DelaApi;
  await act(async () => root.render(<LlmSection />));
  await act(async () => button('保存').click());
  await act(async () => button('Provider B').click());
  const nameInput = container.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      nameInput,
      'B draft',
    );
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(nameInput.value).toBe('B draft');
  await act(async () => finishSave(a));
  expect(container.querySelector('button[aria-current="true"]')?.textContent).toBe('Provider B');
  expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('B draft');
});

it('rejects a digit-family recording that conflicts at other digits', async () => {
  const writes: unknown[] = [];
  window.dela = {
    settings: {
      setKeybindings: async (patch: unknown) => {
        writes.push(patch);
        return patch;
      },
    },
  } as unknown as DelaApi;
  await act(async () => root.render(<ShortcutsSection />));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="修改「聚焦工作组」的快捷键"]')!
      .click(),
  );
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '4', code: 'Digit4', ctrlKey: true, bubbles: true }),
    ),
  );
  expect(container.querySelector('[role="alert"]')?.textContent ?? '').toContain('首页');
  expect(writes).toEqual([]);
  expect(useShortcuts.getState().bindings['focus-group']).toBe('Alt+1');
});

it('rejects restoring a default shortcut that another action now uses', async () => {
  useShortcuts.setState({
    bindings: { ...defaultKeybindings(), 'global-search': 'Mod+P', 'import-files': 'Mod+K' },
  });
  await act(async () => root.render(<ShortcutsSection />));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="恢复「全局搜索」的默认快捷键"]')!
      .click(),
  );
  expect(container.querySelector('[role="alert"]')?.textContent ?? '').toContain('导入本地文件');
  expect(useShortcuts.getState().bindings['global-search']).toBe('Mod+P');
});
