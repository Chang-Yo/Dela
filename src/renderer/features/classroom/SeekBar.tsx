// 播放进度条：缓冲层 + 已播层 + 拖拽预览与悬停时间气泡。
// 拖拽期间只更新预览，松手才提交 seek，避免 timeupdate 与拖拽互相拉扯。
import { useCallback, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { formatTime } from './player-format';

interface SeekBarProps {
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  onSeek: (time: number) => void;
  onScrub?: (time: number | null) => void;
  className?: string;
}

export function SeekBar({
  currentTime,
  duration,
  bufferedEnd,
  onSeek,
  onScrub,
  className,
}: SeekBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const display = dragTime ?? currentTime;
  const ratio = duration > 0 ? Math.min(1, Math.max(0, display / duration)) : 0;
  const bufferedRatio = duration > 0 ? Math.min(1, bufferedEnd / duration) : 0;
  const bubble = dragTime ?? hoverTime;

  const timeAt = useCallback(
    (clientX: number): number => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || duration <= 0) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
    },
    [duration],
  );

  const endDrag = useCallback(() => {
    setDragTime(null);
    onScrub?.(null);
  }, [onScrub]);

  return (
    <div
      aria-label="播放进度"
      aria-valuemax={Math.round(duration)}
      aria-valuemin={0}
      aria-valuenow={Math.round(display)}
      className={cn(
        'group/seek relative flex h-4 cursor-pointer touch-none select-none items-center',
        duration > 0 ? '' : 'pointer-events-none opacity-60',
        className,
      )}
      onPointerCancel={endDrag}
      onPointerDown={(event) => {
        if (duration <= 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const time = timeAt(event.clientX);
        setDragTime(time);
        onScrub?.(time);
      }}
      onPointerLeave={() => setHoverTime(null)}
      onPointerMove={(event) => {
        const time = timeAt(event.clientX);
        setHoverTime(time);
        if (dragTime !== null) {
          setDragTime(time);
          onScrub?.(time);
        }
      }}
      onPointerUp={(event) => {
        if (dragTime === null) return;
        const time = timeAt(event.clientX);
        endDrag();
        onSeek(time);
      }}
      onKeyDown={(event) => {
        if (duration <= 0) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onSeek(Math.max(0, currentTime - 5));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onSeek(Math.min(duration, currentTime + 5));
        }
      }}
      ref={containerRef}
      role="slider"
      tabIndex={0}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-line-strong">
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full bg-ink/20"
          style={{ width: `${bufferedRatio * 100}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full bg-ink"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-150',
          dragTime !== null || hoverTime !== null ? 'scale-110' : 'scale-100',
        )}
        style={{ left: `${ratio * 100}%` }}
      />
      {bubble !== null && (
        <div
          className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded-chip bg-(--tooltip-bg) px-1.5 py-0.5 text-2xs tabular-nums text-(--tooltip-fg) shadow-overlay"
          style={{
            left: `${duration > 0 ? Math.min(1, Math.max(0, bubble / duration)) * 100 : 0}%`,
          }}
        >
          {formatTime(bubble)}
        </div>
      )}
    </div>
  );
}
