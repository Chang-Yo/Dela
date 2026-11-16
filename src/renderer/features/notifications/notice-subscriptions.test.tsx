// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  notificationSources,
  type DelaApi,
  type NoticePreview,
  type NotificationState,
  type NotificationSubscriptions,
} from '../../../shared/api';
import { useNotificationSourceFilter } from './source-filter';
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
const emptyState: NotificationState = {
  items: [],
  totalCount: 0,
  unreadCount: 0,
  snoozedUntil: null,
  refresh: { mail: null, shuiyuan: null, todo: null, jwc: null, canvas: null, notice: null },
};
const getSubscriptions = vi.fn<() => Promise<NotificationSubscriptions>>();
const getState = vi.fn(async () => emptyState);
const addNoticeSubscription = vi.fn(async () => emptyState);
const removeNoticeSubscription = vi.fn(async () => emptyState);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationSourceFilter.setState({ sources: notificationSources });
  getSubscriptions.mockResolvedValue({ jwc: true, notices: [] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.dela = {
    notifications: {
      getSubscriptions,
      getState,
      previewNoticeSubscription,
      addNoticeSubscription,
      removeNoticeSubscription,
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

async function renderView(state: NotificationState = emptyState) {
  await act(async () => {
    root.render(
      <NotificationsView
        jwcNotice={null}
        onCloseJwcNotice={() => {}}
        state={state}
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
}

async function renderPreview() {
  await renderView();
  const manage = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '订阅管理',
  )!;
  await act(async () => manage.click());
  await enterInput('公告列表页网址', preview.pageUrl);
  const analyze = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === '预览栏目',
  )!;
  await act(async () => analyze.click());
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

it('finds partial keywords beyond the three samples without fetching or narrowing the saved column', async () => {
  await renderPreview();
  await enterInput('查找栏目或公告', '  学院 5  ');
  const candidate = button('选择栏目：学院动态 News');
  expect(candidate.textContent).toContain('学院公告 5');
  expect(candidate.textContent).not.toContain('学院公告 1');
  expect(container.querySelector('[aria-label="选择栏目：学术活动"]')).toBeNull();
  expect(previewNoticeSubscription).toHaveBeenCalledExactlyOnceWith(
    preview.pageUrl,
    undefined,
    false,
  );

  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith('preview-token', 0);
});

it('searches column names case-insensitively and confirms the original candidate index', async () => {
  await renderPreview();
  await enterInput('查找栏目或公告', 'NEWS');
  expect(button('选择栏目：学院动态 News').textContent).toContain('学院公告 1');

  await enterInput('查找栏目或公告', '学术');
  expect(container.querySelector('[aria-label="选择栏目：学院动态 News"]')).toBeNull();
  expect(button('选择栏目：学术活动').getAttribute('aria-pressed')).toBe('true');
  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith('preview-token', 1);
});

it('blocks confirmation for no matches and restores the complete preview when the search is cleared', async () => {
  await renderPreview();
  await enterInput('查找栏目或公告', '不存在的关键词');
  expect(container.textContent).toContain('没有匹配的栏目或公告');
  expect(button('订阅所选栏目').disabled).toBe(true);
  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).not.toHaveBeenCalled();

  await enterInput('查找栏目或公告', '');
  expect(button('选择栏目：学院动态 News')).toBeTruthy();
  expect(button('选择栏目：学术活动')).toBeTruthy();
  expect(button('订阅所选栏目').disabled).toBe(false);
});

it('shows collected entries and sync status, then opens the subscribed notices', async () => {
  getSubscriptions.mockResolvedValue({
    jwc: true,
    notices: [
      {
        id: 'saved-notice',
        label: '学院动态 News · school.example',
        pageUrl: preview.pageUrl,
        acquisition: 'http',
        lastSuccessAt: '2026-11-16T08:00:00.000Z',
        error: null,
        entryCount: 5,
        unreadCount: 1,
      },
    ],
  });
  await renderPreview();
  const panel = container.querySelector('section[aria-label="订阅管理"]')!;
  expect(panel.textContent).toContain('已收集 5 条');
  expect(panel.textContent).toContain('1 条未读');
  expect(panel.textContent).toContain('最近检查');
  expect(panel.textContent).toContain('已有公告标为已读');

  await act(async () => button('查看订阅公告').click());
  expect(useNotificationSourceFilter.getState().sources).toEqual(['notice']);
  expect(getState).toHaveBeenCalledWith(['notice']);
  expect(container.querySelector('section[aria-label="订阅管理"]')).toBeNull();
});

it('reports subscription success and reloads counts when notification state changes', async () => {
  await renderPreview();
  await act(async () => button('订阅所选栏目').click());
  expect(container.textContent).toContain('已订阅');
  expect(container.textContent).toContain('5 条公告已加入通知列表');
  expect(container.querySelector('section[aria-label="订阅管理"] [role="status"]')).not.toBeNull();

  getSubscriptions.mockClear();
  await renderView({ ...emptyState, totalCount: 1 });
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
  expect(container.textContent).toContain('请选择栏目继续');
  expect(container.querySelector('[aria-label="选择栏目：学院动态 News"]')).toBeNull();
  expect(
    [...container.querySelectorAll('button')].some((item) => item.textContent === '订阅所选栏目'),
  ).toBe(false);

  await act(async () => button('通知公告').click());
  expect(previewNoticeSubscription).toHaveBeenNthCalledWith(2, sectionUrl, undefined, false);
  expect(container.querySelector<HTMLInputElement>('[aria-label="公告列表页网址"]')!.value).toBe(
    sectionUrl,
  );
  await act(async () => button('订阅所选栏目').click());
  expect(addNoticeSubscription).toHaveBeenCalledExactlyOnceWith('section-token', 0);
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
    jwc: true,
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
  expect(container.textContent).toContain('5 条公告已加入通知列表');

  getSubscriptions.mockResolvedValue({ jwc: true, notices: [] });
  await act(async () => button('移除').click());
  await act(async () => button('确认移除').click());
  expect(removeNoticeSubscription).toHaveBeenCalledExactlyOnceWith('saved-notice');
  expect(container.textContent).not.toContain('5 条公告已加入通知列表');
  expect(
    [...container.querySelectorAll('button')].some((item) => item.textContent === '查看订阅公告'),
  ).toBe(false);
});
