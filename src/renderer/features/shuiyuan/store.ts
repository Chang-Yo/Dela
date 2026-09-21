import { create } from 'zustand';
import type {
  ShuiyuanBookmarkItem,
  ShuiyuanCounts,
  ShuiyuanFeed,
  ShuiyuanNotificationItem,
  ShuiyuanPost,
  ShuiyuanSiteStructure,
  ShuiyuanState,
  ShuiyuanTopicDetail,
  ShuiyuanTopicSummary,
} from '../../../shared/api';
import { errorText } from '../projects/workspace';

/** 信息流来源：站点 feed（latest/featured/category/tag/search）或个人列表。 */
export type ListSelection =
  ShuiyuanFeed | { kind: 'bookmarks' } | { kind: 'messages' } | { kind: 'notifications' };

type ReadingState = {
  topicId: number;
  postNumber: number | null;
  detail: ShuiyuanTopicDetail | null;
  loading: boolean;
  error: string | null;
} | null;

type Store = {
  connected: boolean;
  username: string | null;
  structure: ShuiyuanSiteStructure | null;
  counts: ShuiyuanCounts | null;
  list: ListSelection;
  /** 选择序号：selectList 每次递增，防抖搜索据此让位给用户的显式切换。 */
  listSelection: number;
  topics: ShuiyuanTopicSummary[];
  moreUrl: string | null;
  listLoading: boolean;
  listError: string | null;
  bookmarks: readonly ShuiyuanBookmarkItem[];
  bookmarksLoading: boolean;
  notifications: readonly ShuiyuanNotificationItem[];
  notificationsLoading: boolean;
  reading: ReadingState;
  /** App 层“在水源页打开”请求；视图消费后清空。 */
  topicRequest: { topicId: number; postNumber: number | null } | null;

  init: () => Promise<void>;
  selectList: (next: ListSelection) => Promise<void>;
  loadMore: () => Promise<void>;
  refreshList: () => Promise<void>;
  refreshCounts: () => Promise<void>;
  markNotificationsRead: () => Promise<void>;
  openTopic: (topicId: number, postNumber?: number) => Promise<void>;
  closeReading: () => void;
  loadMorePosts: () => Promise<void>;
  toggleBookmark: (topicId: number, current: boolean) => Promise<void>;
  /** 点赞楼层（乐观更新，失败回滚并暴露错误）。站点限制：API Key 无法取消已点的赞。 */
  setLiked: (postId: number, liked: boolean) => Promise<void>;
  submitReply: (raw: string, replyToPostNumber?: number) => Promise<void>;
  consumeTopicRequest: (request: { topicId: number; postNumber: number | null }) => void;
  /** App 层「在水源页打开」入口：记录请求并随后由视图消费。 */
  requestTopic: (topicId: number, postNumber?: number) => void;
};

/** 列表请求序号：丢弃过期响应（与邮箱视图的 request guard 同法）。 */
let listRequest = 0;
let readingRequest = 0;

function sameList(a: ListSelection, b: ListSelection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useShuiyuan = create<Store>((set, get) => {
  const loadList = async (selection: ListSelection, more?: string) => {
    const api = window.dela?.shuiyuan;
    if (!api) return;
    const append = Boolean(more);
    const request = ++listRequest;
    if (!append) set({ topics: [], listError: null });
    set({ listLoading: true });
    try {
      if (selection.kind === 'bookmarks') {
        const bookmarks = await api.listBookmarks();
        if (listRequest !== request) return;
        set({ bookmarks, listLoading: false });
        return;
      }
      if (selection.kind === 'notifications') {
        const notifications = await api.listNotifications();
        if (listRequest !== request) return;
        set({ notifications, listLoading: false });
        void get().refreshCounts();
        return;
      }
      const page = selection.kind === 'messages' ? undefined : (selection as ShuiyuanFeed);
      const result =
        selection.kind === 'messages'
          ? await api.listMessages()
          : await api.listTopics(page as ShuiyuanFeed, more);
      if (listRequest !== request) return;
      set({
        topics: append ? [...get().topics, ...result.topics] : [...result.topics],
        moreUrl: result.moreUrl,
        listLoading: false,
      });
    } catch (error) {
      if (listRequest !== request) return;
      set({ listLoading: false, listError: errorText(error) });
    }
  };

  return {
    connected: false,
    username: null,
    structure: null,
    counts: null,
    list: { kind: 'latest' },
    listSelection: 0,
    topics: [],
    moreUrl: null,
    listLoading: false,
    listError: null,
    bookmarks: [],
    bookmarksLoading: false,
    notifications: [],
    notificationsLoading: false,
    reading: null,
    topicRequest: null,

    init: async () => {
      const api = window.dela?.shuiyuan;
      if (!api) return;
      const [state, structure, counts] = await Promise.allSettled([
        api.getState(),
        api.siteStructure(),
        api.getCounts(),
      ]);
      const bound =
        state.status === 'fulfilled'
          ? state.value
          : ({ connected: false, username: null, boundAt: null } satisfies ShuiyuanState);
      set({
        connected: bound.connected,
        username: bound.username,
        structure: structure.status === 'fulfilled' ? structure.value : null,
        counts: counts.status === 'fulfilled' ? counts.value : null,
      });
      if (bound.connected && get().topics.length === 0 && !get().listLoading) {
        void loadList(get().list);
      }
    },

    selectList: async (next) => {
      set({ listSelection: get().listSelection + 1 });
      if (sameList(get().list, next) && !get().listError) {
        await get().refreshList();
        return;
      }
      set({ list: next, topics: [], moreUrl: null, listError: null });
      await loadList(next);
    },

    loadMore: async () => {
      const { list, moreUrl } = get();
      if (!moreUrl || list.kind === 'bookmarks' || list.kind === 'notifications') return;
      await loadList(list, moreUrl);
    },

    refreshList: async () => {
      set({ listError: null });
      await loadList(get().list);
    },

    refreshCounts: async () => {
      const api = window.dela?.shuiyuan;
      if (!api) return;
      try {
        set({ counts: await api.getCounts() });
      } catch {
        /* 未读数拉取失败不打断浏览，下次刷新再试。 */
      }
    },

    markNotificationsRead: async () => {
      const api = window.dela?.shuiyuan;
      if (!api) return;
      // 乐观置已读；失败时以服务端列表为准重新拉取，并保留错误给列表态展示。
      set({ notifications: get().notifications.map((item) => ({ ...item, read: true })) });
      try {
        await api.markNotificationsRead();
        void get().refreshCounts();
      } catch (error) {
        void get().refreshList();
        set({ listError: errorText(error) });
      }
    },

    openTopic: async (topicId, postNumber) => {
      const api = window.dela?.shuiyuan;
      if (!api) return;
      const request = ++readingRequest;
      set({
        reading: {
          topicId,
          postNumber: postNumber ?? null,
          detail: null,
          loading: true,
          error: null,
        },
      });
      try {
        const detail = await api.getTopic(topicId, postNumber);
        if (readingRequest !== request) return;
        set({
          reading: { topicId, postNumber: postNumber ?? null, detail, loading: false, error: null },
        });
        // 列表里的收藏态与详情同步（从阅读页切换后列表徽标一致）。
        const topics = get().topics.map((topic) =>
          topic.id === topicId ? { ...topic, bookmarked: detail.bookmarked } : topic,
        );
        set({ topics });
      } catch (error) {
        if (readingRequest !== request) return;
        set({
          reading: {
            topicId,
            postNumber: postNumber ?? null,
            detail: null,
            loading: false,
            error: errorText(error),
          },
        });
      }
    },

    closeReading: () => {
      readingRequest += 1;
      set({ reading: null });
    },

    loadMorePosts: async () => {
      const api = window.dela?.shuiyuan;
      const reading = get().reading;
      if (!api || !reading?.detail) return;
      const detail = reading.detail;
      const loaded = new Set(detail.posts.map((post) => post.id));
      const nextIds = detail.stream.filter((id) => !loaded.has(id)).slice(0, 20);
      if (nextIds.length === 0) return;
      try {
        const posts = await api.loadPosts(detail.id, nextIds);
        // 请求期间切帖/返回会替换 reading 引用，过期批次直接丢弃。
        if (get().reading !== reading) return;
        const merged = [...detail.posts, ...posts].sort((a, b) => a.postNumber - b.postNumber);
        set({
          reading: { ...reading, detail: { ...detail, posts: merged } },
        });
      } catch (error) {
        if (get().reading !== reading) return;
        set({ reading: { ...reading, error: errorText(error) } });
      }
    },

    toggleBookmark: async (topicId, current) => {
      const api = window.dela?.shuiyuan;
      if (!api) return;
      const next = !current;
      // 乐观更新列表与阅读态；失败回滚。
      const topicsBefore = get().topics;
      const apply = (value: boolean) => {
        set({
          topics: get().topics.map((topic) =>
            topic.id === topicId ? { ...topic, bookmarked: value } : topic,
          ),
          reading:
            get().reading?.detail?.id === topicId
              ? {
                  ...get().reading!,
                  detail: { ...get().reading!.detail!, bookmarked: value },
                }
              : get().reading,
        });
      };
      apply(next);
      try {
        const confirmed = await api.setBookmarked(topicId, next);
        apply(confirmed);
        if (get().list.kind === 'bookmarks') void get().refreshList();
      } catch (error) {
        // 期间切帖则当前 reading 已不属于本帖，不还原以免盖回旧阅读态；乐观标记按原值回退。
        const currentReading = get().reading;
        set({
          topics: topicsBefore,
          reading:
            currentReading?.detail?.id === topicId
              ? {
                  ...currentReading,
                  detail: { ...currentReading.detail, bookmarked: current },
                }
              : currentReading,
          listError: errorText(error),
        });
      }
    },

    setLiked: async (postId, liked) => {
      const api = window.dela?.shuiyuan;
      const reading = get().reading;
      if (!api || !reading?.detail) return;
      const postsBefore = reading.detail.posts;
      set({
        reading: {
          ...reading,
          detail: {
            ...reading.detail,
            posts: postsBefore.map((post) =>
              post.id === postId
                ? {
                    ...post,
                    liked,
                    likeCount: Math.max(0, (post.likeCount ?? 0) + (liked ? 1 : -1)),
                  }
                : post,
            ),
          },
        },
      });
      try {
        await api.setLiked(postId, liked);
      } catch (error) {
        // 期间切帖则当前 reading 已不属于本帖，不还原；否则回滚乐观值并暴露错误。
        if (get().reading !== reading) return;
        set({
          reading: { ...reading, detail: { ...reading.detail, posts: postsBefore } },
          listError: errorText(error),
        });
      }
    },

    submitReply: async (raw: string, replyToPostNumber?: number) => {
      const api = window.dela?.shuiyuan;
      const reading = get().reading;
      if (!api || !reading?.detail) throw new Error('尚未打开帖子');
      const post: ShuiyuanPost = await api.createReply(reading.detail.id, raw, replyToPostNumber);
      // 请求期间切帖/返回：回复已在服务端创建，静默丢弃本地合并，重开该帖即见。
      if (get().reading !== reading) return;
      const detail = reading.detail;
      set({
        reading: {
          ...reading,
          detail: {
            ...detail,
            postsCount: Math.max(detail.postsCount, post.postNumber),
            posts: [...detail.posts, post],
            stream: detail.stream.includes(post.id) ? detail.stream : [...detail.stream, post.id],
          },
        },
      });
    },

    consumeTopicRequest: (request) => {
      set({ topicRequest: null });
      void get().openTopic(request.topicId, request.postNumber ?? undefined);
    },

    requestTopic: (topicId, postNumber) => {
      set({ topicRequest: { topicId, postNumber: postNumber ?? null } });
    },
  };
});

/** 按类别 id 查类别（分类树常驻内存，未命中返回 null）。 */
export function categoryOf(
  structure: ShuiyuanSiteStructure | null,
  categoryId: number | null,
): { name: string; color: string } | null {
  if (!structure || categoryId === null) return null;
  const category = structure.categories.find((item) => item.id === categoryId);
  return category ? { name: category.name, color: `#${category.color}` } : null;
}
