import { memo, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '../../../ui/button';
import { SHUIYUAN_SNAPSHOT_PAGE_SIZE } from '../contract';
import { ShuiyuanHtmlBody } from './ShuiyuanHtmlBody';
import { shuiyuanClient } from './use-shuiyuan';

function SnapshotPage({
  topicId,
  page,
  estimatedHeight,
  onOpenTopic,
}: {
  topicId: number;
  page: number;
  estimatedHeight: number;
  onOpenTopic: (topicId: number, postNumber?: number) => void;
}) {
  const query = useQuery({
    queryKey: ['shuiyuan', 'snapshotPage', topicId, page],
    queryFn: () => shuiyuanClient.snapshotPage({ topicId, page }),
  });
  const html = query.data;
  if (query.isError)
    return (
      <Button variant="ghost" onClick={() => void query.refetch()}>
        加载失败，重试
      </Button>
    );
  return html === undefined ? (
    <p style={{ height: estimatedHeight }} className="p-4 text-sm text-ink-3">
      正在加载楼层…
    </p>
  ) : (
    <ShuiyuanHtmlBody
      html={html}
      initialHeight={estimatedHeight}
      onOpenTopic={onOpenTopic}
      title={`帖子内容 · 第 ${page + 1} 段`}
    />
  );
}

export const ShuiyuanSnapshotBody = memo(function ShuiyuanSnapshotBody({
  topicId,
  savedAt,
  scrollRef,
  onOpenTopic,
}: {
  topicId: number;
  savedAt: string | null | undefined;
  scrollRef: RefObject<HTMLDivElement | null>;
  onOpenTopic: (topicId: number, postNumber?: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (root.current && scrollRef.current)
        setMargin(
          root.current.getBoundingClientRect().top -
            scrollRef.current.getBoundingClientRect().top +
            scrollRef.current.scrollTop,
        );
    };
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    if (root.current?.parentElement) observer.observe(root.current.parentElement);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scrollRef]);
  const postCount = useQuery({
    queryKey: ['shuiyuan', 'snapshotPostCount', topicId, savedAt],
    queryFn: () => shuiyuanClient.snapshotPostCount(topicId),
  }).data;
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: Math.ceil((postCount ?? 0) / SHUIYUAN_SNAPSHOT_PAGE_SIZE),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SHUIYUAN_SNAPSHOT_PAGE_SIZE * 240,
    overscan: 1,
    scrollMargin: margin,
    useAnimationFrameWithResizeObserver: true,
  });
  return (
    <div ref={root} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${row.start - margin}px)` }}
        >
          <SnapshotPage
            topicId={topicId}
            page={row.index}
            estimatedHeight={row.size}
            onOpenTopic={onOpenTopic}
          />
        </div>
      ))}
    </div>
  );
});
