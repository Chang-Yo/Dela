// 水源本地快照：帖子添加到项目后，后台把全部楼层与图片（原图）存进 userData/shuiyuan-snapshots/<topicId>/，
// 打开来源与 Agent 读取都优先读快照。一次只保存一个帖子，站内请求走后台额度（budget.ts），不挤占前台浏览。
// 进行中的保存写在 <topicId>.partial/，完成后整体换入；中断后重试复用已下载的图片。
// 楼层取齐后按段写出草稿；图片下载只重写发生变化的段落，预览按可见段读取。
// 引用行只是索引：帖子从所有项目移除后由 collectShuiyuanSnapshots 删除快照文件并清空状态列。
import { BrowserWindow } from 'electron';
import { load, type CheerioAPI } from 'cheerio';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { appendFile, copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import type { ShuiyuanPost, ShuiyuanSnapshotState } from '../../shared/api';
import { SHUIYUAN_HOST } from '../../shared/shuiyuan';
import { loadShuiyuanCredential } from '../credentials';
import { getDatabase } from '../database';
import { isWorkspaceWindow, systemNotifyToast } from '../notifications/system';
import { experimentEnabled } from '../settings/prefs';
import { getShuiyuanTopic, loadShuiyuanPosts, SHUIYUAN_ORIGIN } from './api';
import { noteShuiyuanResponse, waitForShuiyuanBackgroundSlot } from './budget';

import {
  encryptSnapshotBytes,
  decryptSnapshotBytes,
  readSnapshotBytes,
  writeSnapshotBytes,
  hasReadableSnapshot,
  imageExtensions,
  snapshotRoot,
  snapshotDir,
  partialDir,
  type SnapshotIndex,
  type ShuiyuanSnapshotPost,
} from './snapshot-files';

const POSTS_PER_REQUEST = 100;
const IMAGE_TIMEOUT_MS = 30_000;
const PROGRESS_INTERVAL_MS = 500;
const DRAFT_INTERVAL_MS = 5_000;
const PENDING_ATTRIBUTE = 'data-snapshot-pending';
const POSTS_FILE = 'posts.ndjson';
const SNAPSHOT_URL = 'dela-resource://shuiyuan-snapshot';
const SNAPSHOT_PAGE_SIZE = 10;

type Progress = NonNullable<ShuiyuanSnapshotState['progress']>;

const queue: number[] = [];
let running: { topicId: number; controller: AbortController } | null = null;
const progress = new Map<number, Progress>();
let progressSentAt = 0;

const referencedTopics = `SELECT CAST(substr(source_id, 16) AS INTEGER) FROM workspace_entries
  WHERE kind = 'source' AND source_id LIKE 'shuiyuan-topic:%'`;

export function shuiyuanSnapshotState(topicId: number): ShuiyuanSnapshotState | null {
  const row = getDatabase()
    .prepare(
      'SELECT snapshot_status, snapshot_at, snapshot_error FROM shuiyuan_topics WHERE topic_id = ?',
    )
    .get(topicId) as
    | {
        snapshot_status: ShuiyuanSnapshotState['status'] | null;
        snapshot_at: string | null;
        snapshot_error: string | null;
      }
    | undefined;
  if (!row?.snapshot_status) return null;
  return {
    topicId,
    status: row.snapshot_status,
    savedAt: row.snapshot_at,
    error: row.snapshot_error,
    progress: progress.get(topicId) ?? null,
  };
}

function broadcast(topicId: number): void {
  const state = shuiyuanSnapshotState(topicId);
  if (!state) return;
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed() && isWorkspaceWindow(window.webContents.getURL()))
      window.webContents.send('shuiyuan:snapshot', state);
}

function reportProgress(topicId: number, value: Progress): void {
  const previous = progress.get(topicId);
  const changed = previous?.phase !== value.phase || previous?.cachedAt !== value.cachedAt;
  progress.set(topicId, value);
  if (!changed && value.done < value.total && Date.now() - progressSentAt < PROGRESS_INTERVAL_MS)
    return;
  progressSentAt = Date.now();
  broadcast(topicId);
}

export function queueShuiyuanSnapshot(topicId: number): void {
  if (queue.includes(topicId)) return;
  if (running?.topicId === topicId && !running.controller.signal.aborted) return;
  getDatabase()
    .prepare(
      "UPDATE shuiyuan_topics SET snapshot_status = 'saving', snapshot_error = NULL WHERE topic_id = ?",
    )
    .run(topicId);
  queue.push(topicId);
  broadcast(topicId);
  void drainQueue();
}

/** 添加到项目时调用：同一帖子已有完整快照（例如已在别的项目里）就不重复保存。 */
export function ensureShuiyuanSnapshot(topicId: number): void {
  const state = shuiyuanSnapshotState(topicId);
  if (state?.status === 'done' && hasReadableSnapshot(topicId)) return;
  queueShuiyuanSnapshot(topicId);
}

export function refreshShuiyuanSnapshot(topicIdInput: unknown): void {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const referenced = getDatabase()
    .prepare(
      `SELECT 1 FROM shuiyuan_topics WHERE topic_id = ? AND topic_id IN (${referencedTopics})`,
    )
    .get(topicId);
  if (!referenced) throw new Error('该水源帖子已不在任何项目中');
  queueShuiyuanSnapshot(topicId);
}

async function drainQueue(): Promise<void> {
  if (running) return;
  for (let topicId = queue.shift(); topicId !== undefined; topicId = queue.shift()) {
    const controller = new AbortController();
    running = { topicId, controller };
    try {
      const savedAt = await saveSnapshot(topicId, controller.signal);
      getDatabase()
        .prepare(
          "UPDATE shuiyuan_topics SET snapshot_status = 'done', snapshot_at = ?, snapshot_error = NULL WHERE topic_id = ?",
        )
        .run(savedAt, topicId);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        getDatabase()
          .prepare(
            "UPDATE shuiyuan_topics SET snapshot_status = 'failed', snapshot_error = ? WHERE topic_id = ?",
          )
          .run(message, topicId);
        const { title } = getDatabase()
          .prepare('SELECT title FROM shuiyuan_topics WHERE topic_id = ?')
          .get(topicId) as { title: string };
        systemNotifyToast(
          '水源快照保存失败',
          `「${title}」：${message}。可在项目中打开该帖子重试。`,
        );
      }
    } finally {
      running = null;
      progress.delete(topicId);
    }
    if (!controller.signal.aborted) broadcast(topicId);
  }
}

async function saveSnapshot(topicId: number, signal: AbortSignal): Promise<string> {
  const partial = partialDir(topicId);
  const detail = await getShuiyuanTopic(topicId, undefined, signal);
  const inStream = new Set(detail.stream);
  const fetched = new Map<number, CachedPost>();
  try {
    for await (const post of readCachedPosts(partial))
      if (inStream.has(post.id)) fetched.set(post.id, post);
  } catch {
    fetched.clear();
    await rm(partial, { recursive: true, force: true });
  }
  await mkdir(join(partial, 'images'), { recursive: true });
  const keep = async (batch: readonly ShuiyuanPost[]) => {
    const fresh = batch.map(
      ({ id, postNumber, username, createdAt, replyToPostNumber, cooked }) =>
        ({ id, postNumber, username, createdAt, replyToPostNumber, cooked }) satisfies CachedPost,
    );
    await appendFile(
      join(partial, POSTS_FILE),
      fresh
        .map((post) => `${encryptSnapshotBytes(JSON.stringify(post)).toString('base64')}\n`)
        .join(''),
    );
    for (const post of fresh) fetched.set(post.id, post);
  };
  await keep(detail.posts);
  const rest = detail.stream.filter((id) => !fetched.has(id));
  const total = Math.max(detail.stream.length, fetched.size);
  reportProgress(topicId, { phase: 'posts', done: fetched.size, total, cachedAt: null });
  for (let index = 0; index < rest.length; index += POSTS_PER_REQUEST) {
    const batch = rest.slice(index, index + POSTS_PER_REQUEST);
    await keep(await loadShuiyuanPosts(topicId, batch, signal));
    reportProgress(topicId, { phase: 'posts', done: fetched.size, total, cachedAt: null });
  }
  const posts = [...fetched.values()].sort((a, b) => a.postNumber - b.postNumber);

  const images = new Map<string, Set<number>>();
  for (let start = 0; start < posts.length; start += SNAPSHOT_PAGE_SIZE) {
    signal.throwIfAborted();
    const batch = posts.slice(start, start + SNAPSHOT_PAGE_SIZE);
    const documents = batch.map((post) => load(post.cooked, null, false));
    const page = start / SNAPSHOT_PAGE_SIZE;
    for (const [url, refs] of collectSnapshotImages(documents)) {
      let pages = images.get(url);
      if (!pages) images.set(url, (pages = new Set()));
      pages.add(page);
      for (const ref of refs) ref.attr(PENDING_ATTRIBUTE, '');
    }
    await writeSnapshotBytes(
      join(partial, `page-${page}.json`),
      JSON.stringify(
        batch.map((post, index) => ({
          postNumber: post.postNumber,
          username: post.username,
          createdAt: post.createdAt,
          replyToPostNumber: post.replyToPostNumber,
          cooked: documents[index]!.html(),
        })),
      ),
    );
    await setImmediate();
  }
  const postCount = posts.length;
  posts.length = 0;
  fetched.clear();
  const updates = new Map<number, Map<string, string | null>>();
  const writeSnapshot = async (): Promise<string> => {
    for (const [page, results] of updates) {
      const batch: ShuiyuanSnapshotPost[] = JSON.parse(
        (await readSnapshotBytes(join(partial, `page-${page}.json`))).toString('utf8'),
      );
      for (const post of batch) {
        const document = load(post.cooked, null, false);
        for (const [url, refs] of collectSnapshotImages([document])) {
          if (!results.has(url)) continue;
          for (const ref of refs) {
            ref.removeAttr(PENDING_ATTRIBUTE);
            const file = results.get(url);
            if (file) pointToLocalImage(ref, `${SNAPSHOT_URL}/${topicId}/${file}`);
          }
        }
        post.cooked = document.html();
      }
      await writeSnapshotBytes(join(partial, `page-${page}.json`), JSON.stringify(batch));
    }
    updates.clear();
    const snapshot: SnapshotIndex = {
      title: detail.title,
      savedAt: new Date().toISOString(),
      postCount,
      pageSize: SNAPSHOT_PAGE_SIZE,
    };
    await writeSnapshotBytes(join(partial, 'index.json'), JSON.stringify(snapshot));
    return snapshot.savedAt;
  };
  let cachedAt = await writeSnapshot();
  const resumed = await imageFiles(join(partial, 'images'));
  const previous = hasReadableSnapshot(topicId)
    ? await imageFiles(join(snapshotDir(topicId), 'images'))
    : new Map<string, string>();
  let done = 0;
  reportProgress(topicId, { phase: 'images', done, total: images.size, cachedAt });
  for (const [url, pages] of images) {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
    let file = resumed.get(hash);
    if (!file && previous.has(hash)) {
      file = previous.get(hash)!;
      await copyFile(join(snapshotDir(topicId), 'images', file), join(partial, 'images', file));
    }
    if (!file) {
      const image = await downloadImage(new URL(url), signal);
      if (image) {
        file = `${hash}.${image.extension}`;
        const target = join(partial, 'images', file);
        await writeSnapshotBytes(target, image.bytes);
      }
    }
    for (const page of pages) {
      let results = updates.get(page);
      if (!results) updates.set(page, (results = new Map()));
      results.set(url, file ?? null);
    }
    if (updates.size >= 20 || Date.now() - Date.parse(cachedAt) >= DRAFT_INTERVAL_MS)
      cachedAt = await writeSnapshot();
    reportProgress(topicId, { phase: 'images', done: ++done, total: images.size, cachedAt });
  }

  const savedAt = await writeSnapshot();
  signal.throwIfAborted();
  await rm(join(partial, POSTS_FILE), { force: true });
  await rm(snapshotDir(topicId), { recursive: true, force: true });
  await rename(partial, snapshotDir(topicId));
  return savedAt;
}

type CachedPost = ShuiyuanSnapshotPost & { id: number };

/** 已取到的楼层逐批追加在 posts.ndjson，重启后只补取缺的；无法解密或记录损坏时重新保存。 */
async function* readCachedPosts(partial: string): AsyncGenerator<CachedPost> {
  const path = join(partial, POSTS_FILE);
  if (!existsSync(path)) {
    await rm(partial, { recursive: true, force: true });
    return;
  }
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      yield JSON.parse(
        decryptSnapshotBytes(Buffer.from(line, 'base64')).toString('utf8'),
      ) as CachedPost;
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

type ImageRef = ReturnType<CheerioAPI>;

/**
 * 剥掉头像（快照不保存头像）与 srcset，图片地址补全为绝对地址；灯箱图取链接指向的原图。
 * 返回按地址去重的待下载图片及引用它们的 img。
 */
export function collectSnapshotImages(documents: CheerioAPI[]): Map<string, ImageRef[]> {
  const images = new Map<string, ImageRef[]>();
  for (const $ of documents) {
    for (const element of $('img').toArray()) {
      const img = $(element);
      const src = img.attr('src') ?? '';
      if (img.hasClass('avatar') || /\/user_avatar\/|letter_avatar/.test(src)) {
        img.remove();
        continue;
      }
      img.removeAttr('srcset').removeAttr('sizes');
      const raw = img.closest('a.lightbox').attr('href') || src;
      if (!raw) continue;
      let url: URL;
      try {
        url = new URL(raw, `${SHUIYUAN_ORIGIN}/`);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      img.attr('src', url.href);
      const refs = images.get(url.href);
      if (refs) refs.push(img);
      else images.set(url.href, [img]);
    }
  }
  return images;
}

/** 渲染层对灯箱图优先取链接地址，换成本地图后去掉链接，点击放大改由 img 自身地址驱动。 */
function pointToLocalImage(img: ImageRef, src: string): void {
  img.attr('src', src);
  img.closest('a.lightbox').removeAttr('href').removeAttr('data-download-href');
}

/** 下载先写 .tmp 再改名，进程中断留下的半截文件不会被当成已下载复用。 */
async function imageFiles(dir: string): Promise<Map<string, string>> {
  const names = await readdir(dir).catch(() => []);
  return new Map(
    names.filter((name) => !name.endsWith('.tmp')).map((name) => [name.split('.')[0]!, name]),
  );
}

/**
 * 站内上传带 key 走后台额度，429 后等待重试；站内 emoji 与站外图匿名直连。
 * 站内连不上视为断网，抛错让整个保存失败；其余失败返回 null，保留原地址。
 */
async function downloadImage(
  url: URL,
  signal: AbortSignal,
): Promise<{ bytes: Buffer; extension: string } | null> {
  const site = url.hostname === SHUIYUAN_HOST;
  const keyed = site && !url.pathname.startsWith('/images/emoji/');
  const credential = keyed ? loadShuiyuanCredential() : null;
  if (keyed && !credential) throw new Error('尚未绑定水源社区');
  for (;;) {
    if (keyed) await waitForShuiyuanBackgroundSlot(signal);
    try {
      const response = await fetch(url, {
        headers: credential
          ? { 'User-Api-Key': credential.key, 'User-Api-Client-Id': credential.clientId }
          : {},
        signal: AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]),
      });
      if (keyed) noteShuiyuanResponse(response);
      if (keyed && response.status === 429) continue;
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const extension = imageExtensions[type];
      if (!response.ok || !extension) return null;
      return { bytes: Buffer.from(await response.arrayBuffer()), extension };
    } catch {
      signal.throwIfAborted();
      if (site) throw new Error('无法连接水源社区，请检查网络后重试');
      return null;
    }
  }
}

/** 帖子从所有项目移除后：取消保存、删除快照文件、清空状态列（引用行保留，重新添加时直接复用）。 */
export async function collectShuiyuanSnapshots(): Promise<void> {
  const db = getDatabase();
  const referenced = new Set(
    (db.prepare(referencedTopics).pluck().all() as number[]).filter(Number.isInteger),
  );
  for (let index = queue.length - 1; index >= 0; index--)
    if (!referenced.has(queue[index]!)) queue.splice(index, 1);
  if (running && !referenced.has(running.topicId)) running.controller.abort();
  db.prepare(
    `UPDATE shuiyuan_topics SET snapshot_status = NULL, snapshot_at = NULL, snapshot_error = NULL
     WHERE snapshot_status IS NOT NULL AND topic_id NOT IN (${referencedTopics})`,
  ).run();
  for (const name of await readdir(snapshotRoot()).catch(() => []))
    if (/^\d+(?:\.partial)?$/.test(name) && !referenced.has(Number.parseInt(name, 10)))
      await rm(join(snapshotRoot(), name), { recursive: true, force: true });
}

/**
 * 启动时：先回收，再续上未完成的保存与文件丢失的快照（例如从不含快照的备份恢复）。
 * 失败的保存等用户手动重试；未绑定或水源关闭时不动。
 */
export async function resumeShuiyuanSnapshots(): Promise<void> {
  await collectShuiyuanSnapshots();
  if (!experimentEnabled('shuiyuan') || !loadShuiyuanCredential()) return;
  const topicIds = getDatabase()
    .prepare(
      `SELECT topic_id FROM shuiyuan_topics
       WHERE topic_id IN (${referencedTopics}) AND snapshot_status IS NOT 'failed'`,
    )
    .pluck()
    .all() as number[];
  for (const topicId of topicIds) ensureShuiyuanSnapshot(topicId);
}
