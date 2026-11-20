// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../preload/api';

// 契约客户端在模块加载时取 bridge，须先于导入页面装好。
const { invoke } = vi.hoisted(() => {
  const invoke = vi.fn();
  window.dela = { bridge: { invoke, subscribe: () => () => {} } } as unknown as NonNullable<
    typeof window.dela
  >;
  return { invoke };
});
import { defaultKeybindings } from '../../../../modules/settings/contract';
import { useShortcuts } from '../../shell/shortcuts';
import { ShortcutsSection } from './ShortcutsSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  invoke.mockReset();
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

it('rejects a digit-family recording that conflicts at other digits', async () => {
  useShortcuts.setState({ bindings: { ...defaultKeybindings(), 'open-settings': 'Mod+2' } });
  const writes: unknown[] = [];
  invoke.mockImplementation(async (channel: string, patch: unknown) => {
    if (channel !== 'settings:setKeybindings') return undefined;
    writes.push(patch);
    return patch;
  });
  window.dela = {} as unknown as DelaApi;
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
  expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
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
  expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  expect(useShortcuts.getState().bindings['global-search']).toBe('Mod+P');
});
