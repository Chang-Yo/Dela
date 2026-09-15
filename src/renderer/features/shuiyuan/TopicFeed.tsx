import { Mail, Pin } from 'lucide-react';
import type { ShuiyuanTopicSummary } from '../../../shared/api';
import { categoryOf, useShuiyuan } from './store';
import { formatCount, formatListDate } from './shuiyuan-format';

function TopicRow({ topic, showExcerpt }: { topic: ShuiyuanTopicSummary; showExcerpt: boolean }) {
  const structure = useShuiyuan((state) => state.structure);
  const openTopic = useShuiyuan((state) => state.openTopic);
  const category = categoryOf(structure, topic.categoryId);
  return (
    <button
      className="flex w-full flex-col gap-1.5 border-b border-border/60 px-1 py-3 text-left transition-colors hover:bg-muted/40"
      onClick={() => void openTopic(topic.id)}
      type="button"
    >
      <div className="flex items-start gap-1.5">
        {topic.pinned ? (
          <Pin aria-label="置顶" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
        <span className="line-clamp-2 text-sm font-medium leading-snug">{topic.title}</span>
      </div>
      {showExcerpt && topic.excerpt ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {topic.excerpt}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
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
        {topic.archetype === 'private_message' ? (
          <span className="flex items-center gap-0.5">
            <Mail className="size-3" />
            私信
          </span>
        ) : null}
        {topic.tags.slice(0, 2).map((tag) => (
          <span className="rounded bg-secondary px-1.5 py-px" key={tag}>
            {tag}
          </span>
        ))}
        <span>{topic.postsCount > 1 ? `回复 ${topic.postsCount - 1}` : '暂无回复'}</span>
        <span aria-hidden="true">·</span>
        <span>浏览 {formatCount(topic.views)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatListDate(topic.lastPostedAt ?? topic.createdAt)}</span>
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
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 max-md:px-3">
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
      className="mx-auto my-4 flex h-8 items-center rounded-md border px-4 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={onMore}
      type="button"
    >
      加载更多
    </button>
  );
}
