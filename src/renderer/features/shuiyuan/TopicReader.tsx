import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { ShuiyuanTitle } from './shuiyuan-emoji';
import { categoryOf, loadedSpan, useShuiyuan } from './store';
import { avatarUrl, formatCount, formatListDate, tagColor } from './shuiyuan-format';
import { ShuiyuanHtmlBody } from './ShuiyuanHtmlBody';
import { ReplyComposer } from './ReplyComposer';
import { AddToProjectDialog } from './AddToProjectDialog';
import { CategoryTag } from './TopicFeed';
import { FloorCapsule, TopicTimeline } from './TopicTimeline';
import type { ShuiyuanPost } from '../../../shared/api';

type ReplyTarget = { postNumber: number; username: string };

/* 回复草稿按帖子在本次会话内记忆：返回信息流、楼内链接切帖后回来仍在，不持久化。 */
const replyDrafts = new Map<number, { text: string; target: ReplyTarget | null }>();

/** 楼层正文转引用文本：去掉楼中嵌套的引用，块级元素之间保留换行。 */
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

/**
 * 楼层操作行（Discourse 式全 ghost，默认降透明、悬停/聚焦所在楼层时浮现）。
 * 站点实测（2026-09-21）：点赞可用；User API Key 无法取消点赞，已赞状态按钮不可再点。
 */
function PostActions({ post, canReply, onLike, onQuote, onReply }: PostActionsProps) {
  const likeCount = post.likeCount ?? 0;
  return (
    <footer className="mt-2.5 flex items-center justify-end gap-1 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
      <button
        aria-label={post.liked ? '已喜爱（取消需到水源网页端）' : '喜爱'}
        className={cn(
          'flex h-7 items-center gap-1 rounded-control px-1.5 text-xs tabular-nums transition-colors hover:bg-hover',
          post.liked ? 'cursor-default text-red' : 'text-ink-3 hover:text-ink',
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
          <button
            aria-label={`引用第 ${post.postNumber} 楼`}
            className="grid size-7 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            onClick={() => onQuote(post)}
            title="引用"
            type="button"
          >
            <Quote className="size-3.5" strokeWidth={1.8} />
          </button>
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

/**
 * 阅读页顶栏：驻留在视图顶层，进入阅读时与信息流工具栏原地互换（无动画），
 * 不随楼层流推入。只保留返回、标题与动作——分类、标签、统计归正文标题区。
 */
export function TopicReaderHeader() {
  const reading = useShuiyuan((state) => state.reading);
  const closeReading = useShuiyuan((state) => state.closeReading);
  const toggleBookmark = useShuiyuan((state) => state.toggleBookmark);
  const [addOpen, setAddOpen] = useState(false);
  const detail = reading?.detail ?? null;
  const isPM = detail?.archetype === 'private_message';

  return (
    <header className="flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur max-md:px-2">
      <Button aria-label="返回信息流" onClick={closeReading} size="icon-sm" variant="ghost">
        <ArrowLeft className="size-4" strokeWidth={1.8} />
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-13 font-medium leading-tight">
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
          onClick={() => void window.dela?.shuiyuan.openInBrowser(detail.id)}
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

/** 楼层头像：40px 圆形（Discourse 45px 沟槽的贴近档），缺省退回首字母占位圆。 */
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

/**
 * 阅读页主体：话题标题区（大标题 + 分类/标签/统计）+ 居中楼层流
 * （固定头像沟槽 + 楼底右对齐 ghost 操作条）+ 底部向上展开的回复框。
 * 楼层接近两端时自动分段补楼，右侧楼层进度可拖动跳楼；推入动画由外层负责。
 */
export function TopicReader() {
  const reading = useShuiyuan((state) => state.reading);
  const structure = useShuiyuan((state) => state.structure);
  const openTopic = useShuiyuan((state) => state.openTopic);
  const loadMorePosts = useShuiyuan((state) => state.loadMorePosts);
  const loadPostWindow = useShuiyuan((state) => state.loadPostWindow);
  const submitReply = useShuiyuan((state) => state.submitReply);
  const setLiked = useShuiyuan((state) => state.setLiked);
  // 阅读器按 topicId 重挂载，挂载时的 topicId 即本实例的帖子。
  const [topicId] = useState(() => useShuiyuan.getState().reading?.topicId ?? 0);
  const [draft, setDraft] = useState(() => replyDrafts.get(topicId)?.text ?? '');
  const [composerOpen, setComposerOpen] = useState(() => replyDrafts.has(topicId));
  /** 楼层级回复目标；null 为主题级回复。 */
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(
    () => replyDrafts.get(topicId)?.target ?? null,
  );
  /** 跳转落点楼层短暂高亮，让落点可辨认。 */
  const [highlight, setHighlight] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState<'before' | 'after' | null>(null);
  /** 视口顶端所在楼层，驱动楼层进度。 */
  const [currentPost, setCurrentPost] = useState<number | null>(null);
  /** 跳到未加载区域：新楼层段提交到 DOM 后再定位。 */
  const [pendingJump, setPendingJump] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  /** 首个已加载楼层最近一次的视口位置，向上补楼后据此回补滚动。 */
  const firstPostRef = useRef<{ postNumber: number; top: number; atTop: boolean } | null>(null);
  const trackFrameRef = useRef(0);
  const detail = reading?.detail ?? null;
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
    if (detail && reading?.postNumber) scrollToPost(reading.postNumber, false);
  }, [detail?.id, reading?.postNumber]);

  useLayoutEffect(() => {
    if (pendingJump === null) return;
    scrollToPost(pendingJump, false);
    setPendingJump(null);
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
        void loadMorePosts(direction).finally(() => {
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
  }, [hasBefore, hasAfter, loadMorePosts, posts]);

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
    await loadPostWindow(postNumber);
    setPendingJump(postNumber);
  };

  const jumpRef = useRef(jumpToPost);
  jumpRef.current = jumpToPost;
  // 稳定引用：避免每次渲染都让各楼层 iframe 的 message 监听解绑重挂。
  // 指向本帖的链接在当前阅读流内跳楼，不整帖重载。
  const openTopicFromPost = useCallback(
    (targetTopicId: number, postNumber?: number) => {
      if (targetTopicId === topicId) {
        void jumpRef.current(postNumber ?? 1);
      } else {
        void openTopic(targetTopicId, postNumber);
      }
    },
    [openTopic, topicId],
  );

  useEffect(() => {
    if (draft.trim() || replyTarget) replyDrafts.set(topicId, { text: draft, target: replyTarget });
    else replyDrafts.delete(topicId);
  }, [draft, replyTarget, topicId]);

  // 水源原生引用：站点渲染成带头像的引用卡片，并通知被引用者。
  const quote = (post: ShuiyuanPost) => {
    const text = quoteText(post.cooked);
    if (!text) return;
    setComposerOpen(true);
    setDraft((current) => {
      const head = current ? `${current.replace(/\n+$/, '')}\n\n` : '';
      return `${head}[quote="${post.username}, post:${post.postNumber}, topic:${topicId}"]\n${text}\n[/quote]\n\n`;
    });
  };

  const placeholder = replyTarget ? `回复 @${replyTarget.username}…` : isPM ? '回复私信…' : '回复…';
  const composer = (
    <ReplyComposer
      onChange={setDraft}
      onClose={() => setComposerOpen(false)}
      onClearReplyTarget={() => setReplyTarget(null)}
      onSubmit={async () => {
        const postNumber = await submitReply(draft, replyTarget?.postNumber);
        setDraft('');
        setReplyTarget(null);
        setComposerOpen(false);
        // 新楼没并进已加载段（中段阅读时）就先取它附近的一段，再定位过去；期间已切帖则不动。
        const current = useShuiyuan.getState().reading;
        if (current?.topicId !== topicId) return;
        const loaded = current.detail?.posts.some((post) => post.postNumber === postNumber);
        if (!loaded) await loadPostWindow(postNumber);
        setPendingJump(postNumber);
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
          {/* 窄版楼层胶囊浮在正文列右下角，底部留白避免它压住末楼的操作条。 */}
          <div className="mx-auto w-full max-w-2xl px-5 pt-5 pb-14 max-md:px-4 @min-[62rem]:pb-5">
            {reading?.error ? (
              <div
                className="rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-xs text-red"
                role="alert"
              >
                {reading.error}
              </div>
            ) : null}
            {!detail && !reading?.error ? (
              <p className="py-8 text-center text-13 text-ink-3">正在加载帖子…</p>
            ) : null}
            {detail ? (
              // 话题标题区：正文列同宽，分类/标签/统计一行弱化呈现（Discourse 式）。
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
                    highlight === post.postNumber && 'bg-bui-accent-tint',
                  )}
                  data-post-number={post.postNumber}
                  key={post.id}
                >
                  {/* 固定头像沟槽：正文永不绕到头像下方，扫读锚点逐楼对齐。 */}
                  <PostAvatar post={post} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {/* 用户名压小加粗成「标签」，与 15px 常规正文的 iframe 内容拉开层级。 */}
                      <span className="min-w-0 shrink truncate text-xs font-semibold">
                        {post.username}
                      </span>
                      {post.yours ? (
                        <span className="shrink-0 rounded bg-inset px-1.5 py-px text-2xs text-ink-3">
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
                      onLike={(postId, liked) => void setLiked(postId, liked)}
                      onReply={(target) => {
                        setReplyTarget({
                          postNumber: target.postNumber,
                          username: target.username,
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
