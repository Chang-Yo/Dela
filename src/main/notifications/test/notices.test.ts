import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../todo', () => ({
  getTodoState: () => ({ syncedAt: null, error: null }),
  todoNotifications: () => [],
  canvasOwner: vi.fn(() => null),
  markTodoRead: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../jwc', () => ({
  listUrl: 'https://jwc.sjtu.edu.cn/index/mxxsdtz.htm',
  refreshJwc: vi.fn(),
  getJwcNotice: vi.fn(),
  getJwcCaptcha: vi.fn(),
  downloadJwcAttachment: vi.fn(),
}));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));
vi.mock('../../credentials', () => ({ loadShuiyuanCredential: vi.fn(() => null) }));
vi.mock('../../mail/api', () => ({
  getMailState: vi.fn(() => ({ sync: { phase: 'idle', error: null } })),
  markMailSeen: vi.fn(),
  markAllMailSeen: vi.fn(),
  onMailCacheChanged: vi.fn(),
}));
vi.mock('../../shuiyuan/api', () => ({ listShuiyuanNotifications: vi.fn() }));
vi.mock('../../canvas/api', () => ({
  listTodoCanvasCourses: vi.fn(() => []),
  listCanvasAnnouncements: vi.fn(() => []),
}));
vi.mock('../system', () => ({
  armSystemNotifications: vi.fn(),
  isWorkspaceWindow: () => false,
  systemNotifyItem: vi.fn(),
  NOTIFICATIONS_SNOOZE_KEY: 'notifications-snoozed-until',
}));
vi.mock('../../../../experiments/notice-subscriptions/fetch', () => ({
  fetchNoticePage: vi.fn(),
}));
vi.mock('../../../../experiments/notice-subscriptions/render', () => ({
  renderNoticePage: vi.fn(),
}));

import { fetchNoticePage } from '../../../../experiments/notice-subscriptions/fetch';
import { renderNoticePage } from '../../../../experiments/notice-subscriptions/render';
import { getDatabase } from '../../database';
import { setExperiment } from '../../settings/prefs';
import {
  confirmNoticeSubscription,
  deleteNoticeSubscription,
  getNotificationState,
  getNotificationSubscriptions,
  markAllNotificationsRead,
  refreshNotifications,
  setJwcSubscribed,
} from '..';
import { refreshJwc } from '../jwc';
import {
  displayNoticeSource,
  entryCreatedAt,
  isBuiltinJwcCandidate,
  isBuiltinJwcUrl,
  isJwcSubscribed,
  previewNoticeSubscription,
} from '../notices';
import { systemNotifyItem } from '../system';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE mail_accounts (id INTEGER PRIMARY KEY, address TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE mail_folders (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, special_use TEXT);
    CREATE TABLE mail_messages (id INTEGER PRIMARY KEY, folder_id INTEGER NOT NULL, subject TEXT, sender_name TEXT, sender_address TEXT, snippet TEXT, date TEXT, seen INTEGER NOT NULL, deleted_at TEXT);
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan', 'jwc', 'canvas', 'notice')),
      account_key TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      read_at TEXT,
      source_unread INTEGER NOT NULL DEFAULT 1,
      href TEXT NOT NULL,
      category TEXT,
      count INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE notification_refreshes (
      source TEXT NOT NULL CHECK(source IN ('mail', 'shuiyuan', 'jwc', 'canvas', 'notice')),
      account_key TEXT NOT NULL,
      last_success_at TEXT,
      error TEXT,
      PRIMARY KEY (source, account_key)
    );
  `);
  return db;
}

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

  beforeEach(() => {
    db = createDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.clearAllMocks();
  });

  it('rejects built-in JWC list URLs (and redirects to them) and guides user to the built-in toggle', async () => {
    expect(isBuiltinJwcUrl('https://jwc.sjtu.edu.cn/index/mxxsdtz.htm')).toBe(true);
    expect(isBuiltinJwcUrl('https://jwc.sjtu.edu.cn/index/mxxsdtz/98.htm')).toBe(true);
    expect(isBuiltinJwcUrl('https://jwc.sjtu.edu.cn/xwtg/tztg.htm')).toBe(false);
    expect(isBuiltinJwcCandidate('https://jwc.sjtu.edu.cn/index.htm', '面向学生的通知')).toBe(true);
    expect(isBuiltinJwcCandidate('https://cs.sjtu.edu.cn/index.htm', '面向学生的通知')).toBe(false);
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
    const state = await refreshNotifications(true);
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
    expect(stateAfterConfirm.items[0]).toMatchObject({
      source: 'notice',
      title: '关于2026年秋季学期研究生开题报告的通知',
      href: {
        kind: 'notice',
        url: 'https://cs.sjtu.edu.cn/notices/101.html',
        publishedAt: '2026-10-12',
      },
    });

    vi.mocked(fetchNoticePage).mockResolvedValueOnce({
      url: pageUrl,
      body: Buffer.from(sampleHtmlAfter),
      charset: 'utf-8',
      fetchedAt: '2026-11-14T09:00:00.000Z',
    });

    const stateAfterRefresh = await refreshNotifications(true);
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

    const state = await refreshNotifications(true);
    expect(state.refresh.notice?.error).toContain('HTTP 502');
    expect(state.refresh.notice?.lastSuccessAt).toBe('2026-11-14T09:00:00.000Z');
    expect(state.unreadCount).toBe(1);

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

      const refreshing = refreshNotifications(true);
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

      const refreshing = refreshNotifications(true);
      await vi.waitFor(() => expect(fetchNoticePage).toHaveBeenCalledTimes(1));
      setExperiment('noticeSubscriptions', false);
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
      setExperiment('noticeSubscriptions', true);
      expect(getNotificationSubscriptions().notices).toEqual(subscriptions);
      expect(getNotificationState().items).toHaveLength(4);
      expect(getNotificationState().unreadCount).toBe(0);
    },
  );

  it('passes the live JWC subscription guard to polling and re-enabling', async () => {
    await refreshNotifications(true);
    expect(refreshJwc).toHaveBeenCalledWith(true, isJwcSubscribed);
    const isCurrent = vi.mocked(refreshJwc).mock.calls[0]![1]!;
    expect(isCurrent()).toBe(true);
    await setJwcSubscribed(false);
    expect(isCurrent()).toBe(false);
    await setJwcSubscribed(true);
    expect(refreshJwc).toHaveBeenLastCalledWith(false, isJwcSubscribed);
    expect(isCurrent()).toBe(true);
  });

  it('toggles built-in JWC subscription while preserving existing JWC rows and read state', async () => {
    db.prepare(
      `INSERT INTO notifications (id, source, account_key, title, body, created_at, read_at, source_unread, href)
       VALUES ('jwc:991', 'jwc', 'students', '选课通知', '', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 1, '{"kind":"jwc","url":"https://jwc.sjtu.edu.cn/info/1222/991.htm"}')`,
    ).run();

    expect(getNotificationState().items.map((item) => item.id)).toEqual(['jwc:991']);

    const disabledState = await setJwcSubscribed(false);
    expect(disabledState.items).toEqual([]);
    await refreshNotifications(true);
    expect(refreshJwc).not.toHaveBeenCalled();

    const reenabledState = await setJwcSubscribed(true);
    expect(refreshJwc).toHaveBeenCalledWith(false, isJwcSubscribed);
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

    setExperiment('noticeSubscriptions', false);
    expect(getNotificationState().items).toHaveLength(0);
    expect(getNotificationState().refresh.notice).toBeNull();
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
