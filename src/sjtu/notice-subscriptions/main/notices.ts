import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fetchNoticePage } from './fetch';
import {
  analyzeNoticePage,
  extractNoticeEntries,
  validateNoticeUrl,
  type NoticeAnalysis,
} from './parser';
import { renderNoticePage } from './render';
import { subscriptionStateSchema, updateSubscription, type SubscriptionState } from './state';
import { hostPorts } from '../../../core/ports';
import {
  deleteNotificationAccount,
  findBuiltInSubscription,
  insertNotificationIfAbsent,
  notificationAccountSummaries,
  saveNotificationRefresh,
  systemNotifyItem,
  type NoticeSource,
  type StoredNotice,
} from '../../../modules/notifications';
import { readSetting, writeSetting } from '../../../modules/settings';
import {
  WEBSITE_NOTICE_SOURCE,
  WEBSITE_SUBSCRIPTIONS_SETTING,
  type NoticePreview,
  type NoticeSubscription,
} from '../contract';

const prefix = 'notice-subscription:';
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
  return readSetting(WEBSITE_SUBSCRIPTIONS_SETTING) !== '0';
}

export function setNoticeSubscriptionsEnabled(enabled: boolean): void {
  if (enabled === noticeSubscriptionsEnabled()) return;
  writeSetting(WEBSITE_SUBSCRIPTIONS_SETTING, enabled ? '1' : '0');
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
  const { counts, refreshes } = notificationAccountSummaries(WEBSITE_NOTICE_SOURCE);
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
        lastSuccessAt: refresh?.lastSuccessAt ?? null,
        entryCount: count?.entryCount ?? 0,
        unreadCount: count?.unreadCount ?? 0,
        error: refresh?.error ?? '订阅状态损坏，请移除后重新添加',
      };
    }
    return {
      id,
      label: displayNoticeSource(state.rule.label, state.rule.pageUrl),
      pageUrl: state.rule.pageUrl,
      acquisition: state.acquisition ?? 'http',
      lastSuccessAt: refresh?.lastSuccessAt ?? state.checkedAt,
      entryCount: count?.entryCount ?? 0,
      unreadCount: count?.unreadCount ?? 0,
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
    entries.forEach((entry, entryIndex) => {
      insertNotificationIfAbsent(
        WEBSITE_NOTICE_SOURCE,
        id,
        `notice:${id}:${entry.id}`,
        entry.title,
        sourceLabel,
        entryCreatedAt(entry.publishedAt, saved.checkedAt, entryIndex),
        { kind: WEBSITE_NOTICE_SOURCE, url: entry.url, publishedAt: entry.publishedAt },
        saved.checkedAt,
      );
    });
    saveNotificationRefresh(WEBSITE_NOTICE_SOURCE, id, null, saved.checkedAt);
  })();
  pendingPreview = null;
}

export function removeNoticeSubscription(id: string): void {
  assertNoticeSubscriptionsEnabled();
  const db = hostPorts().database();
  db.transaction(() => {
    db.prepare('DELETE FROM workspace_settings WHERE key = ?').run(`${prefix}${id}`);
    deleteNotificationAccount(WEBSITE_NOTICE_SOURCE, id);
  })();
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
    saveNotificationRefresh(WEBSITE_NOTICE_SOURCE, id, '订阅状态损坏，请移除后重新添加');
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
      update.newEntries.forEach((entry, index) => {
        const item: StoredNotice = {
          id: `notice:${id}:${entry.id}`,
          source: WEBSITE_NOTICE_SOURCE,
          title: entry.title,
          href: { kind: WEBSITE_NOTICE_SOURCE, url: entry.url, publishedAt: entry.publishedAt },
        };
        const inserted = insertNotificationIfAbsent(
          item.source,
          id,
          item.id,
          item.title,
          sourceLabel,
          entryCreatedAt(entry.publishedAt, nextState.checkedAt, index),
          item.href,
        );
        if (inserted) added.push(item);
      });
      db.prepare('INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)').run(
        `${prefix}${id}`,
        JSON.stringify(nextState),
      );
      saveNotificationRefresh(WEBSITE_NOTICE_SOURCE, id, null, nextState.checkedAt);
    })();
    for (const item of added) systemNotifyItem(item, sourceLabel);
  } catch (error) {
    if (isCurrent()) {
      saveNotificationRefresh(
        WEBSITE_NOTICE_SOURCE,
        id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export const websiteNoticeSource: NoticeSource = {
  id: WEBSITE_NOTICE_SOURCE,
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
