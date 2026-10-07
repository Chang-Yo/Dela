// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, SponsorsState } from '../../../../shared/api';
import { AboutSection } from './AboutSection';

const idle: SponsorsState = { sponsors: null, checkedAt: null, refreshing: false, error: null };

let container: HTMLDivElement;
let root: Root;

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
});

function stubSponsors(api: {
  getState?: () => Promise<SponsorsState>;
  refresh?: () => Promise<SponsorsState>;
  refreshNow?: () => Promise<SponsorsState>;
  openSupportPage?: () => Promise<void>;
}) {
  window.dela = {
    sponsors: {
      getState: async () => idle,
      refresh: async () => idle,
      refreshNow: async () => idle,
      openSupportPage: async () => undefined,
      ...api,
    },
  } as unknown as DelaApi;
}

/** 等待 mount effect 中的 getState/refresh 微任务链落定。 */
async function settle() {
  await act(async () => {});
  await act(async () => {});
}

it('shows the cached roster first, then applies the refreshed one', async () => {
  let resolveRefresh!: (state: SponsorsState) => void;
  const refresh = vi.fn(
    () =>
      new Promise<SponsorsState>((resolve) => {
        resolveRefresh = resolve;
      }),
  );
  stubSponsors({
    getState: async () => ({ ...idle, sponsors: [{ id: 'a', name: '甲', avatarUrl: null }] }),
    refresh,
  });
  await act(async () => root.render(<AboutSection />));
  expect(container.textContent).toContain('甲');
  expect(container.textContent).not.toContain('乙');
  await act(async () =>
    resolveRefresh({
      ...idle,
      sponsors: [
        { id: 'a', name: '甲', avatarUrl: null },
        { id: 'b', name: '乙', avatarUrl: null },
      ],
    }),
  );
  expect(container.textContent).toContain('乙');
  expect(refresh).toHaveBeenCalledTimes(1);
  // 线上名单接管前，本地硬编码赞助者仍保留展示。
  expect(container.textContent).toContain('冰啤史莱姆');
});

it('offers a retry entry when the first fetch fails without cache', async () => {
  const refreshNow = vi.fn(async (): Promise<SponsorsState> => ({
    ...idle,
    sponsors: [{ id: 'a', name: '甲', avatarUrl: null }],
  }));
  stubSponsors({
    refresh: async () => ({ ...idle, error: '暂时无法获取赞助名单' }),
    refreshNow,
  });
  await act(async () => root.render(<AboutSection />));
  await settle();
  expect(container.textContent).toContain('暂时无法获取赞助名单');
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '重试',
  )!;
  await act(async () => retry.click());
  await settle();
  expect(refreshNow).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('甲');
  expect(container.textContent).not.toContain('重试');
});

it('shows the empty state for a valid empty roster', async () => {
  stubSponsors({
    refresh: async () => ({ ...idle, sponsors: [] }),
  });
  await act(async () => root.render(<AboutSection />));
  await settle();
  expect(container.textContent).toContain('还没有公开的赞助者');
});

it('keeps the cached roster visible with a hint when a refresh fails', async () => {
  stubSponsors({
    getState: async () => ({ ...idle, sponsors: [{ id: 'a', name: '甲', avatarUrl: null }] }),
    refresh: async () => ({
      ...idle,
      sponsors: [{ id: 'a', name: '甲', avatarUrl: null }],
      error: '暂时无法获取赞助名单',
    }),
  });
  await act(async () => root.render(<AboutSection />));
  await settle();
  expect(container.textContent).toContain('甲');
  expect(container.textContent).toContain('刷新失败，以上为本地缓存的名单');
});

it('falls back to the default avatar when an image fails to load', async () => {
  stubSponsors({
    getState: async () => ({
      ...idle,
      sponsors: [{ id: 'a', name: '甲', avatarUrl: 'https://sponsor.example/a.png' }],
    }),
    refresh: async () => ({
      ...idle,
      sponsors: [{ id: 'a', name: '甲', avatarUrl: 'https://sponsor.example/a.png' }],
    }),
  });
  await act(async () => root.render(<AboutSection />));
  await settle();
  const image = container.querySelector<HTMLImageElement>(
    'img[src="https://sponsor.example/a.png"]',
  )!;
  await act(async () => image.dispatchEvent(new Event('error')));
  expect(container.querySelector('img[src="https://sponsor.example/a.png"]')).toBeNull();
  expect(container.querySelector('span.rounded-full.bg-muted')).not.toBeNull();
});

it('refreshes when the window regains focus', async () => {
  const refresh = vi.fn(async (): Promise<SponsorsState> => ({ ...idle, sponsors: [] }));
  stubSponsors({ refresh });
  await act(async () => root.render(<AboutSection />));
  await settle();
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle();
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('opens the support page from the sponsor button', async () => {
  const openSupportPage = vi.fn(async () => undefined);
  stubSponsors({
    refresh: async () => ({ ...idle, sponsors: [] }),
    openSupportPage,
  });
  await act(async () => root.render(<AboutSection />));
  await settle();
  const sponsor = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '赞助',
  )!;
  await act(async () => sponsor.click());
  expect(openSupportPage).toHaveBeenCalledTimes(1);
});
