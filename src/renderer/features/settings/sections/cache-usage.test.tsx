// @vitest-environment jsdom
// 设置 › 通用 › 缓存占用：标记里跟着当前大小、二次确认后清理，并把复查后的数字刷回界面。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../../shared/api';
import { useToastStore } from '../../../app/toasts';
import { CacheUsage } from './CacheUsage';

let container: HTMLDivElement;
let root: Root;

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

function button(text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}

it('显示当前大小，二次确认后清除并刷新数字', async () => {
  let size = 800 * 1024 * 1024;
  const clear = vi.fn(async () => {
    size = 5 * 1024 * 1024;
    return { freed: 795 * 1024 * 1024, blocked: false };
  });
  window.dela = { cache: { getSize: async () => size, clear } } as unknown as DelaApi;

  await act(async () => root.render(<CacheUsage />));
  expect(container.textContent).toContain('800 MB');

  // 缓存要重新下载才有，先确认再动手。
  await act(async () => button('清除缓存').click());
  expect(clear).not.toHaveBeenCalled();

  await act(async () => button('确认清除').click());
  expect(clear).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('5 MB');
  expect(useToastStore.getState().toasts.at(-1)?.title).toContain('795 MB');
});

it('有文件被占用时在结果里说明', async () => {
  window.dela = {
    cache: { getSize: async () => 4096, clear: async () => ({ freed: 0, blocked: true }) },
  } as unknown as DelaApi;

  await act(async () => root.render(<CacheUsage />));
  await act(async () => button('清除缓存').click());
  await act(async () => button('确认清除').click());

  const toast = useToastStore.getState().toasts.at(-1);
  expect(toast?.description).toBeTruthy();
});

it('浏览器预览没有 preload 时不显示数字、也不让点', async () => {
  await act(async () => root.render(<CacheUsage />));

  expect(container.textContent).not.toMatch(/\d/);
  expect(button('清除缓存').disabled).toBe(true);
});
