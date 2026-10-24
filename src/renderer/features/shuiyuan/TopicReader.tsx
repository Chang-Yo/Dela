import { useCallback, useEffect, useRef, useState } from 'react';
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
import { categoryOf, useShuiyuan } from './store';
import { avatarUrl, formatCount, formatListDate, tagColor } from './shuiyuan-format';
import { ShuiyuanHtmlBody } from './ShuiyuanHtmlBody';
import { ReplyComposer } from './ReplyComposer';
import { AddToProjectDialog } from './AddToProjectDialog';
import { CategoryTag } from './TopicFeed';
import type { ShuiyuanPost } from '../../../shared/api';

function stripToText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

type PostActionsProps = {
  post: ShuiyuanPost;
  onLike: (postId: number, liked: boolean) => void;
  onQuote: (post: ShuiyuanPost) => void;
  onReply: (post: ShuiyuanPost) => void;
};

/**
 * 楼层操作行（Discourse 式全 ghost，默认降透明、悬停/聚焦所在楼层时浮现）。
 * 站点实测（2026-09-21）：点赞可用；User API Key 无法取消点赞，已赞状态按钮不可再点。
 */
function PostActions({ post, onLike, onQuote, onReply }: PostActionsProps) {
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
 * 楼层接近底部时自动分段加载；推入动画由外层负责。
 */
export function TopicReader() {
  const reading = useShuiyuan((state) => state.reading);
  const structure = useShuiyuan((state) => state.structure);
  const openTopic = useShuiyuan((state) => state.openTopic);
  const loadMorePosts = useShuiyuan((state) => state.loadMorePosts);
  const submitReply = useShuiyuan((state) => state.submitReply);
  const setLiked = useShuiyuan((state) => state.setLiked);
  const [draft, setDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  /** 楼层级回复目标；null 为主题级回复。 */
  const [replyTarget, setReplyTarget] = useState<{ postNumber: number; username: string } | null>(
    null,
  );
  /** 跳转落点楼层短暂高亮，让「回到底楼」的落点可辨认。 */
  const [highlight, setHighlight] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const detail = reading?.detail ?? null;
  const isPM = detail?.archetype === 'private_message';
  const category = categoryOf(structure, detail?.categoryId ?? null);

  useEffect(() => {
    const targetPostNumber = reading?.postNumber;
    if (!detail || targetPostNumber === null || targetPostNumber === undefined) return;
    scrollRef.current
      ?.querySelector(`[data-post-number="${targetPostNumber}"]`)
      ?.scrollIntoView({ block: 'start' });
  }, [detail?.id, reading?.postNumber]);

  const loadedCount = detail?.posts.length ?? 0;
  const totalCount = detail?.postsCount ?? 0;
  const hasMorePosts = detail ? loadedCount < totalCount : false;

  // 阅读器式的连续加载：哨兵进入视口前 320px 即取下一批楼层。
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMorePosts) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || loadingRef.current) return;
        loadingRef.current = true;
        setLoadingMore(true);
        void loadMorePosts().finally(() => {
          loadingRef.current = false;
          setLoadingMore(false);
        });
      },
      { root, rootMargin: '320px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMorePosts, loadMorePosts, loadedCount]);

  // 稳定引用：避免每次渲染都让各楼层 iframe 的 message 监听解绑重挂。
  const openTopicFromPost = useCallback(
    (topicId: number, postNumber?: number) => void openTopic(topicId, postNumber),
    [openTopic],
  );

  const appendQuote = (username: string, postNumber: number, snippet: string) => {
    setComposerOpen(true);
    setDraft((current) => `${current}> **@${username}**（第 ${postNumber} 楼）：${snippet}\n\n`);
  };

  const quote = (username: string, postNumber: number, cooked: string) => {
    const snippet = stripToText(cooked).trim().slice(0, 120);
    if (snippet) appendQuote(username, postNumber, `${snippet}…`);
  };

  const jumpToPost = (postNumber: number) => {
    if (!detail) return;
    const loaded = detail.posts.some((item) => item.postNumber === postNumber);
    if (loaded) {
      scrollRef.current
        ?.querySelector(`[data-post-number="${postNumber}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlight(postNumber);
      window.setTimeout(
        () => setHighlight((current) => (current === postNumber ? null : current)),
        1500,
      );
    } else {
      void openTopic(detail.id, postNumber);
    }
  };

  const placeholder = replyTarget ? `回复 @${replyTarget.username}…` : isPM ? '回复私信…' : '回复…';
  const composer = (
    <ReplyComposer
      disabledHint={detail?.closed ? '帖子已关闭，无法回复' : null}
      expanded={composerOpen}
      onChange={setDraft}
      onExpandedChange={setComposerOpen}
      onClearReplyTarget={() => setReplyTarget(null)}
      onSubmit={async () => {
        await submitReply(draft, replyTarget?.postNumber);
        setDraft('');
        setReplyTarget(null);
        setComposerOpen(false);
      }}
      placeholder={placeholder}
      replyTarget={replyTarget}
      submitLabel={isPM ? '发送私信' : '发布回复'}
      value={draft}
    />
  );

  return (
    // relative 是回复器全屏书写态的定位锚点：铺满阅读区、不遮全局外壳。
    <div className="relative flex h-full min-h-0 flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="mx-auto w-full max-w-2xl px-5 py-5 max-md:px-4">
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
            <header className="border-b border-line pb-4">
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
                        onClick={() => jumpToPost(post.replyToPostNumber!)}
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
                    onQuote={(target) => quote(target.username, target.postNumber, target.cooked)}
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
          {detail && hasMorePosts ? (
            <div className="grid h-10 place-items-center" ref={sentinelRef}>
              {loadingMore ? <span className="text-xs text-ink-3">正在加载楼层…</span> : null}
            </div>
          ) : null}
          {detail && !hasMorePosts && detail.posts.length > 1 ? (
            <p className="py-4 text-center text-xs text-ink-3">已读到末尾 · 共 {totalCount} 楼</p>
          ) : null}
        </div>
      </div>
      {/* 回复框常驻底部，从底边向上展开；帖子已关闭时由 composer 呈现只读提示。 */}
      {detail ? composer : null}
    </div>
  );
}
