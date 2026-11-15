import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
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
import type {
  NotificationItem,
  NoticePreview,
  NoticeSubscription,
} from '../../shared/notifications';
import { getDatabase } from '../database';
import { experimentEnabled, readSetting, writeSetting } from '../settings/prefs';
import { listUrl as jwcListUrl } from './jwc';
import { systemNotifyItem } from './system';

const prefix = 'notice-subscription:';
const jwcSubscribedKey = 'jwc-subscribed';
const jwcUrl = new URL(jwcListUrl);
const jwcPagePrefix = jwcUrl.pathname.replace(/\.htm$/, '/');

let pendingPreview: {
  token: string;
  acquisition: 'http' | 'rendered';
  body: Buffer;
  charset?: string;
  fetchedAt: string;
  analysis: NoticeAnalysis;
} | null = null;

function assertNoticeSubscriptionsEnabled(): void {
  if (!experimentEnabled('noticeSubscriptions'))
    throw new Error('公告订阅功能已关闭，可在设置 → 通用的试验功能中开启');
}

export function isJwcSubscribed(): boolean {
  return readSetting(jwcSubscribedKey) !== '0';
}

export function setJwcSubscribedPref(enabled: boolean): void {
  writeSetting(jwcSubscribedKey, enabled ? '1' : '0');
}

export function isBuiltinJwcUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== jwcUrl.hostname)
      return false;
    return (
      url.pathname === jwcUrl.pathname ||
      (url.pathname.startsWith(jwcPagePrefix) &&
        /^\d+\.htm$/.test(url.pathname.slice(jwcPagePrefix.length)))
    );
  } catch {
    return false;
  }
}

export function isBuiltinJwcCandidate(pageUrl: string, label: string): boolean {
  try {
    return new URL(pageUrl).hostname === jwcUrl.hostname && label.includes('面向学生的通知');
  } catch {
    return false;
  }
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
  const bundledWorker = resolve(__dirname, 'render-worker.cjs');
  const runtime = existsSync(bundledWorker)
    ? { electronPath: process.execPath, workerPath: bundledWorker }
    : undefined;
  return renderNoticePage(rawUrl, 20_000, runtime);
}

function storedRows(): { id: string; value: string }[] {
  return (
    getDatabase()
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
  const db = getDatabase();
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
    if (!state) {
      return {
        id,
        label: '损坏的订阅',
        pageUrl: '',
        acquisition: 'http',
        lastSuccessAt: refresh?.last_success_at ?? null,
        error: refresh?.error ?? '订阅状态损坏，请移除后重新添加',
      };
    }
    return {
      id,
      label: displayNoticeSource(state.rule.label, state.rule.pageUrl),
      pageUrl: state.rule.pageUrl,
      acquisition: state.acquisition ?? 'http',
      lastSuccessAt: refresh?.last_success_at ?? state.checkedAt,
      error: refresh?.error ?? null,
    };
  });
}

export async function previewNoticeSubscription(
  urlInput: unknown,
  sampleInput?: unknown,
  renderInput?: unknown,
): Promise<NoticePreview> {
  assertNoticeSubscriptionsEnabled();
  const rawUrl = validateNoticeUrl(z.string().trim().min(1).max(2000).parse(urlInput));
  const sampleTitle = z.string().trim().max(500).optional().parse(sampleInput) || undefined;
  const acquisition = z.boolean().optional().parse(renderInput) ? 'rendered' : 'http';
  if (isBuiltinJwcUrl(rawUrl)) throw new Error('教务处通知已内置，请在订阅管理中直接开启“教务处”');
  const page = await acquireNoticePage(rawUrl, acquisition);
  if (isBuiltinJwcUrl(page.url))
    throw new Error('教务处通知已内置，请在订阅管理中直接开启“教务处”');
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
    diagnostics: analysis.diagnostics,
  };
}

export function addNoticeSubscription(tokenInput: unknown, candidateInput: unknown): void {
  assertNoticeSubscriptionsEnabled();
  const token = z.string().uuid().parse(tokenInput);
  const index = z.number().int().min(0).parse(candidateInput);
  if (!pendingPreview || pendingPreview.token !== token)
    throw new Error('预览已过期，请重新预览页面');
  const candidate = pendingPreview.analysis.candidates[index];
  if (!candidate) throw new Error('所选公告栏目无效');
  if (isBuiltinJwcCandidate(candidate.rule.pageUrl, candidate.rule.label))
    throw new Error('教务处“面向学生的通知”已内置，请在订阅管理中直接开启“教务处”');
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
  const db = getDatabase();
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

export function removeNoticeSubscription(idInput: unknown): void {
  assertNoticeSubscriptionsEnabled();
  const id = z.string().min(1).max(200).parse(idInput);
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('DELETE FROM workspace_settings WHERE key = ?').run(`${prefix}${id}`);
    db.prepare("DELETE FROM notifications WHERE source = 'notice' AND account_key = ?").run(id);
    db.prepare(
      "DELETE FROM notification_refreshes WHERE source = 'notice' AND account_key = ?",
    ).run(id);
  })();
}

function saveNoticeError(id: string, error: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO notification_refreshes (source, account_key, last_success_at, error)
       VALUES ('notice', ?, NULL, ?)
       ON CONFLICT(source, account_key) DO UPDATE SET error = excluded.error`,
    )
    .run(id, error);
}

export async function refreshNotices(force = false): Promise<void> {
  if (!experimentEnabled('noticeSubscriptions')) return;
  const db = getDatabase();
  for (const { id, value } of storedRows()) {
    const isCurrent = () =>
      experimentEnabled('noticeSubscriptions') && readSetting(`${prefix}${id}`) === value;
    if (!isCurrent()) continue;
    const previous = parseSubscription(value);
    if (!previous) {
      saveNoticeError(id, '订阅状态损坏，请移除后重新添加');
      continue;
    }
    if (!force && Date.now() < Date.parse(previous.checkedAt) + 20 * 60_000) continue;
    try {
      const acquisition = previous.acquisition ?? 'http';
      const page = await acquireNoticePage(previous.rule.pageUrl, acquisition);
      if (!isCurrent()) continue;
      if (page.url !== previous.rule.pageUrl)
        throw new Error('订阅地址发生重定向，请移除后重新添加');
      const entries = extractNoticeEntries(page.body, previous.rule, page.charset);
      const update = updateSubscription(previous.rule, entries, previous, page.fetchedAt);
      const nextState: SubscriptionState = {
        ...update.state,
        acquisition,
      };
      const sourceLabel = displayNoticeSource(previous.rule.label, previous.rule.pageUrl);
      const added: NotificationItem[] = [];
      db.transaction(() => {
        const insert = db.prepare(`INSERT OR IGNORE INTO notifications
          (id, source, account_key, title, body, created_at, read_at, source_unread, href)
          VALUES (?, 'notice', ?, ?, ?, ?, NULL, 1, ?)`);
        update.newEntries.forEach((entry, index) => {
          const item: NotificationItem = {
            id: `notice:${id}:${entry.id}`,
            source: 'notice',
            category: null,
            count: 1,
            title: entry.title,
            body: sourceLabel,
            createdAt: entryCreatedAt(entry.publishedAt, nextState.checkedAt, index),
            readAt: null,
            href: { kind: 'notice', url: entry.url, publishedAt: entry.publishedAt },
          };
          const result = insert.run(
            item.id,
            id,
            item.title,
            item.body,
            item.createdAt,
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
}
