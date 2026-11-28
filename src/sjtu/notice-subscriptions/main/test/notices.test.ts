import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import {
  findBuiltInSubscription,
  notificationsModule,
  registerNoticeSource,
  systemNotifyItem,
} from '../../../../modules/notifications';
import type {
  BuiltInSubscription,
  NotificationState,
} from '../../../../modules/notifications/contract';
import { websiteSubscriptionsModule } from '../..';
import type { WebsiteSubscriptions } from '../../contract';
import { fetchNoticePage } from '../fetch';
import { renderNoticePage } from '../render';
import {
  displayNoticeSource,
  entryCreatedAt,
  previewNoticeSubscription,
  setNoticeSubscriptionsEnabled,
} from '../notices';

vi.mock('electron', () => ({}));
vi.mock('../../../../modules/todo', () => ({
  getTodoState: () => ({}),
  todoNotifications: () => [],
  todoSyncedAt: () => null,
  todoSyncError: () => null,
  markTodoRead: vi.fn(),
  onTodoChange: vi.fn(),
  onTaskNotice: vi.fn(),
}));
vi.mock('../../../../modules/notifications', async (load) => ({
  ...(await load<typeof import('../../../../modules/notifications')>()),
  systemNotifyItem: vi.fn(),
}));
vi.mock('../fetch', () => ({ fetchNoticePage: vi.fn() }));
vi.mock('../render', () => ({ renderNoticePage: vi.fn() }));

const refreshJwc = vi.fn(async (_account: string, _force: boolean) => {});
const jwcUrl = 'https://jwc.sjtu.edu.cn/index/mxxsdtz.htm';

const callNotifications = <T>(method: string, input?: unknown) =>
  notificationsModule.ipc!.call(method, input) as T;
const callSubscriptions = <T>(method: string, input?: unknown) =>
  websiteSubscriptionsModule.ipc!.call(method, input) as T;
const refresh = () => callNotifications<Promise<NotificationState>>('refresh');
const getNotificationState = () => callNotifications<NotificationState>('state');
const markAllNotificationsRead = (sources: string[]) =>
  callNotifications<Promise<NotificationState>>('markAllRead', sources);
const confirmNoticeSubscription = (token: string, candidate: number) =>
  callSubscriptions<NotificationState>('addNoticeSubscription', { token, candidate });
const deleteNoticeSubscription = (id: string) =>
  callSubscriptions<NotificationState>('removeNoticeSubscription', id);
const getNotificationSubscriptions = () => callSubscriptions<WebsiteSubscriptions>('subscriptions');
const setJwcSubscribed = (enabled: boolean) =>
  callNotifications<NotificationState>('setBuiltInSubscription', { id: 'jwc', enabled });

const sampleHtmlBefore = `<!doctype html>
<html>
  <head><title>计算机学院 - 通知公告</title></head>
  <body>
    <section>
      <h2>通知公告</h2>
      <ul class="notice-list">
        <li><a href="/notices/101.html">关于2026年秋季学期研究生开题报告的通知</a><span>2026-10-12</span></li>
        <li><a href="/notices/102.html">关于开展实验室安全检查工作的通知</a><span>2026-10-10</span></li>
      </ul>
    </section>
  </body>
</html>`;

const sampleHtmlAfter = `<!doctype html>
<html>
  <head><title>计算机学院 - 通知公告</title></head>
  <body>
    <section>
      <h2>通知公告</h2>
      <ul class="notice-list">
        <li><a href="/notices/103.html">关于举办人工智能前沿学术论坛的通知</a><span>2026-11-14</span></li>
        <li><a href="/notices/101.html">关于2026年秋季学期研究生开题报告的通知</a><span>2026-10-12</span></li>
        <li><a href="/notices/102.html">关于开展实验室安全检查工作的通知</a><span>2026-10-10</span></li>
      </ul>
    </section>
  </body>
</html>`;

describe('notice subscriptions host adapter', () => {
  let db: Database.Database;

  beforeAll(() => {
    notificationsModule.register?.();
    websiteSubscriptionsModule.register?.();
  });

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const statement of notificationsModule.schema!.tables) db.exec(statement);
    provideTestHostPorts({ database: () => db });
    vi.clearAllMocks();
    let subscribed = true;
    registerNoticeSource({
      id: 'jwc',
      account: () => (subscribed ? 'students' : null),
      refresh: refreshJwc,
      link: (_href, id) => ({ target: { page: 'notifications' }, group: id }),
      subscription: {
        label: '教务处',
        url: jwcUrl,
        enabled: () => subscribed,
        setEnabled: (enabled) => {
          subscribed = enabled;
        },
        matches: (url, label) =>
          url.hostname === 'jwc.sjtu.edu.cn' &&
          (url.href === jwcUrl ||
            url.pathname.startsWith('/index/mxxsdtz/') ||
            label === '面向学生的通知'),
      },
    });
  });
  afterEach(() => {
    db.close();
  });

  it('rejects built-in JWC list URLs (and redirects to them) and guides user to the built-in toggle', async () => {
    expect(findBuiltInSubscription('https://jwc.sjtu.edu.cn/index/mxxsdtz.htm')).toBe('教务处');
    expect(findBuiltInSubscription('https://jwc.sjtu.edu.cn/index/mxxsdtz/98.htm')).toBe('教务处');
    expect(findBuiltInSubscription('https://jwc.sjtu.edu.cn/xwtg/tztg.htm')).toBeUndefined();
    expect(findBuiltInSubscription('https://jwc.sjtu.edu.cn/index.htm', '面向学生的通知')).toBe(
      '教务处',
    );
    expect(
      findBuiltInSubscription('https://cs.sjtu.edu.cn/index.htm', '面向学生的通知'),
    ).toBeUndefined();
    expect(displayNoticeSource('通知公告', 'https://www.cs.sjtu.edu.cn/notices.html')).toBe(
      '通知公告 · cs.sjtu.edu.cn',
    );

    await expect(
      previewNoticeSubscription('https://jwc.sjtu.edu.cn/index/mxxsdtz.htm'),
    ).rejects.toThrow('教务处通知已内置');

    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: 'https://jwc.sjtu.edu.cn/index/mxxsdtz/1.htm',
      body: Buffer.from(sampleHtmlBefore),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T08:00:00.000Z',
    });
    await expect(previewNoticeSubscription('https://example.edu.cn/redirect')).rejects.toThrow(
      '教务处通知已内置',
    );
  });

  it('follows the real innovation center section and imports its linked notices', async () => {
    setNoticeSubscriptionsEnabled(true);
    const homepageUrl = 'https://www.si.sjtu.edu.cn/';
    const listUrl =
      'https://www.si.sjtu.edu.cn/content/news-list?menuIds=2,8,18&params=5&singlePage=1';
    const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: homepageUrl,
      body: fixture('innovation-home.html'),
      charset: 'utf-8',
      fetchedAt: '2026-11-16T08:00:00.000Z',
    });
    const homepage = await previewNoticeSubscription(homepageUrl);
    expect(homepage.candidates).toEqual([]);
    expect(homepage.sectionLinks).toContainEqual({ title: '通知公告', url: listUrl });

    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: listUrl,
      body: fixture('innovation-notices.html'),
      charset: 'utf-8',
      fetchedAt: '2026-11-16T08:00:00.000Z',
    });
    const list = await previewNoticeSubscription(listUrl);
    const state = confirmNoticeSubscription(list.token, 0);
    expect(state.items).toHaveLength(12);
    expect(state.unreadCount).toBe(0);
    expect(getNotificationSubscriptions().notices[0]).toMatchObject({
      pageUrl: listUrl,
      entryCount: 12,
      unreadCount: 0,
    });
    expect(state.items.every((item) => 'url' in item.target && item.source === 'notice')).toBe(
      true,
    );
  });

  it('supports explicit rendered preview and persists rendered acquisition across refreshes', async () => {
    const pageUrl = 'https://dynamic.sjtu.edu.cn/notices/index.html';
    vi.mocked(renderNoticePage).mockResolvedValueOnce({
      url: pageUrl,
      body: Buffer.from(sampleHtmlBefore),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T08:00:00.000Z',
    });

    const preview = await previewNoticeSubscription(pageUrl, undefined, true);
    expect(preview.acquisition).toBe('rendered');
    expect(preview.diagnostics).toContain(
      '已执行页面 JavaScript；DOM 稳定为限时启发式，不保证所有异步内容加载完成',
    );
    confirmNoticeSubscription(preview.token, 0);
    expect(getNotificationSubscriptions().notices[0]?.acquisition).toBe('rendered');

    vi.mocked(renderNoticePage).mockResolvedValueOnce({
      url: pageUrl,
      body: Buffer.from(sampleHtmlAfter),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T09:00:00.000Z',
    });
    const state = await refresh();
    expect(fetchNoticePage).not.toHaveBeenCalled();
    expect(renderNoticePage).toHaveBeenCalledTimes(2);
    expect(state.unreadCount).toBe(1);
    expect(state.items[0]?.body).toBe('通知公告 · dynamic.sjtu.edu.cn');
  });

  it('imports initial baseline entries as read without firing desktop notifications, and notifies only on new entries', async () => {
    const pageUrl = 'https://cs.sjtu.edu.cn/notices/index.html';
    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: pageUrl,
      body: Buffer.from(sampleHtmlBefore),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T08:00:00.000Z',
    });

    const preview = await previewNoticeSubscription(pageUrl);
    expect(preview.candidates.length).toBeGreaterThan(0);

    const stateAfterConfirm = confirmNoticeSubscription(preview.token, 0);
    expect(systemNotifyItem).not.toHaveBeenCalled();
    expect(stateAfterConfirm.unreadCount).toBe(0);
    expect(stateAfterConfirm.items).toHaveLength(2);
    expect(stateAfterConfirm.items.every((item) => item.readAt !== null)).toBe(true);
    expect(getNotificationSubscriptions().notices[0]).toMatchObject({
      entryCount: 2,
      unreadCount: 0,
      lastSuccessAt: '2026-11-14T08:00:00.000Z',
    });
    expect(stateAfterConfirm.items[0]).toMatchObject({
      source: 'notice',
      title: '关于2026年秋季学期研究生开题报告的通知',
      target: { url: 'https://cs.sjtu.edu.cn/notices/101.html' },
      publishedAt: '2026-10-12',
    });

    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: pageUrl,
      body: Buffer.from(sampleHtmlAfter),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T09:00:00.000Z',
    });

    const stateAfterRefresh = await refresh();
    expect(systemNotifyItem).toHaveBeenCalledTimes(1);
    expect(systemNotifyItem).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'notice',
        title: '关于举办人工智能前沿学术论坛的通知',
        href: {
          kind: 'notice',
          url: 'https://cs.sjtu.edu.cn/notices/103.html',
          publishedAt: '2026-11-14',
        },
      }),
      expect.any(String),
    );
    expect(stateAfterRefresh.unreadCount).toBe(1);
    expect(getNotificationSubscriptions().notices[0]).toMatchObject({
      entryCount: 3,
      unreadCount: 1,
    });
    await markAllNotificationsRead(['notice']);
    expect(getNotificationSubscriptions().notices[0]).toMatchObject({
      entryCount: 3,
      unreadCount: 0,
    });
  });

  it('isolates multiple subscriptions, aggregates errors without overwriting state, and cleans up on removal', async () => {
    const urlA = 'https://a.sjtu.edu.cn/notices.html';
    const urlB = 'https://b.sjtu.edu.cn/notices.html';

    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: urlA,
      body: Buffer.from(sampleHtmlBefore),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T08:00:00.000Z',
    });
    const previewA = await previewNoticeSubscription(urlA);
    confirmNoticeSubscription(previewA.token, 0);

    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: urlB,
      body: Buffer.from(sampleHtmlBefore),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T08:00:00.000Z',
    });
    const previewB = await previewNoticeSubscription(urlB);
    confirmNoticeSubscription(previewB.token, 0);

    const subs = getNotificationSubscriptions().notices;
    expect(subs).toHaveLength(2);

    vi.mocked(fetchNoticePage)
      .mockRejectedValueOnce(new Error('HTTP 502'))
      .mockResolvedValueOnce({
        url: urlB,
        body: Buffer.from(sampleHtmlAfter),
        charset: 'utf-8',
        fetchedAt: '2026-11-14T09:00:00.000Z',
      });

    const state = await refresh();
    expect(state.refresh.notice?.error).toContain('HTTP 502');
    expect(state.refresh.notice?.lastSuccessAt).toBe('2026-11-14T09:00:00.000Z');
    expect(state.unreadCount).toBe(1);
    expect(getNotificationSubscriptions().notices).toEqual([
      expect.objectContaining({
        id: subs[0]!.id,
        entryCount: 2,
        unreadCount: 0,
        error: 'HTTP 502',
      }),
      expect.objectContaining({ id: subs[1]!.id, entryCount: 3, unreadCount: 1, error: null }),
    ]);

    await markAllNotificationsRead(['notice']);
    expect(getNotificationState().unreadCount).toBe(0);

    const afterDelete = deleteNoticeSubscription(subs[0]!.id);
    expect(afterDelete.refresh.notice?.error).toBeNull();
    expect(getNotificationSubscriptions().notices).toHaveLength(1);
  });

  it.each(['success', 'failure'] as const)(
    'does not restore removed subscriptions after an in-flight refresh %s',
    async (outcome) => {
      const urlA = 'https://a.sjtu.edu.cn/notices.html';
      const urlB = 'https://b.sjtu.edu.cn/notices.html';
      for (const pageUrl of [urlA, urlB]) {
        vi.mocked(fetchNoticePage).mockResolvedValueOnce({
          url: pageUrl,
          body: Buffer.from(sampleHtmlBefore),
          charset: 'utf-8',
          fetchedAt: '2026-11-14T08:00:00.000Z',
        });
        const preview = await previewNoticeSubscription(pageUrl);
        confirmNoticeSubscription(preview.token, 0);
      }
      const subscriptions = getNotificationSubscriptions().notices;
      let resolvePage!: (page: Awaited<ReturnType<typeof fetchNoticePage>>) => void;
      let rejectPage!: (cause: Error) => void;
      vi.mocked(fetchNoticePage)
        .mockClear()
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              resolvePage = resolve;
              rejectPage = reject;
            }),
        );

      const refreshing = refresh();
      await vi.waitFor(() => expect(fetchNoticePage).toHaveBeenCalledTimes(1));
      for (const subscription of subscriptions) deleteNoticeSubscription(subscription.id);
      if (outcome === 'success') {
        resolvePage({
          url: urlA,
          body: Buffer.from(sampleHtmlAfter),
          charset: 'utf-8',
          fetchedAt: '2026-11-14T09:00:00.000Z',
        });
      } else {
        rejectPage(new Error('HTTP 502'));
      }
      const state = await refreshing;

      expect(getNotificationSubscriptions().notices).toEqual([]);
      expect(state.items).toEqual([]);
      expect(
        db.prepare("SELECT * FROM notification_refreshes WHERE source = 'notice'").all(),
      ).toEqual([]);
      expect(fetchNoticePage).toHaveBeenCalledTimes(1);
      expect(systemNotifyItem).not.toHaveBeenCalled();
    },
  );

  it.each(['success', 'failure'] as const)(
    'preserves the baseline when subscriptions are disabled during an in-flight refresh %s',
    async (outcome) => {
      const urlA = 'https://a.sjtu.edu.cn/notices.html';
      const urlB = 'https://b.sjtu.edu.cn/notices.html';
      for (const pageUrl of [urlA, urlB]) {
        vi.mocked(fetchNoticePage).mockResolvedValueOnce({
          url: pageUrl,
          body: Buffer.from(sampleHtmlBefore),
          charset: 'utf-8',
          fetchedAt: '2026-11-14T08:00:00.000Z',
        });
        const preview = await previewNoticeSubscription(pageUrl);
        confirmNoticeSubscription(preview.token, 0);
      }
      const subscriptions = getNotificationSubscriptions().notices;
      let resolvePage!: (page: Awaited<ReturnType<typeof fetchNoticePage>>) => void;
      let rejectPage!: (cause: Error) => void;
      vi.mocked(fetchNoticePage)
        .mockClear()
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              resolvePage = resolve;
              rejectPage = reject;
            }),
        );

      const refreshing = refresh();
      await vi.waitFor(() => expect(fetchNoticePage).toHaveBeenCalledTimes(1));
      setNoticeSubscriptionsEnabled(false);
      if (outcome === 'success') {
        resolvePage({
          url: urlA,
          body: Buffer.from(sampleHtmlAfter),
          charset: 'utf-8',
          fetchedAt: '2026-11-14T09:00:00.000Z',
        });
      } else {
        rejectPage(new Error('HTTP 502'));
      }
      const state = await refreshing;

      expect(state.items).toEqual([]);
      expect(systemNotifyItem).not.toHaveBeenCalled();
      expect(fetchNoticePage).toHaveBeenCalledTimes(1);
      setNoticeSubscriptionsEnabled(true);
      expect(getNotificationSubscriptions().notices).toEqual(subscriptions);
      expect(getNotificationState().items).toHaveLength(4);
      expect(getNotificationState().unreadCount).toBe(0);
    },
  );

  it('toggles built-in JWC subscription while preserving existing JWC rows and read state', async () => {
    db.prepare(
      `INSERT INTO notifications (id, source, account_key, title, body, created_at, read_at, source_unread, href)
       VALUES ('jwc:991', 'jwc', 'students', '选课通知', '', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 1, '{"kind":"jwc","url":"https://jwc.sjtu.edu.cn/info/1222/991.htm"}')`,
    ).run();

    expect(getNotificationState().items.map((item) => item.id)).toEqual(['jwc:991']);

    const disabledState = await setJwcSubscribed(false);
    expect(callNotifications<BuiltInSubscription[]>('subscriptions')).toEqual([
      { id: 'jwc', label: '教务处', url: jwcUrl, enabled: false },
    ]);
    expect(disabledState.items).toEqual([]);
    await refresh();
    expect(refreshJwc).not.toHaveBeenCalled();

    const reenabledState = await setJwcSubscribed(true);
    await refresh();
    expect(refreshJwc).toHaveBeenCalledWith('students', true);
    expect(reenabledState.items).toHaveLength(1);
    expect(reenabledState.items[0]?.readAt).toBe('2026-11-02T00:00:00.000Z');
  });

  it('pauses notice polling and hides notice items when the experiment is disabled', async () => {
    const pageUrl = 'https://cs.sjtu.edu.cn/notices/index.html';
    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: pageUrl,
      body: Buffer.from(sampleHtmlBefore),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T08:00:00.000Z',
    });
    const preview = await previewNoticeSubscription(pageUrl);
    confirmNoticeSubscription(preview.token, 0);
    expect(getNotificationState().items).toHaveLength(2);

    setNoticeSubscriptionsEnabled(false);
    expect(getNotificationState().items).toHaveLength(0);
    expect(getNotificationState().refresh.notice).toBeUndefined();
    await expect(previewNoticeSubscription(pageUrl)).rejects.toThrow('公告订阅功能已关闭');
  });

  it('maps publishedAt precision to created_at sort timestamps without losing original precision', () => {
    expect(entryCreatedAt(null, '2026-11-14T08:00:00.000Z', 2)).toBe('2026-11-14T07:59:59.998Z');
    expect(entryCreatedAt('2026-11-14', '2026-11-14T08:00:00.000Z', 0)).toBe(
      '2026-11-13T16:00:00.000Z',
    );
    expect(entryCreatedAt('2026-11-14T01:02:03.000Z', '2026-11-14T08:00:00.000Z', 0)).toBe(
      '2026-11-14T01:02:03.000Z',
    );
  });
});
