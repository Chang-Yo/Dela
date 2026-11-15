// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi, NoticePreview } from '../../../shared/api';
import { NotificationsView } from './NotificationsView';

vi.mock('../settings/experimental', () => ({
  useExperimental: { getState: () => ({ load: async () => {} }) },
  useExperimentEnabled: () => true,
}));

const preview: NoticePreview = {
  token: 'preview-token',
  pageUrl: 'https://school.example/',
  title: '学院官网',
  acquisition: 'http',
  status: 'ok',
  candidates: [
    {
      label: '学院动态 News 查看更多',
      reasons: [],
      entries: Array.from({ length: 5 }, (_, index) => ({
        title: `学院公告 ${index + 1}`,
        url: `https://school.example/news/${index + 1}`,
        publishedAt: '2026-11-15',
      })),
    },
    {
      label: '学术活动',
      reasons: [],
      entries: [{ title: '学术报告', url: 'https://school.example/academic/1', publishedAt: null }],
    },
  ],
  feeds: [],
  diagnostics: [],
};

const previewNoticeSubscription = vi.fn(async () => preview);
const addNoticeSubscription = vi.fn(async () => {});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.dela = {
    notifications: {
      getSubscriptions: async () => ({ jwc: true, notices: [] }),
      previewNoticeSubscription,
      addNoticeSubscription,
    },
  } as unknown as DelaApi;
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

async function renderPreview() {
  await act(async () => {
    root.render(
      <NotificationsView
        jwcNotice={null}
        onCloseJwcNotice={() => {}}
        state={null}
        loading={false}
        error={null}
        onRefresh={() => {}}
        onMarkRead={() => {}}
        onMarkAllRead={() => {}}
        onSnooze={() => {}}
        onOpen={() => {}}
      />,
    );
  });
  const manage = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '订阅管理',
  )!;
  await act(async () => manage.click());
  const input = container.querySelector<HTMLInputElement>('[aria-label="公告列表页网址"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, preview.pageUrl);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const analyze = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '预览栏目',
  )!;
  await act(async () => analyze.click());
}

function button(label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === label,
  );
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

it('expands all recognized entries and collapses back to three samples', async () => {
  await renderPreview();
  const candidate = button('选择栏目：学院动态 News');
  expect(candidate.textContent).not.toContain('查看更多');
  expect(candidate.textContent).toContain('学院公告 3');
  expect(candidate.textContent).not.toContain('学院公告 4');
  expect(button('查看更多：学院动态 News').getAttribute('aria-expanded')).toBe('false');

  await act(async () => button('查看更多：学院动态 News').click());
  expect(candidate.textContent).toContain('学院公告 4');
  expect(candidate.textContent).toContain('学院公告 5');
  expect(button('收起：学院动态 News').getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('button button')).toBeNull();

  await act(async () => button('收起：学院动态 News').click());
  expect(candidate.textContent).toContain('学院公告 3');
  expect(candidate.textContent).not.toContain('学院公告 4');
});

it('keeps expansion separate from selection and confirms the selected column', async () => {
  await renderPreview();
  await act(async () => button('选择栏目：学术活动').click());
  await act(async () => button('查看更多：学院动态 News').click());
  expect(button('选择栏目：学术活动').getAttribute('aria-pressed')).toBe('true');
  expect(button('选择栏目：学院动态 News').getAttribute('aria-pressed')).toBe('false');
  expect(addNoticeSubscription).not.toHaveBeenCalled();

  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith('preview-token', 1);
});

it('resets expansion for a new preview and omits the action for short columns', async () => {
  await renderPreview();
  expect(container.querySelector('[aria-label="查看更多：学术活动"]')).toBeNull();
  await act(async () => button('查看更多：学院动态 News').click());
  expect(button('选择栏目：学院动态 News').textContent).toContain('学院公告 5');

  await act(async () => button('预览栏目').click());
  expect(previewNoticeSubscription).toHaveBeenCalledTimes(2);
  expect(button('选择栏目：学院动态 News').textContent).not.toContain('学院公告 4');
  expect(button('查看更多：学院动态 News').getAttribute('aria-expanded')).toBe('false');
});
