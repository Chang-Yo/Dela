import { Eye, Mail, MessageSquare, Pin } from 'lucide-react';
import type { ShuiyuanTopicSummary } from '../../../shared/api';
import { ShuiyuanTitle } from './shuiyuan-emoji';
import { categoryOf, useShuiyuan } from './store';
import { formatCount, formatListDate } from './shuiyuan-format';

function TopicRow({ topic, showExcerpt }: { topic: ShuiyuanTopicSummary; showExcerpt: boolean }) {
  const structure = useShuiyuan((state) => state.structure);
  const openTopic = useShuiyuan((state) => state.openTopic);
  const category = categoryOf(structure, topic.categoryId);
  return (
    <button
      className="flex w-full flex-col gap-1.5 border-b border-border/60 px-1 py-3.5 text-left transition-colors last:border-0 hover:bg-muted/40"
      onClick={() => void openTopic(topic.id)}
      type="button"
    >
      <div className="flex items-start gap-1.5">
        {topic.pinned ? (
          <Pin aria-label="置顶" className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
        <span className="line-clamp-2 text-[15px] font-medium leading-snug">
          <ShuiyuanTitle text={topic.title} />
        </span>
      </div>
      {showExcerpt && topic.excerpt ? (
        <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
          {topic.excerpt}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          {category ? (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              {category.name}
            </span>
          ) : null}
          {topic.archetype === 'private_message' ? (
            <span className="flex items-center gap-1">
              <Mail className="size-3" />
              私信
            </span>
          ) : null}
          {topic.tags.slice(0, 2).map((tag) => (
            <span className="rounded bg-muted px-1.5 py-px" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex items-center gap-1" title="回复数">
            <MessageSquare aria-hidden="true" className="size-3" strokeWidth={1.8} />
            {topic.postsCount > 1 ? topic.postsCount - 1 : 0}
            <span className="sr-only">回复</span>
          </span>
          <span className="flex items-center gap-1" title="浏览数">
            <Eye aria-hidden="true" className="size-3" strokeWidth={1.8} />
            {formatCount(topic.views)}
            <span className="sr-only">浏览</span>
          </span>
          <span>{formatListDate(topic.lastPostedAt ?? topic.createdAt)}</span>
        </div>
      </div>
    </button>
  );
}

/** 单列信息流：站点 feed 与私信会话共用；搜索/精品带摘要行。 */
export function TopicFeed() {
  const list = useShuiyuan((state) => state.list);
  const topics = useShuiyuan((state) => state.topics);
  const moreUrl = useShuiyuan((state) => state.moreUrl);
  const loading = useShuiyuan((state) => state.listLoading);
  const error = useShuiyuan((state) => state.listError);
  const loadMore = useShuiyuan((state) => state.loadMore);
  const refreshList = useShuiyuan((state) => state.refreshList);
  const showExcerpt = list.kind === 'search' || list.kind === 'featured';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-1 max-md:px-3">
      {topics.map((topic) => (
        <TopicRow
          key={`${topic.id}-${topic.lastPostedAt ?? ''}`}
          topic={topic}
          showExcerpt={showExcerpt}
        />
      ))}
      {loading ? <p className="p-4 text-xs text-muted-foreground">加载中…</p> : null}
      {!loading && !error && topics.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          {list.kind === 'search'
            ? '没有匹配的帖子'
            : list.kind === 'messages'
              ? '暂无私信'
              : '暂无帖子'}
        </p>
      ) : null}
      {error ? (
        <div
          className="mx-1 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
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
      {moreUrl && !loading ? <ButtonOrDivider onMore={() => void loadMore()} /> : null}
    </div>
  );
}

function ButtonOrDivider({ onMore }: { onMore: () => void }) {
  return (
    <button
      className="mx-auto my-4 flex h-8 items-center rounded-md px-4 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={onMore}
      type="button"
    >
      加载更多
    </button>
  );
}
