import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, FolderPlus, Heart, Quote } from 'lucide-react';
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

/** 阅读页：返回栏 + 楼层流 + 分段加载 + 底部回复器（推入动画由外层负责）。 */
export function TopicReader() {
  const reading = useShuiyuan((state) => state.reading);
  const structure = useShuiyuan((state) => state.structure);
  const closeReading = useShuiyuan((state) => state.closeReading);
  const loadMorePosts = useShuiyuan((state) => state.loadMorePosts);
  const toggleBookmark = useShuiyuan((state) => state.toggleBookmark);
  const submitReply = useShuiyuan((state) => state.submitReply);
  const [draft, setDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const detail = reading?.detail ?? null;
  const isPM = detail?.archetype === 'private_message';

  // 切换帖子时重置输入态。
  useEffect(() => {
    setDraft('');
    setComposerOpen(false);
  }, [reading?.topicId]);

  const loadedCount = detail?.posts.length ?? 0;
  const totalCount = detail?.postsCount ?? 0;
  const hasMorePosts = detail ? loadedCount < totalCount : false;

  const quote = (username: string, postNumber: number, cooked: string) => {
    const snippet = stripToText(cooked).trim().slice(0, 120);
    const quoteText = snippet ? `> **@${username}**（第 ${postNumber} 楼）：${snippet}…\n\n` : '';
    setComposerOpen(true);
    setDraft((current) => `${current}${quoteText}`);
  };

  const category = categoryOf(structure, detail?.categoryId ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-12 items-center gap-2 border-b px-2 py-1.5 max-md:px-1">
        <Button aria-label="返回信息流" onClick={closeReading} size="icon-sm" variant="ghost">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold leading-tight">
            {detail?.title ?? '正在加载…'}
          </h1>
          {detail ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              {category ? (
                <span className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  {category.name}
                </span>
              ) : null}
              {isPM ? <span>私信</span> : null}
              <span>{totalCount} 楼</span>
              <span aria-hidden="true">·</span>
              <span>浏览 {formatCount(detail.views)}</span>
              <span aria-hidden="true">·</span>
              <span>发布于 {formatListDate(detail.createdAt)}</span>
            </p>
          ) : null}
        </div>
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 max-md:px-3">
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
            return (
              <article className="border-b border-border/60 py-4 last:border-0" key={post.id}>
                <div className="flex items-center gap-2">
                  {avatar ? (
                    <img
                      alt=""
                      className="size-6 rounded-full"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      src={avatar}
                    />
                  ) : null}
                  <span className="text-[13px] font-medium">{post.username}</span>
                  <span className="text-[11px] text-muted-foreground">
                    第 {post.postNumber} 楼 · {formatListDate(post.createdAt)}
                  </span>
                  <div className="flex-1" />
                  {post.likeCount ? (
                    <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <Heart aria-hidden="true" className="size-3" />
                      {post.likeCount}
                    </span>
                  ) : null}
                  <button
                    aria-label={`引用第 ${post.postNumber} 楼`}
                    className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => quote(post.username, post.postNumber, post.cooked)}
                    title="引用"
                    type="button"
                  >
                    <Quote className="size-3.5" />
                  </button>
                </div>
                <div className="mt-1.5">
                  <ShuiyuanHtmlBody html={post.cooked} title={`第 ${post.postNumber} 楼`} />
                </div>
              </article>
            );
          })}
          {detail && hasMorePosts ? (
            <button
              className="mx-auto my-4 flex h-8 items-center rounded-md border px-4 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => void loadMorePosts()}
              type="button"
            >
              加载更多楼层（{loadedCount}/{totalCount}）
            </button>
          ) : null}
        </div>
      </div>

      {detail ? (
        <ReplyComposer
          disabledHint={detail.closed ? '帖子已关闭，无法回复' : null}
          expanded={composerOpen}
          onChange={setDraft}
          onExpandedChange={setComposerOpen}
          onSubmit={async () => {
            await submitReply(draft);
            setDraft('');
            setComposerOpen(false);
          }}
          placeholder={isPM ? '回复私信…' : '回复…'}
          submitLabel={isPM ? '发送私信' : '发布回复'}
          value={draft}
        />
      ) : null}

      <AddToProjectDialog
        onClose={() => setAddOpen(false)}
        open={addOpen}
        topicId={detail?.id ?? null}
        topicTitle={detail?.title ?? ''}
      />
    </div>
  );
}
