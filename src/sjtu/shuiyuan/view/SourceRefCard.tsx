import { useEffect, useRef } from 'react';
import { ExternalLink, MessageSquare, RefreshCw, RotateCw } from 'lucide-react';
import type { SourceDocumentProps } from '../../../app/module';
import { errorMessage } from '../../../core/protocol/contract';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/cn';
import { showToast } from '../../../ui/toast';
import type { ShuiyuanSnapshotState } from '../contract';
import { ShuiyuanIcon } from './shuiyuan-icon';
import { ShuiyuanHtmlBody } from './ShuiyuanHtmlBody';
import { ShuiyuanSnapshotBody } from './ShuiyuanSnapshotBody';
import { ShuiyuanTitle } from './shuiyuan-emoji';
import { formatListDate } from './shuiyuan-format';
import { shuiyuanClient, topicIdOf, useSourceRef } from './use-shuiyuan';

/** 文件树行尾的快照保存进度。 */
export function SnapshotBadge({ sourceId }: { sourceId: string }) {
  const snapshot = useSourceRef(topicIdOf(sourceId)).data?.snapshot;
  if (snapshot?.status === 'failed') return '!';
  if (snapshot?.status !== 'saving') return null;
  const progress = snapshot.progress;
  return progress?.total
    ? `${progress.phase === 'posts' ? '楼层' : '图片'} ${Math.floor((progress.done / progress.total) * 100)}%`
    : '…';
}

function SnapshotStatus({
  topicId,
  snapshot,
  content,
  onReload,
}: {
  topicId: number;
  /** undefined 为读取中，null 为尚未保存。 */
  snapshot: ShuiyuanSnapshotState | null | undefined;
  content: SourceDocumentProps['content'];
  onReload: () => void;
}) {
  const savedAt = snapshot?.savedAt ?? null;
  const progress = snapshot?.progress;
  const latest = savedAt ?? progress?.cachedAt ?? null;
  const behind = latest !== null && latest !== content.updatedAt;
  const reading = content.format === 'html';
  // 正文首次可读时自动重读。触发点是 sourceRef 查询数据到达，要改成失效驱动须动 use-shuiyuan。
  useEffect(() => {
    if (behind && !reading) onReload();
  }, [behind, reading, onReload]);
  const refreshSnapshot = () =>
    void shuiyuanClient
      .refreshSnapshot(topicId)
      .catch((cause: unknown) =>
        showToast({ variant: 'error', title: '无法保存快照', description: errorMessage(cause) }),
      );
  const snapshotText =
    snapshot?.status === 'saving'
      ? [
          savedAt ? `快照于 ${formatListDate(savedAt)}，正在更新` : '正在保存快照',
          progress
            ? `${progress.phase === 'posts' ? '楼层' : '图片'} ${progress.done}/${progress.total}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : snapshot?.status === 'failed'
        ? `快照保存失败：${snapshot.error ?? '未知错误'}`
        : savedAt
          ? `快照于 ${formatListDate(savedAt)}`
          : snapshot === null
            ? '尚未保存快照'
            : null;

  return snapshotText ? (
    <div className="flex w-full items-center justify-between gap-2 border-t border-line pt-3">
      <p className={cn('text-xs', snapshot?.status === 'failed' ? 'text-danger' : 'text-ink-3')}>
        {snapshotText}
      </p>
      {behind && reading ? (
        <Button onClick={onReload} size="sm" variant="ghost">
          <RotateCw className="size-3.5" />
          刷新正文
        </Button>
      ) : snapshot?.status !== 'saving' ? (
        <Button onClick={refreshSnapshot} size="sm" variant="ghost">
          <RefreshCw className="size-3.5" />
          {snapshot?.status === 'failed' ? '重试' : savedAt ? '更新快照' : '保存快照'}
        </Button>
      ) : null}
    </div>
  ) : null;
}

/**
 * 项目工作区中的水源来源视图：主题引用卡 + 快照状态 + 楼层正文（读本地快照或保存中的草稿，
 * 都还没有时为引用行摘要）。正文从摘要首次变为可读时自动重读；之后本地有更新只给出
 * 「刷新正文」，不在阅读中替换正文。
 */
export function ShuiyuanSourceDoc({ sourceId, content, navigate, onReload }: SourceDocumentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const topicId = topicIdOf(sourceId);
  const text = content.text ?? '';
  const query = useSourceRef(topicId);
  const ref = query.data ?? null;
  const openInShuiyuan = (targetTopicId: number, postNumber?: number) =>
    navigate({ page: 'shuiyuan', topicId: targetTopicId, postNumber });

  const meta = [
    ref?.author ? `作者 ${ref.author}` : null,
    ref?.postsCount !== null && ref?.postsCount !== undefined ? `${ref.postsCount} 楼` : null,
  ].filter(Boolean);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 max-md:p-3">
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <section
          aria-label="水源来源"
          className="flex flex-wrap items-start gap-3 rounded-card border border-line bg-surface p-4"
        >
          <ShuiyuanIcon className="size-10 shrink-0 rounded-card" />
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="flex items-center gap-1.5 text-xs text-ink-3">
              <span className="font-medium">水源社区</span>
              {ref?.categoryName ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{ref.categoryName}</span>
                </>
              ) : null}
            </p>
            <p className="line-clamp-2 text-sm font-semibold leading-snug">
              <ShuiyuanTitle text={ref?.title ?? content.title} />
            </p>
            <p className="text-xs text-ink-3">{meta.join(' · ') || '来自水源社区的帖子'}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!window.dela}
              onClick={() => openInShuiyuan(topicId)}
              size="sm"
              variant="outline"
            >
              <MessageSquare className="size-3.5" />
              在水源页打开
            </Button>
            {content.url ? (
              <Button
                onClick={() => void shuiyuanClient.openInBrowser(topicId)}
                size="sm"
                variant="ghost"
              >
                <ExternalLink className="size-3.5" />
                打开原帖
              </Button>
            ) : null}
          </div>
          <SnapshotStatus
            topicId={topicId}
            snapshot={query.isPending ? undefined : (ref?.snapshot ?? null)}
            content={content}
            onReload={onReload}
          />
        </section>
        {content.shuiyuanSnapshot ? (
          <ShuiyuanSnapshotBody
            key={`${topicId}:${content.updatedAt}`}
            topicId={topicId}
            postCount={content.shuiyuanSnapshot.postCount}
            pageSize={content.shuiyuanSnapshot.pageSize}
            scrollRef={scrollRef}
            onOpenTopic={openInShuiyuan}
          />
        ) : content.format === 'html' ? (
          <ShuiyuanHtmlBody html={text} onOpenTopic={openInShuiyuan} title="帖子内容" />
        ) : (
          <pre className="whitespace-pre-wrap break-words rounded-control border border-line bg-inset p-4 text-sm leading-relaxed">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
