import type { DocumentContent } from './documents';

export const SHUIYUAN_HOST = 'shuiyuan.sjtu.edu.cn';

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

/** 水源主题（帖子）在列表形态下的瘦身视图；字段从 Discourse 载荷挑选，不透传。 */
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
  readonly read: boolean;
  readonly highPriority: boolean;
  readonly createdAt: string;
  readonly topicId: number | null;
  readonly postNumber: number | null;
  readonly fancyTitle: string | null;
  readonly displayUsername: string | null;
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

/** 关联进项目时持久化的来源引用行（shuiyuan_topics 表的视图）。 */
export interface ShuiyuanSourceRef {
  readonly topicId: number;
  readonly title: string;
  readonly url: string;
  readonly excerpt: string | null;
  readonly categoryName: string | null;
  readonly author: string | null;
  readonly postsCount: number | null;
  readonly addedAt: string;
}

/** Composer 附件上传结果；shortUrl 为 upload:// 形态，可直接写进 Markdown。 */
export interface ShuiyuanUpload {
  readonly shortUrl: string;
  readonly url: string | null;
  readonly originalFilename: string | null;
}

export interface ShuiyuanApi {
  getState(): Promise<ShuiyuanState>;
  /** 打开水源授权窗口：用户在其中登录并授权，随后把站点展示的密文复制回来。 */
  startAuth(): Promise<void>;
  /** 解密并校验用户粘贴的密文，成功后保存 User API Key 并返回绑定状态。 */
  bind(payload: string): Promise<ShuiyuanState>;
  /** 撤销远端 key 并清除本地凭据。 */
  unbind(): Promise<void>;
  /** 分类树与常用标签（主进程内存缓存）。 */
  siteStructure(): Promise<ShuiyuanSiteStructure>;
  /** 主题列表；传 moreUrl 时请求上一页返回的下一页地址。 */
  listTopics(feed: ShuiyuanFeed, moreUrl?: string): Promise<ShuiyuanTopicPage>;
  /** 主题详情；postNumber 提供时从该楼附近加载（通知深链）。 */
  getTopic(id: number, postNumber?: number): Promise<ShuiyuanTopicDetail>;
  /** 按 post id 分段加载楼层（长帖加载更多）。 */
  loadPosts(topicId: number, postIds: readonly number[]): Promise<readonly ShuiyuanPost[]>;
  listBookmarks(): Promise<readonly ShuiyuanBookmarkItem[]>;
  /** 私信会话列表（topic 形态）。 */
  listMessages(): Promise<ShuiyuanTopicPage>;
  listNotifications(): Promise<readonly ShuiyuanNotificationItem[]>;
  markNotificationsRead(): Promise<void>;
  /** 未读计数（主进程 60s 内存缓存）。 */
  getCounts(): Promise<ShuiyuanCounts>;
  /** 回复主题或私信会话；返回新楼层。replyToPostNumber 为楼层级回复目标（Discourse reply_to_post_number）。 */
  createReply(topicId: number, raw: string, replyToPostNumber?: number): Promise<ShuiyuanPost>;
  /**
   * 点赞/取消点赞楼层（Discourse post_action_type_id=2）。
   * 实测（2026-09-21）：点赞 200；取消点赞被站点以 403 拒绝（User API Key write scope 不含
   * post_actions#destroy），已点赞状态只能去网页端撤销。
   */
  setLiked(postId: number, liked: boolean): Promise<void>;
  /**
   * 上传 Composer 附件（Discourse `/uploads.json` multipart）。
   * 该端点未实测：站点若禁用匿名上传路径或调整限制，以错误提示暴露。
   */
  uploadFile(fileName: string, base64: string): Promise<ShuiyuanUpload>;
  /** 发起新私信；返回会话 topic id。 */
  createMessage(to: readonly string[], title: string, raw: string): Promise<number>;
  /** 收藏/取消收藏主题；返回最新状态。 */
  setBookmarked(topicId: number, on: boolean): Promise<boolean>;
  /** 写入来源引用行（添加到项目前调用）。 */
  addSourceRef(topicId: number): Promise<ShuiyuanSourceRef>;
  getSourceRef(topicId: number): Promise<ShuiyuanSourceRef | null>;
  /** 项目工作区打开水源来源时的文档内容（实时拉取，断网回退 excerpt）。 */
  readSource(topicId: number): Promise<DocumentContent>;
  /** 在系统浏览器打开原帖；不经应用内链接分流。 */
  openInBrowser(topicId: number): Promise<void>;
  /** 主进程把站内主题链接（聊天、邮件、文档等处点击）交回应用内阅读。 */
  onOpenTopic(listener: (target: ShuiyuanTopicLink) => void): () => void;
}
