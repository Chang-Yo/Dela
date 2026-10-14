import { useEffect, useRef } from 'react';
import { Bookmark, Loader2, Lock, Mail, MessageSquare, Pin } from 'lucide-react';
import type { ShuiyuanTopicSummary } from '../../../shared/api';
import { cn } from '../../lib/utils';
import { ShuiyuanTitle } from './shuiyuan-emoji';
import { categoryOf, isTopicUnread, useShuiyuan } from './store';
import { avatarUrl, formatCount, formatListDate, tagColor } from './shuiyuan-format';

/** 分类色索引（Discourse 式）：12px 色方 + 文字，颜色只做索引不做底色。 */
export function CategoryTag({ category }: { category: { name: string; color: string } }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-[0.125rem]"
        style={{ backgroundColor: category.color }}
      />
      <span className="truncate">{category.name}</span>
    </span>
  );
}

/** 行首头像：远程头像直接渲染，缺省时退回首字母占位圆。 */
function TopicAvatar({ topic }: { topic: ShuiyuanTopicSummary }) {
  const url = avatarUrl(topic.authorAvatarTemplate, 96);
  if (url) {
    return (
      <img
        alt=""
        className="mt-0.5 size-10 shrink-0 rounded-full object-cover max-md:size-8"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={url}
      />
    );
  }
  const initial = topic.authorUsername?.trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-inset text-13 font-medium text-ink-3 max-md:size-8"
    >
      {initial || '…'}
    </span>
  );
}

function TopicRow({
  topic,
  showExcerpt,
  unread,
}: {
  topic: ShuiyuanTopicSummary;
  showExcerpt: boolean;
  unread: boolean;
}) {
  const structure = useShuiyuan((state) => state.structure);
  const openTopic = useShuiyuan((state) => state.openTopic);
  const category = categoryOf(structure, topic.categoryId);
  const isPM = topic.archetype === 'private_message';
  return (
    <button
      className={cn(
        'flex w-full items-start gap-3.5 rounded-card border border-line p-5 text-left shadow-hairline transition-colors max-md:p-4',
        topic.pinned ? 'bg-inset hover:bg-hover-2' : 'bg-surface hover:bg-hover',
      )}
      onClick={() => void openTopic(topic.id)}
      type="button"
    >
      <TopicAvatar topic={topic} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-2">
          {topic.pinned ? (
            <Pin aria-label="置顶" className="mt-1 size-3.5 shrink-0 text-ink-3" />
          ) : null}
          {topic.closed ? (
            <Lock aria-label="已关闭" className="mt-1 size-3.5 shrink-0 text-ink-3" />
          ) : null}
          <span
            className={cn(
              'line-clamp-2 text-base leading-snug',
              unread ? 'font-semibold text-ink' : 'font-medium text-ink-2',
            )}
          >
            <ShuiyuanTitle text={topic.title} />
          </span>
        </div>
        {showExcerpt && topic.excerpt ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-ink-3">{topic.excerpt}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-3">
          {/* 次级元信息一行排开：分类 · 作者 · 标签，纯文字弱化，标题是唯一主角。 */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {category && !isPM ? <CategoryTag category={category} /> : null}
            {isPM ? (
              <span className="flex items-center gap-1">
                <Mail aria-hidden="true" className="size-3" strokeWidth={1.8} />
                私信
              </span>
            ) : null}
            {topic.authorUsername ? (
              <span className="max-w-48 truncate">{topic.authorUsername}</span>
            ) : null}
            {topic.tags.slice(0, 2).map((tag) => (
              <span className="flex items-center gap-1.5" key={tag}>
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-[0.125rem]"
                  style={{ backgroundColor: tagColor(tag) }}
                />
                {tag}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-3 whitespace-nowrap tabular-nums">
            <span className="flex min-w-14 items-center justify-end gap-1" title="回复数">
              <MessageSquare aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
              {formatCount(Math.max(topic.postsCount - 1, 0))}
              <span className="sr-only">回复</span>
            </span>
            {topic.bookmarked ? (
              <Bookmark aria-label="已收藏" className="size-3.5 fill-current" />
            ) : null}
            <span>{formatListDate(topic.lastPostedAt ?? topic.createdAt)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function TopicCardSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-card border border-line bg-surface p-5 max-md:p-4">
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 size-10 shrink-0 animate-pulse rounded-full bg-inset max-md:size-8" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 py-0.5">
          <div className="h-5 w-2/3 animate-pulse rounded-chip bg-inset" />
          <div className="h-3 w-1/3 animate-pulse rounded-chip bg-inset" />
        </div>
      </div>
    </div>
  );
}

/** 单列信息流：站点 feed 与私信会话共用；搜索/精品带摘要行。 */
export function TopicFeed() {
  const list = useShuiyuan((state) => state.list);
  const topics = useShuiyuan((state) => state.topics);
  const moreUrl = useShuiyuan((state) => state.moreUrl);
  const loading = useShuiyuan((state) => state.listLoading);
  const error = useShuiyuan((state) => state.listError);
  const readMarks = useShuiyuan((state) => state.readMarks);
  const reading = useShuiyuan((state) => state.reading !== null);
  const refreshList = useShuiyuan((state) => state.refreshList);
  const showExcerpt = list.kind === 'search' || list.kind === 'featured';
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 滑到底部自动加载下一页。阅读页盖住列表期间暂停（几何上哨兵仍“可见”），
  // 关闭阅读后依赖变化重建观察器即可恢复；出错也停住，交由错误横幅的重试。
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !moreUrl) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      const state = useShuiyuan.getState();
      if (state.listLoading || state.listError || state.reading) return;
      void state.loadMore();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [moreUrl, loading, reading, topics.length]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 pb-10 pt-4 max-md:px-3">
      {topics.map((topic) => (
        <TopicRow
          key={`${topic.id}-${topic.lastPostedAt ?? ''}`}
          topic={topic}
          showExcerpt={showExcerpt}
          unread={isTopicUnread(readMarks, topic)}
        />
      ))}
      {loading && topics.length === 0
        ? Array.from({ length: 5 }, (_, index) => <TopicCardSkeleton key={index} />)
        : null}
      {moreUrl && !error ? (
        <div
          aria-hidden={!loading}
          className="flex h-9 items-center justify-center text-ink-3"
          ref={sentinelRef}
        >
          {loading ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : null}
        </div>
      ) : null}
      {!loading && !error && topics.length === 0 ? (
        <p className="px-1 py-8 text-center text-13 text-ink-3">
          {list.kind === 'search'
            ? '没有匹配的帖子'
            : list.kind === 'messages'
              ? '暂无私信'
              : '暂无帖子'}
        </p>
      ) : null}
      {error ? (
        <div
          className="mt-3 rounded-card border border-line border-destructive/30 bg-red-tint px-3 py-2 text-xs text-red"
          role="alert"
        >
          {error}
          <button
            className="ml-2 underline underline-offset-2"
            onClick={() => void refreshList()}
            type="button"
          >
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}
