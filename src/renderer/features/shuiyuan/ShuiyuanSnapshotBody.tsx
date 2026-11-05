import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '../../components/ui/button';
import { errorText } from '../../workspace/store';
import { ShuiyuanHtmlBody } from './ShuiyuanHtmlBody';

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
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void window.dela!.shuiyuan.readSnapshotPage(topicId, page).then(
      (value) => {
        if (active) {
          setHtml(value);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (active) setError(errorText(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [topicId, page, attempt]);
  if (error)
    return (
      <Button variant="ghost" onClick={() => setAttempt(attempt + 1)}>
        加载失败，重试
      </Button>
    );
  return html === null ? (
    <p style={{ height: estimatedHeight }} className="p-4 text-13 text-ink-3">
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
  postCount,
  pageSize,
  scrollRef,
  onOpenTopic,
}: {
  topicId: number;
  postCount: number;
  pageSize: number;
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
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: Math.ceil(postCount / pageSize),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => pageSize * 240,
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
