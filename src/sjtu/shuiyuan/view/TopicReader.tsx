import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CornerUpLeft,
  ExternalLink,
  FolderPlus,
  Heart,
  Mail,
  Quote,
  Reply,
} from 'lucide-react';
import { cn } from '../../../ui/lib/cn';
import { Button } from '../../../ui/button';
import { ShuiyuanTitle } from './shuiyuan-emoji';
import { closeReading, openTopic, saveDraft, useShuiyuan, type Reading } from './store';
import { avatarUrl, categoryOf, formatCount, formatListDate, tagColor } from './shuiyuan-format';
import {
  loadedSpan,
  loadMorePosts,
  loadPostWindow,
  setPostLiked,
  shuiyuanClient,
  submitReply,
  topicOf,
  useSiteStructure,
  useToggleBookmark,
  useTopic,
} from './use-shuiyuan';
import { ShuiyuanHtmlBody } from './ShuiyuanHtmlBody';
import { ReplyComposer } from './ReplyComposer';
import { AddToProjectDialog } from './AddToProjectDialog';
import { CategoryTag } from './TopicFeed';
import { FloorCapsule, TopicTimeline } from './TopicTimeline';
import { errorMessage } from '../../../core/protocol/contract';
import type { ShuiyuanPost } from '../contract';
import { Alert } from '../../../ui/alert';

function quoteText(cooked: string): string {
  const doc = new DOMParser().parseFromString(cooked, 'text/html');
  doc.querySelectorAll('aside.quote, .lightbox-wrapper .meta').forEach((node) => node.remove());
  doc
    .querySelectorAll('p, li, br, pre, blockquote, h1, h2, h3, h4, h5, h6')
    .forEach((node) => node.after('\n'));
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function postElements(root: HTMLElement | null): HTMLElement[] {
  return Array.from(root?.querySelectorAll<HTMLElement>('[data-post-number]') ?? []);
}

type PostActionsProps = {
  post: ShuiyuanPost;
  canReply: boolean;
  onLike: (postId: number, liked: boolean) => void;
  onQuote: (post: ShuiyuanPost) => void;
  onReply: (post: ShuiyuanPost) => void;
};

/** 楼层操作行，默认降透明、悬停浮现。实测（2026-09-21）：User API Key 无法取消点赞，已赞按钮不可再点。 */
function PostActions({ post, canReply, onLike, onQuote, onReply }: PostActionsProps) {
  const likeCount = post.likeCount ?? 0;
  return (
    <footer className="mt-2.5 flex items-center justify-end gap-1 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
      <button
        aria-label={post.liked ? '已喜爱（取消需到水源网页端）' : '喜爱'}
        className={cn(
          'flex h-7 items-center gap-1 rounded-control px-1.5 text-xs tabular-nums transition-colors hover:bg-hover',
          post.liked ? 'cursor-default text-danger' : 'text-ink-3 hover:text-ink',
        )}
        disabled={post.liked}
        onClick={() => onLike(post.id, true)}
        title={post.liked ? '已喜爱（站点限制：取消点赞需到水源网页端）' : '喜爱'}
        type="button"
      >
        <Heart
          aria-hidden="true"
          className={cn('size-3.5', post.liked && 'fill-current')}
          strokeWidth={1.8}
        />
        {likeCount > 0 ? likeCount : null}
      </button>
      {canReply ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`引用第 ${post.postNumber} 楼`}
            onClick={() => onQuote(post)}
            title="引用"
          >
            <Quote strokeWidth={1.8} />
          </Button>
          <button
            className="flex h-7 items-center gap-1.5 rounded-control px-2 text-xs text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            onClick={() => onReply(post)}
            type="button"
          >
            <Reply aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            回复
          </button>
        </>
      ) : null}
    </footer>
  );
}

export function TopicReaderHeader({ reading }: { reading: Reading }) {
  const toggleBookmark = useToggleBookmark();
  const [addOpen, setAddOpen] = useState(false);
  const detail = useTopic(reading).data ?? null;
  const isPM = detail?.archetype === 'private_message';

  return (
    <header className="flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur max-md:px-2">
      <Button aria-label="返回信息流" onClick={closeReading} size="icon-sm" variant="ghost">
        <ArrowLeft className="size-4" strokeWidth={1.8} />
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {detail ? <ShuiyuanTitle text={detail.title} /> : '正在加载…'}
      </h1>
      {detail && !isPM ? (
        <Button
          aria-label={detail.bookmarked ? '取消收藏' : '收藏'}
          onClick={() => void toggleBookmark(detail.id, detail.bookmarked)}
          size="icon-sm"
          variant="ghost"
        >
          <Heart
            className={cn('size-4', detail.bookmarked && 'fill-current text-ink')}
            strokeWidth={1.8}
          />
        </Button>
      ) : null}
      {detail && !isPM ? (
        <Button
          aria-label="添加到项目"
          onClick={() => setAddOpen(true)}
          size="icon-sm"
          variant="ghost"
        >
          <FolderPlus className="size-4" strokeWidth={1.8} />
        </Button>
      ) : null}
      {detail ? (
        <Button
          aria-label="打开原帖"
          onClick={() => void shuiyuanClient.openInBrowser(detail.id)}
          size="icon-sm"
          variant="ghost"
        >
          <ExternalLink className="size-4" strokeWidth={1.8} />
        </Button>
      ) : null}
      <AddToProjectDialog
        onClose={() => setAddOpen(false)}
        open={addOpen}
        topicId={detail?.id ?? null}
        topicTitle={detail?.title ?? ''}
      />
    </header>
  );
}

function PostAvatar({ post }: { post: ShuiyuanPost }) {
  const avatar = avatarUrl(post.avatarTemplate, 96);
  if (avatar) {
    return (
      <img
        alt=""
        className="size-10 shrink-0 rounded-full object-cover max-md:size-8"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={avatar}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-full bg-inset text-xs font-medium text-ink-3 max-md:size-8"
    >
      {post.username.trim().charAt(0).toUpperCase() || '…'}
    </span>
  );
}

export function TopicReader({ reading }: { reading: Reading }) {
  const queryClient = useQueryClient();
  const topic = useTopic(reading);
  const structure = useSiteStructure();
  const topicId = reading.topicId;
  const saved = useShuiyuan((state) => state.drafts[topicId]);
  const draft = saved?.text ?? '';
  const replyTarget = saved?.target ?? null;
  const [composerOpen, setComposerOpen] = useState(saved !== undefined);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState<'before' | 'after' | null>(null);
  const [currentPost, setCurrentPost] = useState<number | null>(null);
  /** 跳到未加载区域：新楼层段提交到 DOM 后再定位；每次跳转是新对象，同楼再跳也会触发。 */
  const [pendingJump, setPendingJump] = useState<{ postNumber: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  /** 首个已加载楼层最近一次的视口位置，向上补楼后据此回补滚动。 */
  const firstPostRef = useRef<{ postNumber: number; top: number; atTop: boolean } | null>(null);
  const trackFrameRef = useRef(0);
  const detail = topic.data ?? null;
  const posts = detail?.posts;
  const isPM = detail?.archetype === 'private_message';
  const category = categoryOf(structure, detail?.categoryId ?? null);
  const span = detail ? loadedSpan(detail) : null;
  const hasBefore = span ? span.first > 0 : false;
  const hasAfter = detail && span ? span.last < detail.stream.length - 1 : false;
  const totalCount = detail?.highestPostNumber ?? 0;

  const recordFirstPost = () => {
    const root = scrollRef.current;
    const first = root?.querySelector<HTMLElement>('[data-post-number]');
    firstPostRef.current =
      root && first
        ? {
            postNumber: Number(first.dataset.postNumber),
            top: first.getBoundingClientRect().top,
            atTop: root.scrollTop <= 0,
          }
        : null;
  };

  const trackCurrentPost = () => {
    const root = scrollRef.current;
    if (!root) return;
    const elements = postElements(root);
    const rootTop = root.getBoundingClientRect().top;
    const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
    const current = atEnd
      ? elements.at(-1)
      : elements.find((element) => element.getBoundingClientRect().bottom > rootTop + 1);
    setCurrentPost(current ? Number(current.dataset.postNumber) : null);
  };

  const scrollToPost = (postNumber: number, smooth: boolean) => {
    const elements = postElements(scrollRef.current);
    // 目标楼被删时落到其后最近的一楼，越过末尾则落在最后一楼。
    const target =
      elements.find((element) => Number(element.dataset.postNumber) >= postNumber) ??
      elements.at(-1);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    const landed = Number(target.dataset.postNumber);
    setHighlight(landed);
    window.setTimeout(() => setHighlight((current) => (current === landed ? null : current)), 1500);
  };

  // 滚动位于顶端时浏览器的滚动锚定不生效，向上补楼会把原首楼下推，这里按位移回补；
  // 不在顶端时交给滚动锚定（它同时吸收落点上方 iframe 测高后的增长），这里不重复回补。
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const previous = firstPostRef.current;
    const element = previous?.atTop
      ? root?.querySelector<HTMLElement>(`[data-post-number="${previous.postNumber}"]`)
      : null;
    if (root && previous && element && element !== root.querySelector('[data-post-number]')) {
      root.scrollTop += element.getBoundingClientRect().top - previous.top;
    }
    recordFirstPost();
    trackCurrentPost();
  }, [posts]);

  useLayoutEffect(() => {
    if (detail && reading.postNumber) scrollToPost(reading.postNumber, false);
  }, [detail?.id, reading.postNumber]);

  useLayoutEffect(() => {
    if (pendingJump) scrollToPost(pendingJump.postNumber, false);
  }, [pendingJump]);

  // 阅读器式的连续加载：哨兵进入视口前 320px 即向该方向补一批楼层，同一时刻只补一个方向。
  // 楼层变化即重建观察器，仍在视口内的哨兵会立刻再触发一次。
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || (!hasBefore && !hasAfter)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((item) => item.isIntersecting);
        if (!entry || loadingRef.current) return;
        const direction = entry.target === topSentinelRef.current ? 'before' : 'after';
        loadingRef.current = true;
        setLoadingMore(direction);
        void loadMorePosts(queryClient, reading, direction).finally(() => {
          loadingRef.current = false;
          setLoadingMore(null);
        });
      },
      { root, rootMargin: '320px 0px' },
    );
    for (const sentinel of [topSentinelRef.current, bottomSentinelRef.current]) {
      if (sentinel) observer.observe(sentinel);
    }
    return () => observer.disconnect();
  }, [hasBefore, hasAfter, queryClient, reading, posts]);

  const jumpToPost = async (postNumber: number) => {
    const first = posts?.[0];
    const last = posts?.at(-1);
    if (!first || !last) return;
    const reachable =
      (postNumber >= first.postNumber || !hasBefore) &&
      (postNumber <= last.postNumber || !hasAfter);
    if (reachable) {
      scrollToPost(postNumber, true);
      return;
    }
    await loadPostWindow(queryClient, reading, postNumber);
    setPendingJump({ postNumber });
  };

  const openTopicFromPost = (targetTopicId: number, postNumber?: number) => {
    if (targetTopicId === topicId) void jumpToPost(postNumber ?? 1);
    else openTopic(targetTopicId, postNumber);
  };

  // 水源原生引用：站点渲染成带头像的引用卡片，并通知被引用者。
  const quote = (post: ShuiyuanPost) => {
    const text = quoteText(post.cooked);
    if (!text) return;
    setComposerOpen(true);
    const head = draft ? `${draft.replace(/\n+$/, '')}\n\n` : '';
    saveDraft(topicId, {
      text: `${head}[quote="${post.username}, post:${post.postNumber}, topic:${topicId}"]\n${text}\n[/quote]\n\n`,
    });
  };

  const placeholder = replyTarget ? `回复 @${replyTarget.username}…` : isPM ? '回复私信…' : '回复…';
  const composer = (
    <ReplyComposer
      onChange={(text) => saveDraft(topicId, { text })}
      onClose={() => setComposerOpen(false)}
      onClearReplyTarget={() => saveDraft(topicId, { target: null })}
      onSubmit={async () => {
        const postNumber = await submitReply(queryClient, reading, draft, replyTarget?.postNumber);
        saveDraft(topicId, { text: '', target: null });
        setComposerOpen(false);
        // 新楼没并进已加载段（中段阅读时）就先取它附近的一段，再定位过去；期间已离开则不动。
        const current = topicOf(queryClient, reading);
        if (!current) return;
        if (!current.posts.some((post) => post.postNumber === postNumber))
          await loadPostWindow(queryClient, reading, postNumber);
        setPendingJump({ postNumber });
      }}
      placeholder={placeholder}
      replyTarget={replyTarget}
      submitLabel={isPM ? '发送私信' : '发布回复'}
      value={draft}
    />
  );
  const timeline = detail
    ? {
        current: currentPost ?? detail.posts[0]?.postNumber ?? 1,
        highest: detail.highestPostNumber,
        onJump: jumpToPost,
        reply: detail.closed
          ? { label: '已关闭', onClick: null }
          : composerOpen
            ? null
            : { label: draft.trim() ? '继续回复' : '回复', onClick: () => setComposerOpen(true) },
      }
    : null;

  return (
    // relative 是回复器全屏书写态的定位锚点：铺满阅读区、不遮全局外壳。
    <div className="relative flex h-full min-h-0 flex-col bg-surface @container">
      <div className="relative min-h-0 flex-1">
        <div
          className="h-full overflow-y-auto [scrollbar-gutter:stable]"
          onScroll={() => {
            recordFirstPost();
            cancelAnimationFrame(trackFrameRef.current);
            trackFrameRef.current = requestAnimationFrame(trackCurrentPost);
          }}
          ref={scrollRef}
        >
          <div className="mx-auto w-full max-w-2xl px-5 pt-5 pb-14 max-md:px-4 @min-[62rem]:pb-5">
            {topic.error ? <Alert role="alert">{errorMessage(topic.error)}</Alert> : null}
            {!detail && !topic.error ? (
              <p className="py-8 text-center text-sm text-ink-3">正在加载帖子…</p>
            ) : null}
            {detail ? (
              // 标题区与哨兵不参与滚动锚定，否则向上补楼时浏览器会以它们为锚、不回补。
              <header className="border-b border-line pb-4 [overflow-anchor:none]">
                <h2 className="text-xl font-semibold leading-snug tracking-tight">
                  <ShuiyuanTitle text={detail.title} />
                </h2>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3">
                  {isPM ? (
                    <span className="flex items-center gap-1">
                      <Mail aria-hidden="true" className="size-3" strokeWidth={1.8} />
                      私信
                    </span>
                  ) : category ? (
                    <CategoryTag category={category} />
                  ) : null}
                  {detail.tags.map((tag) => (
                    <span className="flex items-center gap-1.5" key={tag}>
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-[0.125rem]"
                        style={{ backgroundColor: tagColor(tag) }}
                      />
                      {tag}
                    </span>
                  ))}
                  <span className="tabular-nums">{totalCount} 楼</span>
                  <span className="tabular-nums">浏览 {formatCount(detail.views)}</span>
                  <span className="tabular-nums">发布于 {formatListDate(detail.createdAt)}</span>
                </div>
              </header>
            ) : null}
            {detail && hasBefore ? (
              <div
                className="grid h-10 place-items-center [overflow-anchor:none]"
                ref={topSentinelRef}
              >
                {loadingMore === 'before' ? (
                  <span className="text-xs text-ink-3">正在加载楼层…</span>
                ) : null}
              </div>
            ) : null}
            {detail?.posts.map((post) => {
              const repliedTo = post.replyToPostNumber
                ? detail.posts.find((item) => item.postNumber === post.replyToPostNumber)
                : null;
              return (
                <article
                  className={cn(
                    'group flex gap-3 border-b border-line py-5 transition-colors last:border-0',
                    highlight === post.postNumber && 'bg-accent-tint',
                  )}
                  data-post-number={post.postNumber}
                  key={post.id}
                >
                  <PostAvatar post={post} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 shrink truncate text-xs font-semibold">
                        {post.username}
                      </span>
                      {post.yours ? (
                        <span className="shrink-0 rounded bg-inset px-1.5 py-px text-xs text-ink-3">
                          你
                        </span>
                      ) : null}
                      {post.replyToPostNumber ? (
                        <button
                          aria-label={`跳到第 ${post.replyToPostNumber} 楼`}
                          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                          onClick={() => void jumpToPost(post.replyToPostNumber!)}
                          title={
                            repliedTo
                              ? `回复 @${repliedTo.username} · 第 ${post.replyToPostNumber} 楼，点击跳转`
                              : `回复第 ${post.replyToPostNumber} 楼，点击跳转`
                          }
                          type="button"
                        >
                          <CornerUpLeft aria-hidden="true" className="size-3 shrink-0" />
                          <span className="truncate">
                            {repliedTo ? repliedTo.username : `第 ${post.replyToPostNumber} 楼`}
                          </span>
                        </button>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-3">
                        第 {post.postNumber} 楼 · {formatListDate(post.createdAt)}
                      </span>
                    </div>
                    <div className="mt-2.5">
                      <ShuiyuanHtmlBody
                        html={post.cooked}
                        onOpenTopic={openTopicFromPost}
                        title={`第 ${post.postNumber} 楼`}
                      />
                    </div>
                    <PostActions
                      canReply={!detail.closed}
                      onQuote={quote}
                      onLike={(postId, liked) =>
                        void setPostLiked(queryClient, reading, postId, liked)
                      }
                      onReply={(target) => {
                        saveDraft(topicId, {
                          target: { postNumber: target.postNumber, username: target.username },
                        });
                        setComposerOpen(true);
                      }}
                      post={post}
                    />
                  </div>
                </article>
              );
            })}
            {detail && hasAfter ? (
              <div
                className="grid h-10 place-items-center [overflow-anchor:none]"
                ref={bottomSentinelRef}
              >
                {loadingMore === 'after' ? (
                  <span className="text-xs text-ink-3">正在加载楼层…</span>
                ) : null}
              </div>
            ) : null}
            {detail && !hasAfter && detail.posts.length > 1 ? (
              <p className="py-4 text-center text-xs text-ink-3">已读到末尾 · 共 {totalCount} 楼</p>
            ) : null}
          </div>
        </div>
        {timeline ? <FloorCapsule {...timeline} /> : null}
      </div>
      {timeline ? <TopicTimeline {...timeline} /> : null}
      {detail && !detail.closed && composerOpen ? composer : null}
    </div>
  );
}
