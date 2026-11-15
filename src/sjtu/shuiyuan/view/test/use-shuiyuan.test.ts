// @vitest-environment jsdom
// 阅读缓存的改写：楼层分段加载、失败回滚与 await 期间离开帖子的守卫。
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShuiyuanPost, ShuiyuanTopicDetail } from '../../contract';

// 契约客户端在模块加载时取 bridge，须先于导入装好。
const api = vi.hoisted(() => {
  const handlers: Record<string, (input: never) => Promise<unknown>> = {};
  window.dela = {
    bridge: {
      invoke: (channel: string, input: never) =>
        handlers[channel.slice('shuiyuan:'.length)]!(input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  return handlers;
});
const toast = vi.hoisted(() => vi.fn());
vi.mock('../../../../ui/toast', () => ({ showToast: toast }));
import { loadMorePosts, loadPostWindow, setPostLiked, submitReply, topicOf } from '../use-shuiyuan';

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
    highestPostNumber: posts.at(-1)?.postNumber ?? 0,
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

const reading = { topicId: 1, postNumber: 35 };
let queryClient: QueryClient;

/** 60 楼长帖，只加载了深链落点附近的 30–40 楼。 */
function openDeepLinked() {
  const all = Array.from({ length: 60 }, (_, index) => makePost(index + 1));
  queryClient.setQueryData(['shuiyuan', 'topic', 1, 35], {
    ...makeDetail(1, all.slice(29, 40)),
    stream: all.map((post) => post.id),
  });
}

beforeEach(() => {
  queryClient = new QueryClient();
  toast.mockClear();
  openDeepLinked();
});

describe('楼层分段加载', () => {
  beforeEach(() => {
    api.posts = async ({ postIds }: { postIds: number[] }) => postIds.map((id) => makePost(id));
  });

  it('深链进入后向下补楼取已加载段之后的楼层，而不是从首楼开始', async () => {
    const posts = vi.spyOn(api, 'posts');
    await loadMorePosts(queryClient, reading, 'after');
    expect(posts.mock.calls[0]?.[0]).toMatchObject({
      postIds: Array.from({ length: 20 }, (_, i) => 41 + i),
    });
    expect(topicOf(queryClient, reading)?.posts.map((post) => post.postNumber)).toEqual(
      Array.from({ length: 31 }, (_, i) => 30 + i),
    );
  });

  it('向上补楼取紧邻已加载段之前的一批', async () => {
    await loadMorePosts(queryClient, reading, 'before');
    expect(topicOf(queryClient, reading)?.posts[0]?.postNumber).toBe(10);
  });

  it('已加载段未到末尾时，新回复只登记进 stream，不跨断档追加', async () => {
    api.reply = async () => makePost(61);
    await submitReply(queryClient, reading, '回复');
    const detail = topicOf(queryClient, reading);
    expect(detail?.posts.at(-1)?.postNumber).toBe(40);
    expect(detail?.stream.at(-1)).toBe(61);
    expect(detail?.highestPostNumber).toBe(61);
  });

  it('跳楼请求期间离开帖子则丢弃返回的楼层段', async () => {
    let resolveTopic: (detail: ShuiyuanTopicDetail) => void = () => {};
    api.topic = () => new Promise((resolve) => (resolveTopic = resolve));
    const jumping = loadPostWindow(queryClient, reading, 55);
    queryClient.removeQueries({ queryKey: ['shuiyuan', 'topic', 1] });
    resolveTopic(makeDetail(1, [makePost(55)]));
    await jumping;
    expect(topicOf(queryClient, reading)).toBeUndefined();
  });
});

it('点赞失败只回滚本楼层，期间补进的楼层保留', async () => {
  let fail: (error: unknown) => void = () => {};
  api.setLiked = () => new Promise((_, reject) => (fail = reject));
  const liking = setPostLiked(queryClient, reading, 30, true);
  expect(topicOf(queryClient, reading)?.posts[0]).toMatchObject({ liked: true, likeCount: 1 });
  api.posts = async ({ postIds }: { postIds: number[] }) => postIds.map((id) => makePost(id));
  await loadMorePosts(queryClient, reading, 'after');
  fail(new Error('network down'));
  await liking;
  const posts = topicOf(queryClient, reading)?.posts ?? [];
  expect(posts).toHaveLength(31);
  expect(posts[0]).toMatchObject({ liked: false, likeCount: 0 });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '点赞失败' }));
});
