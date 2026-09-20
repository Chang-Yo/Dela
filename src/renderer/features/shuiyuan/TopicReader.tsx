import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ChevronRight,
  CornerUpLeft,
  ExternalLink,
  FolderPlus,
  Heart,
  Mail,
  PenLine,
  Quote,
  Reply,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { categoryOf, useShuiyuan } from './store';
import { avatarUrl, formatCount, formatListDate } from './shuiyuan-format';
import { ShuiyuanHtmlBody } from './ShuiyuanHtmlBody';
import { ReplyComposer } from './ReplyComposer';
import { AddToProjectDialog } from './AddToProjectDialog';

function stripToText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/** 宽屏（≥1024px）时回复器停靠右侧栏（按需展开）；窄屏退回底部折叠条。 */
function useDockedComposer(): boolean {
  const [docked, setDocked] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setDocked(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return docked;
}

/**
 * 阅读页顶栏：驻留在视图顶层，进入阅读时与信息流工具栏原地互换（无动画），
 * 不随楼层流推入。
 */
export function TopicReaderHeader() {
  const reading = useShuiyuan((state) => state.reading);
  const structure = useShuiyuan((state) => state.structure);
  const closeReading = useShuiyuan((state) => state.closeReading);
  const toggleBookmark = useShuiyuan((state) => state.toggleBookmark);
  const [addOpen, setAddOpen] = useState(false);
  const detail = reading?.detail ?? null;
  const isPM = detail?.archetype === 'private_message';
  const category = categoryOf(structure, detail?.categoryId ?? null);
  const firstPost = detail?.posts[0];
  const opAvatar = firstPost ? avatarUrl(firstPost.avatarTemplate, 48) : null;

  return (
    <header className="flex items-center gap-2.5 border-b bg-background/95 px-3 py-2 backdrop-blur max-md:gap-2 max-md:px-2">
      <Button aria-label="返回信息流" onClick={closeReading} size="icon-sm" variant="ghost">
        <ArrowLeft className="size-4" strokeWidth={1.8} />
      </Button>
      {opAvatar ? (
        <img
          alt=""
          className="hidden size-7 rounded-full sm:block"
          referrerPolicy="no-referrer"
          src={opAvatar}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[13px] font-semibold leading-tight">
          {detail?.title ?? '正在加载…'}
        </h1>
        {detail ? (
          <p className="mt-0.5 flex items-center gap-x-2 truncate text-[11px] tabular-nums text-muted-foreground">
            <span>
              {detail.postsCount} 楼 · 浏览 {formatCount(detail.views)} · 发布于{' '}
              {formatListDate(detail.createdAt)}
            </span>
          </p>
        ) : null}
      </div>
      {detail ? (
        <div aria-label="分类与标签" className="hidden items-center gap-1.5 md:flex">
          {isPM ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Mail aria-hidden="true" className="size-3" />
              私信
            </span>
          ) : category ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              {category.name}
            </span>
          ) : null}
          {detail.tags.slice(0, 3).map((tag) => (
            <span className="flex items-center gap-1.5" key={tag}>
              <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground/50" />
              <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
                {tag}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {detail && !isPM ? (
        <Button
          aria-label={detail.bookmarked ? '取消收藏' : '收藏'}
          onClick={() => void toggleBookmark(detail.id, detail.bookmarked)}
          size="icon-sm"
          variant="ghost"
        >
          <Heart
            className={cn('size-4', detail.bookmarked && 'fill-current text-primary')}
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
          onClick={() =>
            window.open(
              `${'https://shuiyuan.sjtu.edu.cn'}/t/topic/${detail.id}`,
              '_blank',
              'noopener',
            )
          }
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

/**
 * 阅读页主体：居中楼层流 + 按需展开的右侧回复栏 + 底部折叠入口。
 * 楼层接近底部时自动分段加载；推入动画由外层负责。
 */
export function TopicReader() {
  const reading = useShuiyuan((state) => state.reading);
  const openTopic = useShuiyuan((state) => state.openTopic);
  const loadMorePosts = useShuiyuan((state) => state.loadMorePosts);
  const submitReply = useShuiyuan((state) => state.submitReply);
  const docked = useDockedComposer();
  const [draft, setDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  /** 楼层级回复目标；null 为主题级回复。 */
  const [replyTarget, setReplyTarget] = useState<{ postNumber: number; username: string } | null>(
    null,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const detail = reading?.detail ?? null;
  const isPM = detail?.archetype === 'private_message';

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

  const quote = (username: string, postNumber: number, cooked: string) => {
    const snippet = stripToText(cooked).trim().slice(0, 120);
    const quoteText = snippet ? `> **@${username}**（第 ${postNumber} 楼）：${snippet}…\n\n` : '';
    setComposerOpen(true);
    setDraft((current) => `${current}${quoteText}`);
  };

  const placeholder = replyTarget ? `回复 @${replyTarget.username}…` : isPM ? '回复私信…' : '回复…';
  const composer = (variant: 'docked' | 'floating') => (
    <ReplyComposer
      disabledHint={detail?.closed ? '帖子已关闭，无法回复' : null}
      expanded={composerOpen}
      onChange={setDraft}
      onExpandedChange={setComposerOpen}
      onClearReplyTarget={() => setReplyTarget(null)}
      onCollapse={() => setComposerOpen(false)}
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
      variant={variant}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
            <div className="mx-auto w-full max-w-2xl px-5 py-4 max-md:px-4">
              {reading?.error ? (
                <div
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  role="alert"
                >
                  {reading.error}
                </div>
              ) : null}
              {!detail && !reading?.error ? (
                <p className="py-8 text-center text-sm text-muted-foreground">正在加载帖子…</p>
              ) : null}
              {detail?.posts.map((post) => {
                const avatar = avatarUrl(post.avatarTemplate, 48);
                const repliedTo = post.replyToPostNumber
                  ? detail.posts.find((item) => item.postNumber === post.replyToPostNumber)
                  : null;
                return (
                  <article
                    className="group border-b border-border/60 py-4 last:border-0"
                    data-post-number={post.postNumber}
                    key={post.id}
                  >
                    <div className="flex items-center gap-2">
                      {avatar ? (
                        <img
                          alt=""
                          className="size-7 rounded-full"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          src={avatar}
                        />
                      ) : null}
                      <span className="text-[13px] font-medium">{post.username}</span>
                      {post.yours ? (
                        <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                          你
                        </span>
                      ) : null}
                      <span className="truncate text-[11px] tabular-nums text-muted-foreground">
                        第 {post.postNumber} 楼 · {formatListDate(post.createdAt)}
                      </span>
                      {repliedTo ? (
                        <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                          <CornerUpLeft aria-hidden="true" className="size-3" />
                          {repliedTo.username}
                        </span>
                      ) : null}
                      <div className="flex-1" />
                      {post.likeCount ? (
                        <span className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                          <Heart aria-hidden="true" className="size-3" />
                          {post.likeCount}
                        </span>
                      ) : null}
                      <button
                        aria-label={`回复第 ${post.postNumber} 楼`}
                        className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
                        onClick={() => {
                          setReplyTarget({ postNumber: post.postNumber, username: post.username });
                          setComposerOpen(true);
                        }}
                        title="回复"
                        type="button"
                      >
                        <Reply className="size-3.5" />
                      </button>
                      <button
                        aria-label={`引用第 ${post.postNumber} 楼`}
                        className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
                        onClick={() => quote(post.username, post.postNumber, post.cooked)}
                        title="引用"
                        type="button"
                      >
                        <Quote className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-2">
                      <ShuiyuanHtmlBody
                        html={post.cooked}
                        onOpenTopic={openTopicFromPost}
                        title={`第 ${post.postNumber} 楼`}
                      />
                    </div>
                  </article>
                );
              })}
              {detail && hasMorePosts ? (
                <div className="grid h-10 place-items-center" ref={sentinelRef}>
                  {loadingMore ? (
                    <span className="text-xs text-muted-foreground">正在加载楼层…</span>
                  ) : null}
                </div>
              ) : null}
              {detail && !hasMorePosts && detail.posts.length > 1 ? (
                <p className="py-4 text-center text-[11px] text-muted-foreground">
                  已读到末尾 · 共 {totalCount} 楼
                </p>
              ) : null}
            </div>
          </div>
          {/* 回复栏收起时的安静入口，样式与 floating 折叠态一致；帖子已关闭时不出现。 */}
          {docked && detail && !composerOpen && !detail.closed ? (
            <div className="border-t bg-background px-5 py-3 max-md:px-4">
              <button
                className="mx-auto flex h-9 w-full max-w-2xl items-center gap-2 rounded-xl border border-input bg-background px-3 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent/50"
                onClick={() => setComposerOpen(true)}
                type="button"
              >
                <PenLine aria-hidden="true" className="size-4" strokeWidth={1.8} />
                {placeholder}
              </button>
            </div>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
          {docked && detail && composerOpen ? (
            <motion.aside
              animate={{ opacity: 1, width: 340 }}
              className="shrink-0 overflow-hidden"
              exit={{ opacity: 0, width: 0 }}
              initial={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18 }}
            >
              {/* 内容固定宽度并右锚定：编辑器不随宽度动画逐帧重排。 */}
              <div className="ml-auto flex h-full w-[340px] flex-col">{composer('docked')}</div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>

      {!docked && detail ? composer('floating') : null}
    </div>
  );
}
