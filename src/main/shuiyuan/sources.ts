// 水源帖子作为工作区来源：引用行（shuiyuan_topics）的写入与读取，来源正文读本地快照（snapshot-files.ts）。
// 站点请求复用 api.ts。
import { z } from 'zod';
import { getDatabase } from '../database';
import type { DocumentContent, ShuiyuanSourceRef } from '../../shared/api';
import { getShuiyuanSiteStructure, getShuiyuanTopic, SHUIYUAN_ORIGIN } from './api';
import {
  readShuiyuanSnapshot,
  findShuiyuanSnapshot,
  readShuiyuanSnapshotPage,
  type ShuiyuanSnapshotPost,
} from './snapshot-files';
import { shuiyuanSnapshotState } from './snapshot';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type SourceRefRow = {
  topic_id: number;
  title: string;
  url: string;
  excerpt: string | null;
  category_name: string | null;
  author: string | null;
  posts_count: number | null;
  added_at: string;
};

function mapRefRow(row: SourceRefRow): ShuiyuanSourceRef {
  return {
    topicId: row.topic_id,
    title: row.title,
    url: row.url,
    excerpt: row.excerpt,
    categoryName: row.category_name,
    author: row.author,
    postsCount: row.posts_count,
    addedAt: row.added_at,
    snapshot: shuiyuanSnapshotState(row.topic_id),
  };
}

/** 写入/更新引用行，并缓存标题与摘要供离线回退（见 readShuiyuanSource）。 */
export async function addShuiyuanSourceRef(topicIdInput: unknown): Promise<ShuiyuanSourceRef> {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const detail = await getShuiyuanTopic(topicId);
  let categoryName: string | null = null;
  if (detail.categoryId !== null) {
    const structure = await getShuiyuanSiteStructure().catch(() => null);
    categoryName =
      structure?.categories.find((category) => category.id === detail.categoryId)?.name ?? null;
  }
  const first = detail.posts[0];
  const ref: ShuiyuanSourceRef = {
    topicId,
    title: detail.title,
    url: `${SHUIYUAN_ORIGIN}/t/topic/${topicId}`,
    excerpt: stripHtml(first?.cooked ?? '').slice(0, 280) || null,
    categoryName,
    author: first?.username ?? null,
    postsCount: detail.postsCount,
    addedAt: new Date().toISOString(),
    snapshot: shuiyuanSnapshotState(topicId),
  };
  getDatabase()
    .prepare(
      `INSERT INTO shuiyuan_topics (topic_id, title, url, excerpt, category_name, author, posts_count, added_at)
       VALUES (@topicId, @title, @url, @excerpt, @categoryName, @author, @postsCount, @addedAt)
       ON CONFLICT(topic_id) DO UPDATE SET
         title = excluded.title, excerpt = excluded.excerpt,
         category_name = excluded.category_name, author = excluded.author,
         posts_count = excluded.posts_count`,
    )
    .run(ref);
  return ref;
}

/** 水源主题的稳定入口 URL（与引用行一致），供来源引用元数据与外部打开使用。 */
export function shuiyuanTopicUrl(topicIdInput: unknown): string {
  const topicId = z.number().int().positive().parse(topicIdInput);
  return `${SHUIYUAN_ORIGIN}/t/topic/${topicId}`;
}

export function getShuiyuanSourceRef(topicIdInput: unknown): ShuiyuanSourceRef | null {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const row = getDatabase()
    .prepare('SELECT * FROM shuiyuan_topics WHERE topic_id = ?')
    .get(topicId) as SourceRefRow | undefined;
  return row ? mapRefRow(row) : null;
}

/** 楼层合并为一段 HTML，楼层头只留用户名、楼号、日期与回复目标。 */
export function shuiyuanPostsHtml(posts: readonly ShuiyuanSnapshotPost[]): string {
  return posts
    .map((post) => {
      const head = [
        `第 ${post.postNumber} 楼`,
        escapeHtml(post.createdAt.slice(0, 10)),
        ...(post.replyToPostNumber ? [`回复第 ${post.replyToPostNumber} 楼`] : []),
      ].join(' · ');
      return `<section class="dela-post"><header class="dela-post-head"><b>${escapeHtml(
        post.username,
      )}</b><span>· ${head}</span></header>${post.cooked}</section>`;
    })
    .join('\n');
}

function sourceExcerpt(topicId: number): DocumentContent {
  const ref = getShuiyuanSourceRef(topicId);
  if (!ref) throw new Error('该水源帖子引用不存在');
  return { title: ref.title, format: 'text', text: ref.excerpt ?? '', url: ref.url };
}

export async function readShuiyuanSourcePreview(topicIdInput: unknown): Promise<DocumentContent> {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const selected = await findShuiyuanSnapshot(topicId);
  if (!selected) return sourceExcerpt(topicId);
  const { index } = selected;
  return {
    title: index.title,
    format: 'html',
    url: shuiyuanTopicUrl(topicId),
    updatedAt: index.savedAt,
    shuiyuanSnapshot: { postCount: index.postCount, pageSize: index.pageSize },
  };
}

export async function readShuiyuanSource(topicIdInput: unknown): Promise<DocumentContent> {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const snapshot = await readShuiyuanSnapshot(topicId);
  if (!snapshot) return sourceExcerpt(topicId);
  return {
    title: snapshot.title,
    format: 'html',
    text: shuiyuanPostsHtml(snapshot.posts),
    url: shuiyuanTopicUrl(topicId),
    updatedAt: snapshot.savedAt,
  };
}

export async function readShuiyuanSourcePage(
  topicIdInput: unknown,
  pageInput: unknown,
): Promise<string> {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const page = z.number().int().nonnegative().parse(pageInput);
  return shuiyuanPostsHtml(await readShuiyuanSnapshotPage(topicId, page));
}
