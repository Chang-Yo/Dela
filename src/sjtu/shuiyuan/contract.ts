import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export const SHUIYUAN_HOST = 'shuiyuan.sjtu.edu.cn';

export const SHUIYUAN_SOURCE_PREFIX = 'shuiyuan-topic:';

export interface ShuiyuanTopicLink {
  readonly topicId: number;
  readonly postNumber?: number;
}

/** 识别 Discourse 的 /t/<id> 与 /t/<slug>/<id>/<post> 绝对链接。 */
export function shuiyuanTopicFromUrl(value: string): ShuiyuanTopicLink | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname !== SHUIYUAN_HOST ||
      url.username ||
      url.password
    )
      return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 't') return null;
    const idIndex = /^\d+$/.test(parts[1] ?? '') ? 1 : /^\d+$/.test(parts[2] ?? '') ? 2 : -1;
    if (idIndex < 0 || parts.length > idIndex + 2) return null;
    const topicId = Number(parts[idIndex]);
    const postNumber = /^\d+$/.test(parts[idIndex + 1] ?? '')
      ? Number(parts[idIndex + 1])
      : undefined;
    if (!Number.isSafeInteger(topicId) || topicId <= 0) return null;
    if (postNumber !== undefined && (!Number.isSafeInteger(postNumber) || postNumber <= 0))
      return null;
    return postNumber === undefined ? { topicId } : { topicId, postNumber };
  } catch {
    return null;
  }
}

export interface ShuiyuanState {
  readonly connected: boolean;
  readonly username: string | null;
  readonly boundAt: string | null;
}

export interface ShuiyuanTopicSummary {
  readonly id: number;
  readonly title: string;
  readonly excerpt: string | null;
  readonly categoryId: number | null;
  readonly tags: readonly string[];
  readonly postsCount: number;
  readonly views: number | null;
  readonly likeCount: number | null;
  readonly createdAt: string;
  readonly lastPostedAt: string | null;
  readonly pinned: boolean;
  readonly closed: boolean;
  readonly bookmarked: boolean;
  readonly archetype: string;
  readonly lastPosterUsername: string | null;
  /** 楼主用户名与头像模板：posters[] 联查 topic_list 顶层 users[] 得到，可能缺省。 */
  readonly authorUsername: string | null;
  readonly authorAvatarTemplate: string | null;
}

export interface ShuiyuanTopicPage {
  readonly topics: readonly ShuiyuanTopicSummary[];
  /** Discourse `more_topics_url`；null 表示没有下一页。翻页时原样回传。 */
  readonly moreUrl: string | null;
}

export interface ShuiyuanPost {
  readonly id: number;
  readonly postNumber: number;
  readonly username: string;
  readonly name: string | null;
  readonly avatarTemplate: string | null;
  readonly createdAt: string;
  /** 服务端消毒后的楼层 HTML（cooked），渲染前仍走本应用沙箱管线。 */
  readonly cooked: string;
  readonly replyToPostNumber: number | null;
  readonly likeCount: number | null;
  /** 当前用户是否已点赞（actions_summary id=2 acted）。 */
  readonly liked: boolean;
  readonly yours: boolean;
}

export interface ShuiyuanTopicDetail {
  readonly id: number;
  readonly title: string;
  readonly categoryId: number | null;
  readonly tags: readonly string[];
  readonly postsCount: number;
  /** 最大楼号；删楼后会大于 postsCount，楼层进度按它换算。 */
  readonly highestPostNumber: number;
  readonly likeCount: number | null;
  readonly views: number | null;
  readonly createdAt: string;
  readonly lastPostedAt: string | null;
  readonly closed: boolean;
  readonly archetype: string;
  readonly bookmarked: boolean;
  /** 楼层 post id 全量；`posts` 为已加载的前段。 */
  readonly stream: readonly number[];
  readonly posts: readonly ShuiyuanPost[];
}

export interface ShuiyuanCategory {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly color: string;
  readonly parentId: number | null;
  readonly topicCount: number | null;
}

export interface ShuiyuanTag {
  readonly name: string;
  readonly topicCount: number | null;
}

/** 站点自定义 emoji（site.json custom_emoji）；标题里内联为远程图片。 */
export interface ShuiyuanCustomEmoji {
  readonly name: string;
  readonly url: string;
}

export interface ShuiyuanSiteStructure {
  readonly categories: readonly ShuiyuanCategory[];
  readonly tags: readonly ShuiyuanTag[];
  readonly customEmoji: readonly ShuiyuanCustomEmoji[];
}

export interface ShuiyuanNotificationItem {
  readonly id: number;
  readonly type: number;
  readonly count: number;
  readonly read: boolean;
  readonly highPriority: boolean;
  readonly createdAt: string;
  readonly topicId: number | null;
  readonly postNumber: number | null;
  readonly fancyTitle: string | null;
  readonly displayUsername: string | null;
  readonly originalPostId: number | null;
}

export interface ShuiyuanBookmarkItem {
  readonly id: number;
  readonly topicId: number;
  readonly title: string;
  readonly excerpt: string | null;
  readonly createdAt: string;
  readonly linkedPostNumber: number | null;
}

export type ShuiyuanFeed =
  | { readonly kind: 'latest' }
  | { readonly kind: 'featured' }
  | { readonly kind: 'category'; readonly categoryId: number }
  | { readonly kind: 'tag'; readonly tag: string }
  | { readonly kind: 'search'; readonly query: string };

export interface ShuiyuanCounts {
  readonly notifications: number;
  readonly messages: number;
}

export interface ShuiyuanSourceRef {
  readonly topicId: number;
  readonly title: string;
  readonly url: string;
  readonly excerpt: string | null;
  readonly categoryName: string | null;
  readonly author: string | null;
  readonly postsCount: number | null;
  readonly addedAt: string;
  readonly snapshot: ShuiyuanSnapshotState | null;
}

/** 本地快照的保存状态；更新快照期间 savedAt 仍指向可读的旧快照。 */
export interface ShuiyuanSnapshotState {
  readonly topicId: number;
  readonly status: 'saving' | 'done' | 'failed';
  readonly savedAt: string | null;
  readonly error: string | null;
  readonly progress: {
    readonly phase: 'posts' | 'images';
    readonly done: number;
    readonly total: number;
    /** 本次保存最近一次写出可读草稿的时间；楼层还没取齐时为 null。 */
    readonly cachedAt: string | null;
  } | null;
}

/** Composer 附件上传结果；shortUrl 为 upload:// 形态，可直接写进 Markdown。 */
export interface ShuiyuanUpload {
  readonly shortUrl: string;
  readonly url: string | null;
  readonly originalFilename: string | null;
  /** 图片的显示尺寸（Discourse thumbnail_width/height），写进 `![名|宽x高]` 供站点排版。 */
  readonly width: number | null;
  readonly height: number | null;
}

const id = z.number().int().positive();

export const shuiyuanContract = defineContract(
  'shuiyuan',
  {
    state: { input: z.undefined(), output: z.custom<ShuiyuanState>() },
    startAuth: { input: z.undefined(), output: z.void() },
    /** 解密并校验用户粘贴的密文，成功后保存 User API Key 并返回绑定状态。 */
    bind: { input: z.string().max(8192), output: z.custom<ShuiyuanState>() },
    unbind: { input: z.undefined(), output: z.void() },
    siteStructure: { input: z.undefined(), output: z.custom<ShuiyuanSiteStructure>() },
    /** 主题列表；moreUrl 是上一页返回的下一页地址。 */
    topics: {
      input: z.object({ feed: z.custom<ShuiyuanFeed>(), moreUrl: z.string().optional() }),
      output: z.custom<ShuiyuanTopicPage>(),
    },
    /** 主题详情；postNumber 提供时从该楼附近加载（通知深链）。 */
    topic: {
      input: z.object({ id, postNumber: id.optional() }),
      output: z.custom<ShuiyuanTopicDetail>(),
    },
    /** 按 post id 分段加载楼层（长帖加载更多）。 */
    posts: {
      input: z.object({ topicId: id, postIds: z.array(id).max(100) }),
      output: z.custom<ShuiyuanPost[]>(),
    },
    /** 按 post id 定位所在主题与楼层（合并点赞通知只带 post id）。 */
    locatePost: { input: id, output: z.custom<ShuiyuanTopicLink>() },
    bookmarks: { input: z.undefined(), output: z.custom<ShuiyuanBookmarkItem[]>() },
    messages: { input: z.undefined(), output: z.custom<ShuiyuanTopicPage>() },
    notifications: { input: z.undefined(), output: z.custom<ShuiyuanNotificationItem[]>() },
    markNotificationsRead: { input: z.undefined(), output: z.void() },
    /** 未读计数（主进程 60s 内存缓存）。 */
    counts: { input: z.undefined(), output: z.custom<ShuiyuanCounts>() },
    /** 回复主题或私信会话，返回新楼层；replyToPostNumber 为楼层级回复目标。 */
    reply: {
      input: z.object({ topicId: id, raw: z.string(), replyToPostNumber: id.optional() }),
      output: z.custom<ShuiyuanPost>(),
    },
    /** 上传 Composer 附件（Discourse /uploads.json，未实测）；站点调整限制时以错误暴露。 */
    upload: {
      input: z.object({ fileName: z.string(), base64: z.string() }),
      output: z.custom<ShuiyuanUpload>(),
    },
    message: {
      input: z.object({ to: z.array(z.string()), title: z.string(), raw: z.string() }),
      output: z.number(),
    },
    setBookmarked: {
      input: z.object({ topicId: id, on: z.boolean() }),
      output: z.boolean(),
    },
    /**
     * 点赞楼层。实测（2026-09-21）：取消点赞被站点以 403 拒绝（User API Key 不含
     * post_actions#destroy），已点赞只能去网页端撤销。
     */
    setLiked: { input: z.object({ postId: id, liked: z.boolean() }), output: z.void() },
    addSourceRef: { input: id, output: z.custom<ShuiyuanSourceRef>() },
    sourceRef: { input: id, output: z.custom<ShuiyuanSourceRef | null>() },
    snapshotPage: {
      input: z.object({ topicId: id, page: z.number().int().nonnegative() }),
      output: z.string(),
    },
    /** 重新保存快照（失败重试与手动更新共用）；帖子须仍在某个项目里。 */
    refreshSnapshot: { input: id, output: z.void() },
    /** 在系统浏览器打开原帖，不经应用内链接分流。 */
    openInBrowser: { input: id, output: z.void() },
  },
  {
    /** 快照保存状态变了：只让 sourceRef 读取过期。 */
    sourceRef: z.undefined(),
    /** 某个帖子的快照保存结束（成功或失败）时推送一次，用于提示。 */
    snapshotEnded: z.custom<{
      topicId: number;
      title: string;
      status: 'done' | 'failed';
      error: string | null;
    }>(),
    /** 主进程把站内主题链接（聊天、邮件、文档等处点击）交回应用内阅读。 */
    openTopic: z.custom<ShuiyuanTopicLink>(),
  },
);

declare module '../../app/module' {
  interface NavTargets {
    /** postId 是合并点赞所在的帖子，需先定位到主题与楼层。 */
    shuiyuan: { topicId?: number; postNumber?: number; postId?: number };
  }
}
