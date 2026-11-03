import { dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { z } from 'zod';
import type { JwcNotice, NotificationItem } from '../../shared/notifications';
import { getDatabase } from '../database';
import { systemNotifyItem } from './system';

const origin = 'https://jwc.sjtu.edu.cn';
const listUrl = `${origin}/index/mxxsdtz.htm`;
const syncKey = 'jwc-sync';
const accountKey = 'students';
let nextCheckAt = 0;
const notices = new Map<string, JwcNotice>();
let challenge: { token: string; url: string; name: string; cookie: string } | null = null;

interface JwcSync {
  seen: string[];
  etag: string | null;
  modified: string | null;
  checkedAt: number;
}

export function parseJwcList(html: string, pageUrl: string) {
  const $ = load(html);
  const articleIds = [...html.matchAll(/['"]dynclicks_u\d+_(\d+)['"]/g)].map((match) => match[1]);
  const items: NotificationItem[] = [];
  $('.ny_right_con .Newslist > ul > li').each((index, element) => {
    const row = $(element);
    const link = row.find('.wz a');
    const url = new URL(link.attr('href')!, pageUrl);
    const articleId =
      articleIds[index] ??
      url.searchParams.get('wbnewsid') ??
      url.pathname.match(/\/(\d+)\.htm$/)?.[1];
    const title = link.find('h2').text().trim();
    const date = `${row.find('.sj p').text().trim().replace('.', '-')}-${row.find('.sj h2').text().trim().padStart(2, '0')}`;
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !articleId ||
      !title ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    )
      throw new Error('教务处通知列表内容不完整');
    items.push({
      id: `jwc:${articleId}`,
      source: 'jwc',
      category: null,
      count: 1,
      title,
      body: row.find('.wz p').text().trim(),
      createdAt: new Date(`${date}T00:00:00+08:00`).toISOString(),
      readAt: null,
      href: { kind: 'jwc', url: url.href },
    });
  });
  if (!items.length) throw new Error('未能读取教务处通知列表');
  const next = $('.p_next a').attr('href');
  return { items, next: next ? new URL(next, pageUrl).href : null };
}

export async function refreshJwc(force = false): Promise<void> {
  const db = getDatabase();
  const saved = db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get(syncKey) as
    { value: string } | undefined;
  const previous: JwcSync | null = saved ? JSON.parse(saved.value) : null;
  const initialSync = !previous;
  if (
    !force &&
    !initialSync &&
    Date.now() < Math.max(nextCheckAt, (previous?.checkedAt ?? 0) + 20 * 60_000)
  )
    return;
  nextCheckAt = Date.now() + 20 * 60_000;
  try {
    const headers: Record<string, string> = {};
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
    const response = await fetch(listUrl, { headers, signal: AbortSignal.timeout(20_000) });
    const sync: JwcSync = previous ?? {
      seen: [],
      etag: null,
      modified: null,
      checkedAt: 0,
    };
    const added: NotificationItem[] = [];
    if (response.status !== 304) {
      if (!response.ok) throw new Error(`教务处请求失败（${response.status}）`);
      let page = parseJwcList(await response.text(), listUrl);
      const candidates = [...page.items];
      let cutoff: Date | null = null;
      if (initialSync) {
        cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 2);
        cutoff.setHours(0, 0, 0, 0);
        while (
          page.next &&
          page.items.every((item) => Date.parse(item.createdAt) >= cutoff!.getTime())
        ) {
          const pageUrl = page.next;
          if (new URL(pageUrl).origin !== origin) throw new Error('教务处分页地址无效');
          const older = await fetch(pageUrl, { signal: AbortSignal.timeout(20_000) });
          if (!older.ok) throw new Error(`教务处历史通知请求失败（${older.status}）`);
          page = parseJwcList(await older.text(), pageUrl);
          candidates.push(...page.items);
        }
      }
      const seen = new Set(sync.seen);
      for (const item of candidates) {
        if (!seen.has(item.id) && (!cutoff || Date.parse(item.createdAt) >= cutoff.getTime()))
          added.push(item);
        seen.add(item.id);
      }
      sync.seen = [...seen];
      sync.etag = response.headers.get('etag');
      sync.modified = response.headers.get('last-modified');
    }
    sync.checkedAt = Date.now();
    db.transaction(() => {
      const insert = db.prepare(`INSERT OR IGNORE INTO notifications
        (id, source, account_key, title, body, created_at, read_at, source_unread, href)
        VALUES (?, 'jwc', ?, ?, ?, ?, NULL, 1, ?)`);
      for (const item of added)
        insert.run(
          item.id,
          accountKey,
          item.title,
          item.body,
          item.createdAt,
          JSON.stringify(item.href),
        );
      db.prepare('INSERT OR REPLACE INTO workspace_settings (key, value) VALUES (?, ?)').run(
        syncKey,
        JSON.stringify(sync),
      );
      db.prepare(
        `INSERT INTO notification_refreshes (source, account_key, last_success_at, error)
        VALUES ('jwc', ?, ?, NULL) ON CONFLICT(source, account_key) DO UPDATE SET
        last_success_at = excluded.last_success_at, error = NULL`,
      ).run(accountKey, new Date().toISOString());
    })();
    if (!initialSync) for (const item of added) systemNotifyItem(item);
  } catch (error) {
    db.prepare(
      `INSERT INTO notification_refreshes (source, account_key, last_success_at, error)
      VALUES ('jwc', ?, NULL, ?) ON CONFLICT(source, account_key) DO UPDATE SET error = excluded.error`,
    ).run(accountKey, error instanceof Error ? error.message : String(error));
  }
}

export async function getJwcNotice(idInput: unknown): Promise<JwcNotice> {
  const id = z
    .string()
    .regex(/^jwc:\d+$/)
    .parse(idInput);
  const cached = notices.get(id);
  if (cached) return cached;
  const row = getDatabase()
    .prepare("SELECT title, created_at, href FROM notifications WHERE id = ? AND source = 'jwc'")
    .get(id) as { title: string; created_at: string; href: string } | undefined;
  if (!row) throw new Error('通知不存在');
  const { url } = JSON.parse(row.href) as { url: string };
  if (new URL(url).origin !== origin) throw new Error('此通知发布在外部网站，请查看原文');
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`教务处正文请求失败（${response.status}）`);
  const $ = load(await response.text());
  const content = $('.v_news_content');
  if (!content.length) throw new Error('未能读取通知正文，请查看原文');
  const attachments: JwcNotice['attachments'] = [];
  $('.Newslist2 a[href], .v_news_content a[href]').each((_, element) => {
    const link = $(element);
    const target = new URL(link.attr('href')!, url);
    const fileId = target.searchParams.get('wbfileid');
    if (target.origin !== origin || target.pathname !== '/system/_content/download.jsp' || !fileId)
      return;
    if (attachments.some((attachment) => attachment.id === fileId)) return;
    attachments.push({ id: fileId, name: link.text().trim() || '附件', url: target.href });
  });
  const notice = {
    id,
    title: row.title,
    publishedAt: row.created_at,
    url,
    html: content.html()!,
    attachments,
  };
  notices.set(id, notice);
  return notice;
}

export async function getJwcCaptcha(idInput: unknown, attachmentInput: unknown) {
  const notice = await getJwcNotice(idInput);
  const attachmentId = z.string().min(1).parse(attachmentInput);
  const attachment = notice.attachments.find((item) => item.id === attachmentId);
  if (!attachment) throw new Error('附件不存在');
  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('无法打开附件下载页');
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  await response.body?.cancel();
  const image = await fetch(
    `${origin}/system/resource/js/filedownload/createimage.jsp?randnum=${Date.now()}`,
    {
      headers: { Cookie: cookie, Referer: attachment.url },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!image.ok || !image.headers.get('content-type')?.startsWith('image/'))
    throw new Error('验证码加载失败，请重试');
  const imageCookie = image.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const token = randomUUID();
  const bytes = Buffer.from(await image.arrayBuffer());
  challenge = { token, url: attachment.url, name: attachment.name, cookie: imageCookie || cookie };
  return { token, image: `data:image/jpeg;base64,${bytes.toString('base64')}` };
}

export async function downloadJwcAttachment(
  tokenInput: unknown,
  codeInput: unknown,
): Promise<{ status: 'saved' | 'canceled' | 'invalid-code' }> {
  const token = z.string().uuid().parse(tokenInput);
  const code = z
    .string()
    .trim()
    .regex(/^\d{4}$/, '请输入四位验证码')
    .parse(codeInput);
  const current = challenge;
  if (!current || current.token !== token) throw new Error('验证码已过期，请换一张');
  const url = new URL(current.url);
  url.searchParams.set('codeValue', code);
  const response = await fetch(url, {
    headers: { Cookie: current.cookie, Referer: current.url },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`附件下载失败（${response.status}）`);
  if (response.headers.get('content-type')?.includes('text/html')) {
    await response.body?.cancel();
    return { status: 'invalid-code' };
  }
  if (!response.headers.get('content-disposition')?.includes('attachment'))
    throw new Error('服务器没有返回附件文件');
  const bytes = Buffer.from(await response.arrayBuffer());
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: current.name.replace(/[<>:"/\\|?*]/g, '_'),
  });
  if (canceled || !filePath) return { status: 'canceled' };
  await writeFile(filePath, bytes);
  if (challenge?.token === token) challenge = null;
  return { status: 'saved' };
}
