import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { createClient, errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import {
  shuiyuanContract,
  type ShuiyuanFeed,
  type ShuiyuanNotificationItem,
  type ShuiyuanPost,
  type ShuiyuanTopicDetail,
  type ShuiyuanTopicPage,
} from '../contract';
import { markTopicRead, openTopic, useShuiyuan, type ListSelection, type Reading } from './store';

export const shuiyuanClient = createClient(shuiyuanContract, window.dela?.bridge);

export const SOURCE_PREFIX = 'shuiyuan-topic:';

export function topicIdOf(sourceId: string): number {
  return Number(sourceId.slice(SOURCE_PREFIX.length));
}

/** 读取失败时提示原因，页面按未绑定处理，绑定卡即重新授权的出口。 */
export function useShuiyuanState() {
  return useQuery({
    queryKey: ['shuiyuan', 'state'],
    queryFn: async () => {
      try {
        return await shuiyuanClient.state();
      } catch (error) {
        showToast({
          variant: 'error',
          title: '水源状态加载失败',
          description: errorMessage(error),
        });
        throw error;
      }
    },
  });
}

export function useSiteStructure() {
  return (
    useQuery({
      queryKey: ['shuiyuan', 'siteStructure'],
      queryFn: () => shuiyuanClient.siteStructure(),
      staleTime: Infinity,
    }).data ?? null
  );
}

export function useCounts() {
  return (
    useQuery({ queryKey: ['shuiyuan', 'counts'], queryFn: () => shuiyuanClient.counts() }).data ??
    null
  );
}

export type FeedSelection = ShuiyuanFeed | { kind: 'messages' };

export function listKey(list: ListSelection) {
  return list.kind === 'bookmarks' || list.kind === 'notifications'
    ? ['shuiyuan', list.kind]
    : ['shuiyuan', 'feed', list];
}

// 列表只在切换或刷新时重读：返回信息流时保留已加载的页与滚动位置。
export function useFeed(list: FeedSelection) {
  return useInfiniteQuery({
    queryKey: listKey(list),
    queryFn: ({ pageParam }) =>
      list.kind === 'messages'
        ? shuiyuanClient.messages()
        : shuiyuanClient.topics({ feed: list, moreUrl: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      list.kind === 'messages' ? undefined : (page.moreUrl ?? undefined),
    staleTime: Infinity,
  });
}

export function useBookmarks() {
  return useQuery({
    queryKey: ['shuiyuan', 'bookmarks'],
    queryFn: () => shuiyuanClient.bookmarks(),
    staleTime: Infinity,
  });
}

export function useNotifications() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['shuiyuan', 'notifications'],
    queryFn: async () => {
      const items = await shuiyuanClient.notifications();
      void queryClient.invalidateQueries({ queryKey: ['shuiyuan', 'counts'] });
      return items;
    },
    staleTime: Infinity,
  });
}

export function useSelectList() {
  const queryClient = useQueryClient();
  return (list: ListSelection) => {
    void queryClient.resetQueries({ queryKey: listKey(list), exact: true });
    useShuiyuan.setState({ list });
  };
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const key = ['shuiyuan', 'notifications'];
  return async () => {
    queryClient.setQueryData<ShuiyuanNotificationItem[]>(key, (items) =>
      items?.map((item) => ({ ...item, read: true })),
    );
    try {
      await shuiyuanClient.markNotificationsRead();
      void queryClient.invalidateQueries({ queryKey: ['shuiyuan', 'counts'] });
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: key });
      showToast({ variant: 'error', title: '全部标为已读失败', description: errorMessage(error) });
    }
  };
}

export function openPost(postId: number): void {
  void shuiyuanClient.locatePost(postId).then(
    (link) => openTopic(link.topicId, link.postNumber),
    (error: unknown) =>
      showToast({ variant: 'error', title: '打开帖子失败', description: errorMessage(error) }),
  );
}

function topicKey(reading: Reading) {
  return ['shuiyuan', 'topic', reading.topicId, reading.postNumber];
}

function setFeedBookmarked(queryClient: QueryClient, topicId: number, bookmarked: boolean) {
  queryClient.setQueriesData<InfiniteData<ShuiyuanTopicPage>>(
    { queryKey: ['shuiyuan', 'feed'] },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          topics: page.topics.map((topic) =>
            topic.id === topicId ? { ...topic, bookmarked } : topic,
          ),
        })),
      },
  );
}

// 每次打开都重读；阅读期间的补楼、跳楼、回复与点赞直接改写这份缓存，关闭即丢弃。
export function useTopic(reading: Reading) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: topicKey(reading),
    queryFn: async () => {
      const detail = await shuiyuanClient.topic({
        id: reading.topicId,
        postNumber: reading.postNumber ?? undefined,
      });
      markTopicRead(detail.id, detail.lastPostedAt || detail.createdAt || new Date().toISOString());
      setFeedBookmarked(queryClient, detail.id, detail.bookmarked);
      return detail;
    },
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function topicOf(queryClient: QueryClient, reading: Reading) {
  return queryClient.getQueryData<ShuiyuanTopicDetail>(topicKey(reading));
}

function updateTopic(
  queryClient: QueryClient,
  reading: Reading,
  change: (detail: ShuiyuanTopicDetail) => ShuiyuanTopicDetail,
) {
  queryClient.setQueryData<ShuiyuanTopicDetail>(
    topicKey(reading),
    (detail) => detail && change(detail),
  );
}

/** 已加载楼层在 stream 中的首尾下标：深链或跳转后，已加载段可能位于 stream 中部。 */
export function loadedSpan(detail: ShuiyuanTopicDetail): { first: number; last: number } {
  const loaded = new Set(detail.posts.map((post) => post.id));
  return {
    first: detail.stream.findIndex((id) => loaded.has(id)),
    last: detail.stream.findLastIndex((id) => loaded.has(id)),
  };
}

export async function loadMorePosts(
  queryClient: QueryClient,
  reading: Reading,
  direction: 'before' | 'after',
): Promise<void> {
  const detail = topicOf(queryClient, reading);
  if (!detail) return;
  const { first, last } = loadedSpan(detail);
  const postIds =
    direction === 'after'
      ? detail.stream.slice(last + 1, last + 21)
      : detail.stream.slice(Math.max(0, first - 20), Math.max(0, first));
  if (postIds.length === 0) return;
  try {
    const posts = await shuiyuanClient.posts({ topicId: detail.id, postIds });
    // 空批次不写回：楼层引用不变，补楼观察器才不会立刻重发；期间楼层变过（跳楼、点赞）则丢弃这批。
    if (posts.length === 0) return;
    updateTopic(queryClient, reading, (current) =>
      current.posts === detail.posts
        ? {
            ...current,
            posts: [...current.posts, ...posts].sort((a, b) => a.postNumber - b.postNumber),
          }
        : current,
    );
  } catch (error) {
    showToast({ variant: 'error', title: '加载更多失败', description: errorMessage(error) });
  }
}

/** 以目标楼层附近的一段整体替换：合并会让已加载段在 stream 中断档，前后补楼无法续接。 */
export async function loadPostWindow(
  queryClient: QueryClient,
  reading: Reading,
  postNumber: number,
): Promise<void> {
  try {
    const detail = await shuiyuanClient.topic({ id: reading.topicId, postNumber });
    updateTopic(queryClient, reading, () => detail);
  } catch (error) {
    showToast({ variant: 'error', title: '跳转楼层失败', description: errorMessage(error) });
  }
}

export async function submitReply(
  queryClient: QueryClient,
  reading: Reading,
  raw: string,
  replyToPostNumber?: number,
): Promise<number> {
  const post = await shuiyuanClient.reply({ topicId: reading.topicId, raw, replyToPostNumber });
  // 已加载段没到末尾时只登记进 stream，由向下补楼按序加载，避免新楼跨过未加载的断档。
  updateTopic(queryClient, reading, (detail) => ({
    ...detail,
    highestPostNumber: Math.max(detail.highestPostNumber, post.postNumber),
    posts:
      loadedSpan(detail).last === detail.stream.length - 1 ? [...detail.posts, post] : detail.posts,
    stream: detail.stream.includes(post.id) ? detail.stream : [...detail.stream, post.id],
  }));
  return post.postNumber;
}

/** 站点限制：API Key 无法取消已点的赞。失败时只还原这一楼。 */
export async function setPostLiked(
  queryClient: QueryClient,
  reading: Reading,
  postId: number,
  liked: boolean,
): Promise<void> {
  const before = topicOf(queryClient, reading)?.posts.find((post) => post.id === postId);
  if (!before) return;
  const replace = (next: ShuiyuanPost) =>
    updateTopic(queryClient, reading, (detail) => ({
      ...detail,
      posts: detail.posts.map((post) => (post.id === postId ? next : post)),
    }));
  replace({ ...before, liked, likeCount: Math.max(0, (before.likeCount ?? 0) + (liked ? 1 : -1)) });
  try {
    await shuiyuanClient.setLiked({ postId, liked });
  } catch (error) {
    showToast({ variant: 'error', title: '点赞失败', description: errorMessage(error) });
    replace(before);
  }
}

export function useToggleBookmark() {
  const queryClient = useQueryClient();
  return async (topicId: number, current: boolean) => {
    const apply = (bookmarked: boolean) => {
      setFeedBookmarked(queryClient, topicId, bookmarked);
      queryClient.setQueriesData<ShuiyuanTopicDetail>(
        { queryKey: ['shuiyuan', 'topic', topicId] },
        (detail) => detail && { ...detail, bookmarked },
      );
    };
    apply(!current);
    try {
      apply(await shuiyuanClient.setBookmarked({ topicId, on: !current }));
      void queryClient.invalidateQueries({ queryKey: ['shuiyuan', 'bookmarks'] });
    } catch (error) {
      showToast({ variant: 'error', title: '收藏失败', description: errorMessage(error) });
      apply(current);
    }
  };
}

/** 引用行带快照保存状态；保存进度变化时主进程推送 sourceRef，读取随之过期。 */
export function useSourceRef(topicId: number) {
  return useQuery({
    queryKey: ['shuiyuan', 'sourceRef', topicId],
    queryFn: () => shuiyuanClient.sourceRef(topicId),
  });
}
