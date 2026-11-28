// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import type { NotificationState } from '../../../../modules/notifications/contract';
import { notificationsView } from '../../../../modules/notifications/view';
import type { NoticePreview, WebsiteSubscriptions } from '../../contract';
import { websiteSubscriptionsView } from '..';

const { invoke, subscribe } = vi.hoisted(() => {
  const invoke = vi.fn();
  const subscribe = vi.fn(() => () => {});
  vi.stubGlobal('dela', { bridge: { invoke, subscribe } });
  return { invoke, subscribe };
});

const NotificationsPage = notificationsView({
  ...websiteSubscriptionsView.notices,
  jwc: { label: '教务处', icon: Globe },
}).pages.notifications!.component;

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

const previewNoticeSubscription = vi.fn(async (_input: unknown) => preview);
const emptyState: NotificationState = {
  items: [],
  totalCount: 0,
  unreadCount: 0,
  snoozedUntil: null,
  refresh: {},
};
const getSubscriptions = vi.fn<() => Promise<WebsiteSubscriptions>>();
const getState = vi.fn(async (_input: unknown) => emptyState);
const addNoticeSubscription = vi.fn(async (_input: unknown) => emptyState);
const removeNoticeSubscription = vi.fn(async (_input: unknown) => emptyState);

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  getSubscriptions.mockResolvedValue({ experimental: true, notices: [] });
  vi.stubGlobal('dela', { bridge: { invoke, subscribe } });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  invoke.mockImplementation((channel: string, input: unknown) => {
    switch (channel) {
      case 'notifications:subscriptions':
        return [];
      case 'websiteSubscriptions:subscriptions':
        return getSubscriptions();
      case 'notifications:state':
        return getState(input);
      case 'websiteSubscriptions:previewNoticeSubscription':
        return previewNoticeSubscription(input);
      case 'websiteSubscriptions:addNoticeSubscription':
        return addNoticeSubscription(input);
      case 'websiteSubscriptions:removeNoticeSubscription':
        return removeNoticeSubscription(input);
      default:
        throw new Error(channel);
    }
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  vi.unstubAllGlobals();
});

async function renderPreview() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NotificationsPage target={{}} drawer={null} navigate={() => true} />
      </QueryClientProvider>,
    );
  });
  await act(async () => button('订阅管理').click());
  await act(async () => {
    await client.fetchQuery({
      queryKey: ['notifications', 'state', 'websiteSubscriptions'],
      queryFn: () => getSubscriptions(),
    });
  });
  await vi.waitFor(() =>
    expect(container.querySelector('[aria-label="公告列表页网址"]')).not.toBeNull(),
  );
  await enterInput('公告列表页网址', preview.pageUrl);
  await act(async () => button('预览栏目').click());
}

async function enterInput(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  expect(input, `Missing input: ${label}`).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
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
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith({
    token: 'preview-token',
    candidate: 1,
  });
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

it('finds partial keywords beyond the three samples without fetching or narrowing the saved column', async () => {
  await renderPreview();
  await enterInput('查找栏目或公告', '  学院 5  ');
  const candidate = button('选择栏目：学院动态 News');
  expect(candidate.textContent).toContain('学院公告 5');
  expect(candidate.textContent).not.toContain('学院公告 1');
  expect(container.querySelector('[aria-label="选择栏目：学术活动"]')).toBeNull();
  expect(previewNoticeSubscription).toHaveBeenCalledExactlyOnceWith({
    url: preview.pageUrl,
    render: false,
  });

  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith({
    token: 'preview-token',
    candidate: 0,
  });
});

it('searches column names case-insensitively and confirms the original candidate index', async () => {
  await renderPreview();
  await enterInput('查找栏目或公告', 'NEWS');
  expect(button('选择栏目：学院动态 News').textContent).toContain('学院公告 1');

  await enterInput('查找栏目或公告', '学术');
  expect(container.querySelector('[aria-label="选择栏目：学院动态 News"]')).toBeNull();
  expect(button('选择栏目：学术活动').getAttribute('aria-pressed')).toBe('true');
  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith({
    token: 'preview-token',
    candidate: 1,
  });
});

it('blocks confirmation for no matches and restores the complete preview when the search is cleared', async () => {
  await renderPreview();
  await enterInput('查找栏目或公告', '不存在的关键词');
  expect(container.querySelectorAll('button[aria-label^="选择栏目："]')).toHaveLength(0);
  expect(button('订阅所选栏目').disabled).toBe(true);
  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).not.toHaveBeenCalled();

  await enterInput('查找栏目或公告', '');
  expect(button('选择栏目：学院动态 News')).toBeTruthy();
  expect(button('选择栏目：学术活动')).toBeTruthy();
  expect(button('订阅所选栏目').disabled).toBe(false);
});

it('reports subscription success and reloads counts when notification state changes', async () => {
  await renderPreview();
  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith({
    token: 'preview-token',
    candidate: 0,
  });
  const feedback = container.querySelector('section[aria-label="订阅管理"] [role="status"]');
  expect(feedback).not.toBeNull();
  expect(feedback?.textContent?.match(/\d+/g)).toEqual(['5']);
  expect(container.querySelectorAll('button[aria-label^="选择栏目："]')).toHaveLength(0);

  getSubscriptions.mockClear();
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['notifications', 'state'],
      predicate: (query) => query.queryKey.length > 2,
    });
  });
  expect(getSubscriptions).toHaveBeenCalledOnce();
});

it('follows a discovered section before subscribing and replaces the old preview token', async () => {
  const sectionUrl = 'https://school.example/notices';
  previewNoticeSubscription
    .mockResolvedValueOnce({
      ...preview,
      token: 'homepage-token',
      candidates: [],
      status: 'unsupported',
      sectionLinks: [{ title: '通知公告', url: sectionUrl }],
    })
    .mockResolvedValueOnce({ ...preview, pageUrl: sectionUrl, token: 'section-token' });

  await renderPreview();
  expect(button('通知公告').disabled).toBe(false);
  expect(container.querySelector('[aria-label="选择栏目：学院动态 News"]')).toBeNull();
  expect(
    [...container.querySelectorAll('button')].some((item) => item.textContent === '订阅所选栏目'),
  ).toBe(false);

  await act(async () => button('通知公告').click());
  expect(previewNoticeSubscription).toHaveBeenNthCalledWith(2, { url: sectionUrl, render: false });
  expect(container.querySelector<HTMLInputElement>('[aria-label="公告列表页网址"]')!.value).toBe(
    sectionUrl,
  );
  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith({
    token: 'section-token',
    candidate: 0,
  });
});

it('invalidates the preview when its address is edited', async () => {
  await renderPreview();
  await enterInput('公告列表页网址', 'https://other.example/notices');
  expect(container.querySelector('[aria-label="选择栏目：学院动态 News"]')).toBeNull();
  expect(addNoticeSubscription).not.toHaveBeenCalled();
});

it('clears the saved feedback and entry point when the last subscription is removed', async () => {
  await renderPreview();
  getSubscriptions.mockResolvedValue({
    experimental: true,
    notices: [
      {
        id: 'saved-notice',
        label: '学院动态 News',
        pageUrl: preview.pageUrl,
        acquisition: 'http',
        lastSuccessAt: '2026-11-16T08:00:00.000Z',
        error: null,
        entryCount: 5,
        unreadCount: 0,
      },
    ],
  });
  await act(async () => button('订阅所选栏目').click());
  expect(container.querySelector('section[aria-label="订阅管理"] [role="status"]')).not.toBeNull();

  getSubscriptions.mockResolvedValue({ experimental: true, notices: [] });
  await act(async () => button('移除').click());
  await act(async () => button('确认移除').click());
  expect(removeNoticeSubscription).toHaveBeenCalledExactlyOnceWith('saved-notice');
  expect(container.querySelector('section[aria-label="订阅管理"] [role="status"]')).toBeNull();
  expect(
    [...container.querySelectorAll('button')].some((item) => item.textContent === '查看订阅公告'),
  ).toBe(false);
});

it('shows subscription counts and opens collected notices', async () => {
  getSubscriptions.mockResolvedValue({
    experimental: true,
    notices: [
      {
        id: 'saved-notice',
        label: '学院动态 News · school.example',
        pageUrl: preview.pageUrl,
        acquisition: 'http',
        lastSuccessAt: new Date().toISOString(),
        error: null,
        entryCount: 5,
        unreadCount: 1,
      },
    ],
  });
  await renderPreview();
  const savedSubscription = button('移除').parentElement!;
  expect(savedSubscription.textContent).toContain('已收集 5 条 · 1 条未读');

  await act(async () => button('查看订阅公告').click());
  expect(getState).toHaveBeenCalledWith(['notice']);
  expect(container.querySelector('section[aria-label="订阅管理"]')).toBeNull();
});
