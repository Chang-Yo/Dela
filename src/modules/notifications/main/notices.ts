import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fetchNoticePage } from './notice-subscriptions/fetch';
import {
  analyzeNoticePage,
  extractNoticeEntries,
  validateNoticeUrl,
  type NoticeAnalysis,
} from './notice-subscriptions/parser';
import { renderNoticePage } from './notice-subscriptions/render';
import {
  subscriptionStateSchema,
  updateSubscription,
  type SubscriptionState,
} from './notice-subscriptions/state';
import { hostPorts } from '../../../core/ports';
import { readSetting, writeSetting } from '../../settings';
import type { NoticePreview, NoticeSubscription } from '../contract';
import {
  findBuiltInSubscription,
  systemNotifyItem,
  type NoticeSource,
  type StoredNotice,
} from './store';

const prefix = 'notice-subscription:';
const experimentKey = 'experimental-notice-subscriptions';
let enableGeneration = 0;

let pendingPreview: {
  token: string;
  acquisition: 'http' | 'rendered';
  body: Buffer;
  charset?: string;
  fetchedAt: string;
  analysis: NoticeAnalysis;
} | null = null;

export function noticeSubscriptionsEnabled(): boolean {
  return readSetting(experimentKey) !== '0';
}

export function setNoticeSubscriptionsEnabled(enabled: boolean): void {
  if (enabled === noticeSubscriptionsEnabled()) return;
  writeSetting(experimentKey, enabled ? '1' : '0');
  enableGeneration++;
  pendingPreview = null;
}

function assertNoticeSubscriptionsEnabled(): void {
  if (!noticeSubscriptionsEnabled()) throw new Error('公告订阅功能已关闭，可在订阅管理中开启');
}

function assertNotBuiltIn(url: string, label?: string): void {
  const builtIn = findBuiltInSubscription(url, label);
  if (builtIn) throw new Error(`${builtIn}通知已内置，请在订阅管理中开启`);
}

export function displayNoticeSource(label: string, pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    return host && !label.includes(host) ? `${label} · ${host}` : label;
  } catch {
    return label;
  }
}

export function entryCreatedAt(publishedAt: string | null, checkedAt: string, index = 0): string {
  if (publishedAt === null) return new Date(Date.parse(checkedAt) - index).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(publishedAt))
    return new Date(`${publishedAt}T00:00:00+08:00`).toISOString();
  return publishedAt;
}

async function acquireNoticePage(rawUrl: string, acquisition: 'http' | 'rendered') {
  if (acquisition === 'http') return fetchNoticePage(rawUrl);
  return renderNoticePage(rawUrl, 20_000, {
    electronPath: process.execPath,
    workerPath: resolve(__dirname, 'render-worker.cjs'),
  });
}

function storedRows(): { id: string; value: string }[] {
  return (
    hostPorts()
      .database()
      .prepare('SELECT key, value FROM workspace_settings WHERE key LIKE ? ORDER BY rowid ASC')
      .all(`${prefix}%`) as { key: string; value: string }[]
  ).map((row) => ({ id: row.key.slice(prefix.length), value: row.value }));
}

function parseSubscription(raw: string): SubscriptionState | null {
  try {
    const parsed = subscriptionStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function noticeSubscriptionIds(): string[] {
  return storedRows().map((row) => row.id);
}

export function listNoticeSubscriptions(): NoticeSubscription[] {
  const db = hostPorts().database();
  const counts = new Map(
    (
      db
        .prepare(
          `SELECT account_key, COUNT(*) AS total,
        SUM(read_at IS NULL AND source_unread = 1) AS unread
        FROM notifications WHERE source = 'notice' GROUP BY account_key`,
        )
        .all() as {
        account_key: string;
        total: number;
        unread: number;
      }[]
    ).map((row) => [row.account_key, row]),
  );
  const refreshes = new Map(
    (
      db
        .prepare(
          "SELECT account_key, last_success_at, error FROM notification_refreshes WHERE source = 'notice'",
        )
        .all() as { account_key: string; last_success_at: string | null; error: string | null }[]
    ).map((row) => [row.account_key, row]),
  );
  return storedRows().map(({ id, value }) => {
    const state = parseSubscription(value);
    const refresh = refreshes.get(id);
    const count = counts.get(id);
    if (!state) {
      return {
        id,
        label: '损坏的订阅',
        pageUrl: '',
        acquisition: 'http',
        lastSuccessAt: refresh?.last_success_at ?? null,
        entryCount: count?.total ?? 0,
        unreadCount: count?.unread ?? 0,
        error: refresh?.error ?? '订阅状态损坏，请移除后重新添加',
      };
    }
    return {
      id,
      label: displayNoticeSource(state.rule.label, state.rule.pageUrl),
      pageUrl: state.rule.pageUrl,
      acquisition: state.acquisition ?? 'http',
      lastSuccessAt: refresh?.last_success_at ?? state.checkedAt,
      entryCount: count?.total ?? 0,
      unreadCount: count?.unread ?? 0,
      error: refresh?.error ?? null,
    };
  });
}

export async function previewNoticeSubscription(
  urlInput: string,
  sampleTitle?: string,
  render = false,
): Promise<NoticePreview> {
  assertNoticeSubscriptionsEnabled();
  const generation = enableGeneration;
  const rawUrl = validateNoticeUrl(urlInput);
  const acquisition = render ? 'rendered' : 'http';
  assertNotBuiltIn(rawUrl);
  const page = await acquireNoticePage(rawUrl, acquisition);
  if (generation !== enableGeneration) throw new Error('公告订阅设置已变更，请重新预览');
  assertNotBuiltIn(page.url);
  const analysis = analyzeNoticePage(page.body, page.url, {
    sampleTitle,
    charset: page.charset,
  });
  if (acquisition === 'rendered') {
    analysis.diagnostics = analysis.diagnostics.filter(
      (message) => message !== '本次仅分析服务器 HTML，未执行页面 JavaScript',
    );
    analysis.diagnostics.push(
      '已执行页面 JavaScript；DOM 稳定为限时启发式，不保证所有异步内容加载完成',
    );
  }
  const token = randomUUID();
  pendingPreview = {
    token,
    acquisition,
    body: page.body,
    charset: page.charset,
    fetchedAt: page.fetchedAt,
    analysis,
  };
  return {
    token,
    pageUrl: analysis.pageUrl,
    title: analysis.title,
    acquisition,
    status: analysis.status,
    candidates: analysis.candidates.map((candidate) => ({
      label: candidate.label,
      reasons: candidate.reasons,
      entries: candidate.entries.map(({ title, url, publishedAt }) => ({
        title,
        url,
        publishedAt,
      })),
    })),
    feeds: analysis.feeds,
    sectionLinks: analysis.sectionLinks,
    diagnostics: analysis.diagnostics,
  };
}

export function addNoticeSubscription(token: string, index: number): void {
  assertNoticeSubscriptionsEnabled();
  if (!pendingPreview || pendingPreview.token !== token)
    throw new Error('预览已过期，请重新预览页面');
  const candidate = pendingPreview.analysis.candidates[index];
  if (!candidate) throw new Error('所选公告栏目无效');
  assertNotBuiltIn(candidate.rule.pageUrl, candidate.rule.label);
  for (const { value } of storedRows()) {
    const existing = parseSubscription(value);
    if (existing && isDeepStrictEqual(existing.rule, candidate.rule))
      throw new Error('已订阅该栏目，无需重复添加');
  }
  const entries = extractNoticeEntries(pendingPreview.body, candidate.rule, pendingPreview.charset);
  const { state } = updateSubscription(candidate.rule, entries, null, pendingPreview.fetchedAt);
  const saved: SubscriptionState = { ...state, acquisition: pendingPreview.acquisition };
  const id = randomUUID();
  const sourceLabel = displayNoticeSource(candidate.rule.label, candidate.rule.pageUrl);
  const db = hostPorts().database();
  db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)').run(
      `${prefix}${id}`,
      JSON.stringify(saved),
    );
    const insert = db.prepare(`INSERT OR IGNORE INTO notifications
      (id, source, account_key, title, body, created_at, read_at, source_unread, href)
      VALUES (?, 'notice', ?, ?, ?, ?, ?, 1, ?)`);
    entries.forEach((entry, entryIndex) => {
      insert.run(
        `notice:${id}:${entry.id}`,
        id,
        entry.title,
        sourceLabel,
        entryCreatedAt(entry.publishedAt, saved.checkedAt, entryIndex),
        saved.checkedAt,
        JSON.stringify({ kind: 'notice', url: entry.url, publishedAt: entry.publishedAt }),
      );
    });
    db.prepare(
      `INSERT INTO notification_refreshes (source, account_key, last_success_at, error)
       VALUES ('notice', ?, ?, NULL)
       ON CONFLICT(source, account_key) DO UPDATE SET
         last_success_at = excluded.last_success_at, error = NULL`,
    ).run(id, saved.checkedAt);
  })();
  pendingPreview = null;
}

export function removeNoticeSubscription(id: string): void {
  assertNoticeSubscriptionsEnabled();
  const db = hostPorts().database();
  db.transaction(() => {
    db.prepare('DELETE FROM workspace_settings WHERE key = ?').run(`${prefix}${id}`);
    db.prepare("DELETE FROM notifications WHERE source = 'notice' AND account_key = ?").run(id);
    db.prepare(
      "DELETE FROM notification_refreshes WHERE source = 'notice' AND account_key = ?",
    ).run(id);
  })();
}

function saveNoticeError(id: string, error: string): void {
  hostPorts()
    .database()
    .prepare(
      `INSERT INTO notification_refreshes (source, account_key, last_success_at, error)
       VALUES ('notice', ?, NULL, ?)
       ON CONFLICT(source, account_key) DO UPDATE SET error = excluded.error`,
    )
    .run(id, error);
}

async function refreshNotice(id: string, force: boolean): Promise<void> {
  if (!noticeSubscriptionsEnabled()) return;
  const value = readSetting(prefix + id);
  if (value === undefined) return;
  const generation = enableGeneration;
  const isCurrent = () => generation === enableGeneration && readSetting(prefix + id) === value;
  const db = hostPorts().database();
  const previous = parseSubscription(value);
  if (!previous) {
    saveNoticeError(id, '订阅状态损坏，请移除后重新添加');
    return;
  }
  if (!force && Date.now() < Date.parse(previous.checkedAt) + 20 * 60_000) return;
  try {
    const acquisition = previous.acquisition ?? 'http';
    const page = await acquireNoticePage(previous.rule.pageUrl, acquisition);
    if (!isCurrent()) return;
    if (page.url !== previous.rule.pageUrl) throw new Error('订阅地址发生重定向，请移除后重新添加');
    const entries = extractNoticeEntries(page.body, previous.rule, page.charset);
    const update = updateSubscription(previous.rule, entries, previous, page.fetchedAt);
    const nextState: SubscriptionState = {
      ...update.state,
      acquisition,
    };
    const sourceLabel = displayNoticeSource(previous.rule.label, previous.rule.pageUrl);
    const added: StoredNotice[] = [];
    db.transaction(() => {
      const insert = db.prepare(`INSERT OR IGNORE INTO notifications
        (id, source, account_key, title, body, created_at, read_at, source_unread, href)
        VALUES (?, 'notice', ?, ?, ?, ?, NULL, 1, ?)`);
      update.newEntries.forEach((entry, index) => {
        const item: StoredNotice = {
          id: `notice:${id}:${entry.id}`,
          source: 'notice',
          title: entry.title,
          href: { kind: 'notice', url: entry.url, publishedAt: entry.publishedAt },
        };
        const result = insert.run(
          item.id,
          id,
          item.title,
          sourceLabel,
          entryCreatedAt(entry.publishedAt, nextState.checkedAt, index),
          JSON.stringify(item.href),
        );
        if (result.changes > 0) added.push(item);
      });
      db.prepare('INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)').run(
        `${prefix}${id}`,
        JSON.stringify(nextState),
      );
      db.prepare(
        `INSERT INTO notification_refreshes (source, account_key, last_success_at, error)
         VALUES ('notice', ?, ?, NULL)
         ON CONFLICT(source, account_key) DO UPDATE SET
           last_success_at = excluded.last_success_at, error = NULL`,
      ).run(id, nextState.checkedAt);
    })();
    for (const item of added) systemNotifyItem(item, sourceLabel);
  } catch (error) {
    if (isCurrent()) saveNoticeError(id, error instanceof Error ? error.message : String(error));
  }
}

export const websiteNoticeSource: NoticeSource = {
  id: 'notice',
  account: () => (noticeSubscriptionsEnabled() ? noticeSubscriptionIds() : null),
  refresh: refreshNotice,
  link: ({ url, publishedAt }) => {
    if (typeof url !== 'string') return null;
    try {
      return {
        target: { url: validateNoticeUrl(url) },
        publishedAt: typeof publishedAt === 'string' ? publishedAt : null,
      };
    } catch {
      return null;
    }
  },
};
