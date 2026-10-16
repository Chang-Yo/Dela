import type { BrowserWindow, WebContents } from 'electron';
import { generateKeyPairSync, privateDecrypt, randomBytes, constants } from 'node:crypto';
import { z } from 'zod';
import type {
  ShuiyuanBookmarkItem,
  ShuiyuanCategory,
  ShuiyuanCounts,
  ShuiyuanCustomEmoji,
  ShuiyuanFeed,
  ShuiyuanNotificationItem,
  ShuiyuanPost,
  ShuiyuanSiteStructure,
  ShuiyuanState,
  ShuiyuanTag,
  ShuiyuanTopicDetail,
  ShuiyuanTopicPage,
  ShuiyuanTopicSummary,
  ShuiyuanUpload,
} from '../../shared/api';
import {
  clearShuiyuanCredential,
  loadShuiyuanCredential,
  saveShuiyuanCredential,
} from '../credentials';
import { createCampusLoginWindow, getCampusSession } from '../campus';

export const SHUIYUAN_ORIGIN = 'https://shuiyuan.sjtu.edu.cn';
// 授权页请求形态：不带 auth_redirect，
// 站点在页面内展示加密密文，由用户复制回 Dela 粘贴绑定。read+write：回复与私信需要写权限。
const SHUIYUAN_SCOPES = 'read,write';
const REQUEST_TIMEOUT_MS = 15000;

interface PendingAuth {
  privPem: string;
  clientId: string;
  nonce: string;
}

/** 一次授权的临时私钥状态；仅存主进程内存，被下一次授权替换或随进程退出消失。 */
let pendingAuth: PendingAuth | null = null;
let authWindow: BrowserWindow | null = null;

export function getShuiyuanState(): ShuiyuanState {
  const credential = loadShuiyuanCredential();
  return credential
    ? { connected: true, username: credential.username, boundAt: credential.boundAt }
    : { connected: false, username: null, boundAt: null };
}

export async function startShuiyuanAuth(sender: WebContents): Promise<void> {
  // 水源登录走 jAccount，与课表共用校园 Session，已登录过则无需再次输入。
  await getCampusSession();
  if (authWindow && !authWindow.isDestroyed()) {
    if (authWindow.isMinimized()) authWindow.restore();
    authWindow.show();
    authWindow.focus();
    return;
  }
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clientId = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  const auth = {
    privPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    clientId,
    nonce,
  };
  pendingAuth = auth;
  const authorizeUrl = `${SHUIYUAN_ORIGIN}/user-api-key/new?${new URLSearchParams({
    scopes: SHUIYUAN_SCOPES,
    application_name: 'Dela',
    client_id: clientId,
    nonce,
    public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString().trim(),
  })}`;
  const window = createCampusLoginWindow(sender, '授权水源社区');
  authWindow = window;
  window.on('closed', () => {
    if (authWindow === window) authWindow = null;
  });
  try {
    await window.loadURL(authorizeUrl);
  } catch (error) {
    if (window.isDestroyed()) return;
    if (pendingAuth === auth) pendingAuth = null;
    window.close();
    throw error;
  }
}

const decryptedPayloadSchema = z.object({
  key: z.string().min(1),
  nonce: z.string().min(1),
});

export async function bindShuiyuan(input: unknown): Promise<ShuiyuanState> {
  const payload = z.string().trim().min(1, '请先粘贴授权密文').parse(input).replace(/\s+/g, '');
  const auth = pendingAuth;
  if (!auth) throw new Error('请先点击「登录并授权」发起授权');
  let decrypted: Buffer;
  try {
    decrypted = privateDecrypt(
      { key: auth.privPem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(payload, 'base64'),
    );
  } catch {
    throw new Error('密文解密失败：内容可能复制不完整，请整段重新复制');
  }
  let parsed: z.infer<typeof decryptedPayloadSchema>;
  try {
    parsed = decryptedPayloadSchema.parse(JSON.parse(decrypted.toString('utf8')));
  } catch {
    throw new Error('密文内容无法识别，请重新发起授权');
  }
  if (parsed.nonce !== auth.nonce) {
    throw new Error('密文与本次授权不匹配，请重新点击「登录并授权」后再试');
  }
  const credential = await verifyAndStore(parsed.key, auth.clientId);
  if (pendingAuth === auth) {
    pendingAuth = null;
    authWindow?.close();
  }
  return {
    connected: true,
    username: credential.username,
    boundAt: credential.boundAt,
  };
}

async function verifyAndStore(key: string, clientId: string) {
  let response: Response;
  try {
    response = await fetch(`${SHUIYUAN_ORIGIN}/session/current.json`, {
      headers: { 'User-Api-Key': key, 'User-Api-Client-Id': clientId },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('无法连接水源验证密钥，请检查网络后重试');
  }
  if (!response.ok) throw new Error(`水源拒绝了该密钥（HTTP ${response.status}）`);
  const current = (await response.json().catch(() => null)) as {
    current_user?: { username?: unknown };
  } | null;
  const username = current?.current_user?.username;
  if (typeof username !== 'string' || !username) {
    throw new Error('水源没有返回账号信息，请重新发起授权');
  }
  const credential = {
    key,
    clientId,
    username,
    boundAt: new Date().toISOString(),
  };
  saveShuiyuanCredential(credential);
  return credential;
}

export async function unbindShuiyuan(): Promise<void> {
  const credential = loadShuiyuanCredential();
  if (credential) {
    // 站点没有 key 管理界面，撤销必须在这里完成；失败时保留本地凭据供重试，
    // 否则 key 会变成谁都无法撤销的休眠凭据。
    let response: Response;
    try {
      response = await fetch(`${SHUIYUAN_ORIGIN}/user-api-key/revoke`, {
        method: 'POST',
        headers: {
          'User-Api-Key': credential.key,
          'User-Api-Client-Id': credential.clientId,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error('无法联系水源撤销密钥，请检查网络后重试');
    }
    if (!response.ok && response.status !== 403 && response.status !== 404) {
      throw new Error(`撤销密钥失败（HTTP ${response.status}），请稍后重试`);
    }
  }
  clearShuiyuanCredential();
  pendingAuth = null;
  authWindow?.close();
}

// ---- 数据面 ----

/** 站点把「精品」做成中文 tag；实测仅 `/tag/<中文名>.json` 可过滤（slug 形态 404）。 */
const SHUIYUAN_FEATURED_TAG = '精品';
const STRUCTURE_TTL_MS = 10 * 60 * 1000;
const COUNTS_TTL_MS = 60 * 1000;

const feedInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('latest') }),
  z.object({ kind: z.literal('featured') }),
  z.object({ kind: z.literal('category'), categoryId: z.number().int().positive() }),
  z.object({ kind: z.literal('tag'), tag: z.string().trim().min(1).max(60) }),
  z.object({ kind: z.literal('search'), query: z.string().trim().min(1).max(200) }),
]);
const moreUrlSchema = z
  .string()
  .startsWith('/')
  .max(500)
  .refine((value) => !value.startsWith('//'), '分页地址无效');

/** 水源 topic 的 tags 元素是 {id,name,slug} 对象而非字符串（实测），统一取 name。 */
const rawTagSchema = z.union([
  z.string(),
  z
    .object({ name: z.string() })
    .passthrough()
    .transform((tag) => tag.name),
]);

/** posters[].description 形如 "Original Poster, Most Recent Poster"。 */
const rawPosterSchema = z
  .object({ user_id: z.number().nullish(), description: z.string().nullish() })
  .passthrough();

/** topic_list 顶层 users[]：posters[].user_id 经此查到楼主用户名与头像。 */
const rawUserSchema = z
  .object({
    id: z.number().nullish(),
    username: z.string().nullish(),
    avatar_template: z.string().nullish(),
  })
  .passthrough();

type RawUser = z.infer<typeof rawUserSchema>;

const rawTopicSchema = z
  .object({
    id: z.number(),
    title: z.string().nullish(),
    fancy_title: z.string().nullish(),
    excerpt: z.string().nullish(),
    category_id: z.number().nullish(),
    tags: z.array(rawTagSchema).nullish(),
    posts_count: z.number().nullish(),
    views: z.number().nullish(),
    like_count: z.number().nullish(),
    created_at: z.string().nullish(),
    last_posted_at: z.string().nullish(),
    pinned: z.boolean().nullish(),
    closed: z.boolean().nullish(),
    bookmarked: z.boolean().nullish(),
    archetype: z.string().nullish(),
    last_poster_username: z.string().nullish(),
    posters: z.array(rawPosterSchema).nullish(),
  })
  .passthrough();

const rawPostSchema = z
  .object({
    id: z.number(),
    post_number: z.number(),
    username: z.string(),
    display_username: z.string().nullish(),
    name: z.string().nullish(),
    avatar_template: z.string().nullish(),
    created_at: z.string().nullish(),
    cooked: z.string().nullish(),
    reply_to_post_number: z.number().nullish(),
    yours: z.boolean().nullish(),
    actions_summary: z
      .array(
        z
          .object({
            id: z.number(),
            count: z.number().nullish(),
            acted: z.boolean().nullish(),
            can_act: z.boolean().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

const rawTopicListSchema = z
  .object({
    topic_list: z
      .object({
        topics: z.array(rawTopicSchema).nullish(),
        more_topics_url: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    users: z.array(rawUserSchema).nullish(),
  })
  .passthrough();

const rawDetailSchema = rawTopicSchema.extend({
  post_stream: z
    .object({
      stream: z.array(z.number()).nullish(),
      posts: z.array(rawPostSchema).nullish(),
    })
    .passthrough()
    .nullish(),
});

const rawNotificationSchema = z
  .object({
    id: z.number(),
    notification_type: z.number(),
    read: z.boolean().nullish(),
    high_priority: z.boolean().nullish(),
    created_at: z.string().nullish(),
    topic_id: z.number().nullish(),
    post_number: z.number().nullish(),
    fancy_title: z.string().nullish(),
    data: z
      .object({ display_username: z.string().nullish(), topic_title: z.string().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const rawBookmarkSchema = z
  .object({
    id: z.number(),
    created_at: z.string().nullish(),
    title: z.string().nullish(),
    fancy_title: z.string().nullish(),
    excerpt: z.string().nullish(),
    topic_id: z.number().nullish(),
    bookmarkable_id: z.number().nullish(),
    linked_post_number: z.number().nullish(),
  })
  .passthrough();

function mapTopic(
  raw: z.infer<typeof rawTopicSchema>,
  users: ReadonlyMap<number, RawUser>,
): ShuiyuanTopicSummary {
  // 楼主 = posters 中标注 Original Poster 的那位，缺标注时取第一位。
  const opPoster =
    raw.posters?.find((poster) => poster.description?.includes('Original Poster')) ??
    raw.posters?.[0];
  const author =
    opPoster?.user_id === null || opPoster?.user_id === undefined
      ? undefined
      : users.get(opPoster.user_id);
  return {
    id: raw.id,
    title: raw.title ?? raw.fancy_title ?? '(无标题)',
    excerpt: raw.excerpt ?? null,
    categoryId: raw.category_id ?? null,
    tags: raw.tags ?? [],
    postsCount: raw.posts_count ?? 0,
    views: raw.views ?? null,
    likeCount: raw.like_count ?? null,
    createdAt: raw.created_at ?? '',
    lastPostedAt: raw.last_posted_at ?? null,
    pinned: raw.pinned ?? false,
    closed: raw.closed ?? false,
    bookmarked: raw.bookmarked ?? false,
    archetype: raw.archetype ?? 'regular',
    lastPosterUsername: raw.last_poster_username ?? null,
    authorUsername: author?.username ?? null,
    authorAvatarTemplate: author?.avatar_template ?? null,
  };
}

function usersById(payload: readonly RawUser[] | null | undefined): ReadonlyMap<number, RawUser> {
  const map = new Map<number, RawUser>();
  for (const user of payload ?? []) {
    if (user.id !== null && user.id !== undefined) map.set(user.id, user);
  }
  return map;
}

function mapPost(raw: z.infer<typeof rawPostSchema>): ShuiyuanPost {
  // 帖子点赞数在 actions_summary（id=2 为 like）而非顶层字段。
  const like = raw.actions_summary?.find((action) => action.id === 2);
  return {
    id: raw.id,
    postNumber: raw.post_number,
    username: raw.display_username || raw.username,
    name: raw.name ?? null,
    avatarTemplate: raw.avatar_template ?? null,
    createdAt: raw.created_at ?? '',
    cooked: raw.cooked ?? '',
    replyToPostNumber: raw.reply_to_post_number ?? null,
    likeCount: like?.count ?? null,
    liked: like?.acted ?? false,
    yours: raw.yours ?? false,
  };
}

/** 统一请求：附加 key 头、超时与错误映射。返回解析后的 JSON。 */
async function shuiyuanRequest(path: string, init?: RequestInit): Promise<unknown> {
  const credential = loadShuiyuanCredential();
  if (!credential) throw new Error('尚未绑定水源社区');
  let response: Response;
  try {
    response = await fetch(`${SHUIYUAN_ORIGIN}${path}`, {
      ...init,
      headers: {
        'User-Api-Key': credential.key,
        'User-Api-Client-Id': credential.clientId,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('无法连接水源社区，请检查网络后重试');
  }
  if (response.ok) return response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) {
    throw new Error('水源拒绝了该操作（HTTP 403）：密钥可能已失效或缺少写权限，请重新绑定');
  }
  if (response.status === 429) throw new Error('请求过于频繁，已触发水源限流，请稍后再试');
  const payload = (await response.json().catch(() => null)) as { errors?: string[] } | null;
  const detail = payload?.errors?.join('；');
  throw new Error(detail ? `水源返回错误：${detail}` : `水源接口返回 ${response.status}`);
}

let cachedStructure: { value: ShuiyuanSiteStructure; at: number } | null = null;
let cachedCounts: { value: ShuiyuanCounts; at: number } | null = null;

export async function getShuiyuanSiteStructure(): Promise<ShuiyuanSiteStructure> {
  if (cachedStructure && Date.now() - cachedStructure.at < STRUCTURE_TTL_MS) {
    return cachedStructure.value;
  }
  // 完整分类树来自 site.json（categories.json 不含子分类对象，实测）。
  const site = (await shuiyuanRequest('/site.json')) as {
    categories?: Array<Record<string, unknown>>;
    top_tags?: Array<Record<string, unknown>>;
    custom_emoji?: Array<Record<string, unknown>>;
  } | null;
  const categories: ShuiyuanCategory[] = (site?.categories ?? [])
    .map((raw) => ({
      id: z.number().parse(raw.id),
      name: z.string().parse(raw.name),
      slug: z.string().parse(raw.slug),
      color: typeof raw.color === 'string' ? raw.color : '808281',
      parentId:
        typeof raw.parent_category_id === 'number' ? (raw.parent_category_id as number) : null,
      topicCount: typeof raw.topic_count === 'number' ? (raw.topic_count as number) : null,
    }))
    .filter((category) => category.slug !== 'uncategorized');
  const tags: ShuiyuanTag[] = (site?.top_tags ?? [])
    .map((raw) => ({
      name: typeof raw.name === 'string' ? raw.name : String(raw.id ?? ''),
      topicCount: typeof raw.topic_count === 'number' ? (raw.topic_count as number) : null,
    }))
    .filter((tag) => tag.name);
  const customEmoji: ShuiyuanCustomEmoji[] = (site?.custom_emoji ?? [])
    .map((raw) => ({
      name: typeof raw.name === 'string' ? raw.name : '',
      url: typeof raw.url === 'string' ? raw.url : '',
    }))
    .filter((emoji) => emoji.name && emoji.url);
  cachedStructure = { value: { categories, tags, customEmoji }, at: Date.now() };
  return cachedStructure.value;
}

/** 把 Discourse 返回的 more_topics_url 规整为同源 .json 路径（下一页）。 */
function moreUrlToPath(moreUrl: unknown): string {
  const parsed = moreUrlSchema.parse(moreUrl);
  const url = new URL(parsed, SHUIYUAN_ORIGIN);
  if (url.origin !== SHUIYUAN_ORIGIN) throw new Error('分页地址无效');
  return `${url.pathname.replace(/\.json$/, '')}.json${url.search}`;
}

function mapTopicList(payload: unknown): ShuiyuanTopicPage {
  const parsed = rawTopicListSchema.parse(payload);
  const topics = parsed.topic_list?.topics ?? [];
  const more = parsed.topic_list?.more_topics_url ?? null;
  const users = usersById(parsed.users);
  return { topics: topics.map((raw) => mapTopic(raw, users)), moreUrl: more };
}

export async function listShuiyuanTopics(
  feedInput: unknown,
  moreUrlInput?: unknown,
): Promise<ShuiyuanTopicPage> {
  const feed = feedInputSchema.parse(feedInput) as ShuiyuanFeed;
  const morePath = moreUrlInput === undefined ? null : moreUrlToPath(moreUrlInput);
  if (feed.kind === 'search') {
    // 搜索分页用 page 参数，moreUrl 由这里生成并在下一页原样回传。
    const page = morePath
      ? z
          .number()
          .int()
          .positive()
          .parse(new URL(morePath, SHUIYUAN_ORIGIN).searchParams.get('page') ?? 1)
      : 1;
    return mapSearchResult(
      await shuiyuanRequest(`/search.json?q=${encodeURIComponent(feed.query)}&page=${page}`),
      feed.query,
      page,
    );
  }
  let path: string;
  if (morePath) path = morePath;
  else if (feed.kind === 'latest') path = '/latest.json';
  else if (feed.kind === 'featured')
    path = `/tag/${encodeURIComponent(SHUIYUAN_FEATURED_TAG)}.json`;
  else if (feed.kind === 'tag') path = `/tag/${encodeURIComponent(feed.tag)}.json`;
  else {
    // 类别端点需要 slug；从缓存的分类树里找，未命中时刷新结构。
    const structure = await getShuiyuanSiteStructure();
    const category = structure.categories.find((item) => item.id === feed.categoryId);
    if (!category) throw new Error('该分类不存在，请刷新后重试');
    path = `/c/${category.slug}/${category.id}.json`;
  }
  return mapTopicList(await shuiyuanRequest(path));
}

/** 搜索响应合并 topics 与 posts 摘要为统一列表形态。 */
function mapSearchResult(payload: unknown, query: string, page: number): ShuiyuanTopicPage {
  const parsed = z
    .object({
      topics: z.array(rawTopicSchema).nullish(),
      posts: z
        .array(
          z.object({ topic_id: z.number().nullish(), blurb: z.string().nullish() }).passthrough(),
        )
        .nullish(),
      users: z.array(rawUserSchema).nullish(),
      grouped_search_result: z
        .object({ more_full_page_results: z.boolean().nullish() })
        .passthrough()
        .nullish(),
    })
    .passthrough()
    .parse(payload);
  const blurbs = new Map<number, string>();
  for (const post of parsed.posts ?? []) {
    if (post.topic_id && post.blurb && !blurbs.has(post.topic_id)) {
      blurbs.set(post.topic_id, post.blurb);
    }
  }
  const users = usersById(parsed.users);
  const topics = (parsed.topics ?? []).map((raw) => {
    const topic = mapTopic(raw, users);
    return blurbs.has(topic.id) ? { ...topic, excerpt: blurbs.get(topic.id)! } : topic;
  });
  return {
    topics,
    moreUrl: parsed.grouped_search_result?.more_full_page_results
      ? `/search.json?q=${encodeURIComponent(query)}&page=${page + 1}`
      : null,
  };
}

export async function getShuiyuanTopic(
  idInput: unknown,
  postNumberInput?: unknown,
): Promise<ShuiyuanTopicDetail> {
  const id = z.number().int().positive().parse(idInput);
  const postNumber =
    postNumberInput === undefined ? undefined : z.number().int().positive().parse(postNumberInput);
  const path = postNumber === undefined ? `/t/${id}.json` : `/t/${id}/${postNumber}.json`;
  const parsed = rawDetailSchema.parse(await shuiyuanRequest(path));
  return {
    id: parsed.id,
    title: parsed.title ?? parsed.fancy_title ?? '(无标题)',
    categoryId: parsed.category_id ?? null,
    tags: parsed.tags ?? [],
    postsCount: parsed.posts_count ?? 0,
    likeCount: parsed.like_count ?? null,
    views: parsed.views ?? null,
    createdAt: parsed.created_at ?? '',
    lastPostedAt: parsed.last_posted_at ?? null,
    closed: parsed.closed ?? false,
    archetype: parsed.archetype ?? 'regular',
    bookmarked: parsed.bookmarked ?? false,
    stream: parsed.post_stream?.stream ?? [],
    posts: (parsed.post_stream?.posts ?? []).map(mapPost),
  };
}

export async function loadShuiyuanPosts(
  topicIdInput: unknown,
  postIdsInput: unknown,
): Promise<ShuiyuanPost[]> {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const postIds = z.array(z.number().int().positive()).min(1).max(50).parse(postIdsInput);
  const query = postIds.map((postId) => `post_ids[]=${postId}`).join('&');
  const parsed = z
    .object({ post_stream: z.object({ posts: z.array(rawPostSchema).nullish() }).passthrough() })
    .passthrough()
    .parse(await shuiyuanRequest(`/t/${topicId}/posts.json?${query}`));
  return (parsed.post_stream.posts ?? []).map(mapPost);
}

export async function listShuiyuanBookmarks(): Promise<ShuiyuanBookmarkItem[]> {
  const credential = loadShuiyuanCredential();
  if (!credential) throw new Error('尚未绑定水源社区');
  const parsed = z
    .object({
      user_bookmark_list: z
        .object({ bookmarks: z.array(rawBookmarkSchema).nullish() })
        .passthrough(),
    })
    .passthrough()
    .parse(await shuiyuanRequest(`/u/${encodeURIComponent(credential.username)}/bookmarks.json`));
  return (parsed.user_bookmark_list.bookmarks ?? [])
    .map((raw) => ({
      id: raw.id,
      topicId: raw.topic_id ?? raw.bookmarkable_id ?? 0,
      title: raw.title ?? raw.fancy_title ?? '(无标题)',
      excerpt: raw.excerpt ?? null,
      createdAt: raw.created_at ?? '',
      linkedPostNumber: raw.linked_post_number ?? null,
    }))
    .filter((bookmark) => bookmark.topicId > 0);
}

export async function listShuiyuanMessages(): Promise<ShuiyuanTopicPage> {
  const credential = loadShuiyuanCredential();
  if (!credential) throw new Error('尚未绑定水源社区');
  return mapTopicList(
    await shuiyuanRequest(
      `/topics/private-messages/${encodeURIComponent(credential.username)}.json`,
    ),
  );
}

export async function listShuiyuanNotifications(): Promise<ShuiyuanNotificationItem[]> {
  const parsed = z
    .object({ notifications: z.array(rawNotificationSchema).nullish() })
    .passthrough()
    .parse(await shuiyuanRequest('/notifications.json?recent=true'));
  return (parsed.notifications ?? []).map((raw) => ({
    id: raw.id,
    type: raw.notification_type,
    read: raw.read ?? false,
    highPriority: raw.high_priority ?? false,
    createdAt: raw.created_at ?? '',
    topicId: raw.topic_id ?? null,
    postNumber: raw.post_number ?? null,
    fancyTitle: raw.fancy_title ?? raw.data?.topic_title ?? null,
    displayUsername: raw.data?.display_username ?? null,
  }));
}

export async function markShuiyuanNotificationsRead(): Promise<void> {
  await shuiyuanRequest('/notifications/mark-read', { method: 'PUT' });
  cachedCounts = null;
}

export async function getShuiyuanCounts(): Promise<ShuiyuanCounts> {
  if (cachedCounts && Date.now() - cachedCounts.at < COUNTS_TTL_MS) return cachedCounts.value;
  const parsed = z
    .object({
      current_user: z
        .object({
          unread_notifications: z.number().nullish(),
          unread_private_messages: z.number().nullish(),
        })
        .passthrough()
        .nullish(),
    })
    .passthrough()
    .parse(await shuiyuanRequest('/session/current.json'));
  const value = {
    notifications: parsed.current_user?.unread_notifications ?? 0,
    messages: parsed.current_user?.unread_private_messages ?? 0,
  };
  cachedCounts = { value, at: Date.now() };
  return value;
}

export async function createShuiyuanReply(
  topicIdInput: unknown,
  rawInput: unknown,
  replyToPostNumberInput?: unknown,
): Promise<ShuiyuanPost> {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const raw = z.string().trim().min(1, '回复内容不能为空').max(20000).parse(rawInput);
  // 楼层级回复目标（Discourse reply_to_post_number）；缺省时不传键，即主题级回复。
  const replyToPostNumber =
    replyToPostNumberInput === undefined
      ? undefined
      : z.number().int().positive().max(100000).parse(replyToPostNumberInput);
  const payload = await shuiyuanRequest('/posts.json', {
    method: 'POST',
    body: JSON.stringify({
      topic_id: topicId,
      raw,
      ...(replyToPostNumber === undefined ? {} : { reply_to_post_number: replyToPostNumber }),
    }),
  });
  return mapPost(rawPostSchema.parse(payload));
}

/**
 * 点赞/取消点赞楼层（Discourse post_action_type_id=2）。
 * 2026-09-21 以真实 key 实测：POST /post_actions.json 200；DELETE 被站点 403 拒绝
 * （write scope 不含 post_actions#destroy），取消只能引导用户去网页端操作。
 */
export async function setShuiyuanLiked(postIdInput: unknown, likedInput: unknown): Promise<void> {
  const postId = z.number().int().positive().parse(postIdInput);
  const liked = z.boolean().parse(likedInput);
  if (liked) {
    await shuiyuanRequest('/post_actions.json', {
      method: 'POST',
      body: JSON.stringify({ id: postId, post_action_type_id: 2 }),
    });
  } else {
    await shuiyuanRequest(`/post_actions/${postId}.json?post_action_type_id=2`, {
      method: 'DELETE',
    });
  }
}

const UPLOAD_TIMEOUT_MS = 60000;
const rawUploadSchema = z
  .object({
    short_url: z.string().min(1).nullish(),
    url: z.string().min(1).nullish(),
    original_filename: z.string().nullish(),
  })
  .passthrough();

/**
 * Composer 附件上传（Discourse `POST /uploads.json`）。该端点未实测，站点若
 * 禁用或调整限制则以响应错误暴露。multipart 请求不走 shuiyuanRequest——
 * 那里的 JSON Content-Type 会破坏 multipart 边界。
 */
export async function createShuiyuanUpload(
  fileNameInput: unknown,
  base64Input: unknown,
): Promise<ShuiyuanUpload> {
  const fileName = z.string().trim().min(1).max(255).parse(fileNameInput);
  const base64 = z
    .string()
    .min(1, '附件内容为空')
    .max(28_000_000, '附件超过 20MB，请压缩后再上传')
    .parse(base64Input);
  const credential = loadShuiyuanCredential();
  if (!credential) throw new Error('尚未绑定水源社区');
  const form = new FormData();
  form.append('type', 'composer');
  form.append('files[]', new File([Buffer.from(base64, 'base64')], fileName));
  let response: Response;
  try {
    response = await fetch(`${SHUIYUAN_ORIGIN}/uploads.json`, {
      method: 'POST',
      headers: {
        'User-Api-Key': credential.key,
        'User-Api-Client-Id': credential.clientId,
        Accept: 'application/json',
      },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new Error('上传附件时无法连接水源社区，请检查网络后重试');
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { errors?: string[] } | null;
    const detail = payload?.errors?.join('；');
    if (response.status === 413 || /too large|尺寸|大小/i.test(detail ?? '')) {
      throw new Error('附件超过站点大小限制，请压缩后再上传');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('水源拒绝了上传（HTTP 403）：密钥可能已失效或站点已禁用该能力');
    }
    throw new Error(detail ? `水源返回错误：${detail}` : `上传附件失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  const parsed = rawUploadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('水源返回的附件响应无法识别，请稍后重试');
  const shortUrl = parsed.data.short_url ?? parsed.data.url;
  if (!shortUrl) throw new Error('水源没有返回附件地址，请稍后重试');
  return {
    shortUrl,
    url: parsed.data.url ?? null,
    originalFilename: parsed.data.original_filename ?? fileName,
  };
}

export async function createShuiyuanMessage(
  toInput: unknown,
  titleInput: unknown,
  rawInput: unknown,
): Promise<number> {
  const to = z
    .array(z.string().trim().min(1).max(60))
    .min(1, '请至少填写一位收件人')
    .max(10)
    .parse(toInput);
  const title = z.string().trim().min(1, '请填写私信标题').max(255).parse(titleInput);
  const raw = z.string().trim().min(1, '私信内容不能为空').max(20000).parse(rawInput);
  const payload = await shuiyuanRequest('/posts.json', {
    method: 'POST',
    body: JSON.stringify({
      raw,
      title,
      archetype: 'private_message',
      target_usernames: to,
    }),
  });
  const topicId = rawPostSchema.parse(payload).id;
  cachedCounts = null;
  return topicId;
}

export async function setShuiyuanBookmarked(
  topicIdInput: unknown,
  onInput: unknown,
): Promise<boolean> {
  const topicId = z.number().int().positive().parse(topicIdInput);
  const on = z.boolean().parse(onInput);
  if (on) {
    await shuiyuanRequest('/bookmarks', {
      method: 'POST',
      body: JSON.stringify({ bookmarkable_id: topicId, bookmarkable_type: 'Topic' }),
    });
    return true;
  }
  // 取消收藏需要 bookmark id；从本人收藏列表里按 topic 匹配。
  const bookmark = (await listShuiyuanBookmarks()).find((item) => item.topicId === topicId);
  if (!bookmark) return false;
  await shuiyuanRequest(`/bookmarks/${bookmark.id}`, { method: 'DELETE' });
  return false;
}

export {
  addShuiyuanSourceRef,
  getShuiyuanSourceRef,
  readShuiyuanSource,
  shuiyuanTopicUrl,
} from './sources';
