import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShuiyuanPost, ShuiyuanTopicDetail, ShuiyuanTopicSummary } from '../../../shared/api';

// 失败回滚与 await 期间用户操作（切流/翻页/追加楼层）的竞态守卫。
// store 模块初始化读 localStorage、动作里读 window.dela，先打桩再动态导入。
beforeEach(() => {
  vi.resetModules();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

function makeTopic(id: number, bookmarked = false): ShuiyuanTopicSummary {
  return {
    id,
    title: `主题${id}`,
    excerpt: null,
    categoryId: null,
    tags: [],
    postsCount: 1,
    views: null,
    likeCount: null,
    createdAt: '2026-01-01T00:00:00Z',
    lastPostedAt: null,
    pinned: false,
    closed: false,
    bookmarked,
    archetype: 'regular',
    lastPosterUsername: null,
    authorUsername: null,
    authorAvatarTemplate: null,
  };
}

function makePost(id: number, liked = false): ShuiyuanPost {
  return {
    id,
    postNumber: id,
    username: 'user',
    name: null,
    avatarTemplate: null,
    createdAt: '2026-01-01T00:00:00Z',
    cooked: '<p>楼层</p>',
    replyToPostNumber: null,
    likeCount: liked ? 1 : 0,
    liked,
    yours: false,
  };
}

function makeDetail(id: number, posts: ShuiyuanPost[]): ShuiyuanTopicDetail {
  return {
    id,
    title: `主题${id}`,
    categoryId: null,
    tags: [],
    postsCount: posts.length,
    likeCount: null,
    views: null,
    createdAt: '2026-01-01T00:00:00Z',
    lastPostedAt: null,
    closed: false,
    archetype: 'regular',
    bookmarked: false,
    stream: posts.map((p) => p.id),
    posts,
  };
}

/** 注入只含被测方法的 shuiyuan API，动作挂起直到测试显式失败。 */
function stubPendingApi(method: 'setBookmarked' | 'setLiked'): (error: unknown) => void {
  let rejectPending: (error: unknown) => void;
  const pending = new Promise<never>((_, reject) => {
    rejectPending = reject;
  });
  vi.stubGlobal('window', { dela: { shuiyuan: { [method]: () => pending } } });
  return (error) => rejectPending(error);
}

describe('toggleBookmark 失败回滚', () => {
  it('await 期间 selectList 换流后只回写 bookmarked，不覆盖整份新列表', async () => {
    const fail = stubPendingApi('setBookmarked');
    const { useShuiyuan } = await import('./store');
    const { useToastStore } = await import('../../app/toasts');
    useShuiyuan.setState({ topics: [makeTopic(1), makeTopic(2)] });
    const toggling = useShuiyuan.getState().toggleBookmark(1, false);
    // 用户切流：列表整体替换，且不含原 topic。
    useShuiyuan.setState({ topics: [makeTopic(9), makeTopic(10)] });
    fail(new Error('network down'));
    await toggling;
    const state = useShuiyuan.getState();
    expect(state.topics.map((topic) => topic.id)).toEqual([9, 10]);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      title: '收藏失败',
      description: 'network down',
    });
  });

  it('await 期间 loadMore 追加页后保留追加页，本 topic 与阅读态按原值回退', async () => {
    const fail = stubPendingApi('setBookmarked');
    const { useShuiyuan } = await import('./store');
    useShuiyuan.setState({
      topics: [makeTopic(1), makeTopic(2)],
      reading: {
        topicId: 1,
        postNumber: null,
        detail: makeDetail(1, [makePost(11)]),
        loading: false,
        error: null,
      },
    });
    const toggling = useShuiyuan.getState().toggleBookmark(1, false);
    expect(useShuiyuan.getState().topics.find((topic) => topic.id === 1)?.bookmarked).toBe(true);
    // loadMore 追加：在乐观更新后的列表尾部拼上新页。
    const current = useShuiyuan.getState().topics;
    useShuiyuan.setState({ topics: [...current, makeTopic(3)] });
    fail(new Error('network down'));
    await toggling;
    const state = useShuiyuan.getState();
    expect(state.topics.map((topic) => topic.id)).toEqual([1, 2, 3]);
    expect(state.topics.find((topic) => topic.id === 1)?.bookmarked).toBe(false);
    expect(state.reading?.detail?.bookmarked).toBe(false);
  });
});

describe('setLiked 失败回滚', () => {
  it('await 期间合并新楼层后只回滚本楼层，追加楼层保留', async () => {
    const fail = stubPendingApi('setLiked');
    const { useShuiyuan } = await import('./store');
    useShuiyuan.setState({
      reading: {
        topicId: 1,
        postNumber: null,
        detail: makeDetail(1, [makePost(11), makePost(12)]),
        loading: false,
        error: null,
      },
    });
    const liking = useShuiyuan.getState().setLiked(11, true);
    expect(useShuiyuan.getState().reading?.detail?.posts[0]).toMatchObject({
      liked: true,
      likeCount: 1,
    });
    // loadMorePosts 追加：reading 引用更换，楼层在乐观值之后合并进来。
    const reading = useShuiyuan.getState().reading!;
    useShuiyuan.setState({
      reading: {
        ...reading,
        detail: { ...reading.detail!, posts: [...reading.detail!.posts, makePost(13)] },
      },
    });
    fail(new Error('network down'));
    await liking;
    const posts = useShuiyuan.getState().reading?.detail?.posts ?? [];
    expect(posts.map((post) => post.id)).toEqual([11, 12, 13]);
    expect(posts.find((post) => post.id === 11)).toMatchObject({ liked: false, likeCount: 0 });
  });

  it('await 期间切到其他帖子则不回写', async () => {
    const fail = stubPendingApi('setLiked');
    const { useShuiyuan } = await import('./store');
    useShuiyuan.setState({
      reading: {
        topicId: 1,
        postNumber: null,
        detail: makeDetail(1, [makePost(11)]),
        loading: false,
        error: null,
      },
    });
    const liking = useShuiyuan.getState().setLiked(11, true);
    // 用户切帖：reading 整体换成另一帖子。
    useShuiyuan.setState({
      reading: {
        topicId: 2,
        postNumber: null,
        detail: makeDetail(2, [makePost(21)]),
        loading: false,
        error: null,
      },
    });
    fail(new Error('network down'));
    await liking;
    const state = useShuiyuan.getState();
    expect(state.reading?.detail?.id).toBe(2);
    expect(state.reading?.detail?.posts.find((post) => post.id === 21)?.liked).toBe(false);
    expect(state.listError).toBeNull();
  });
});
