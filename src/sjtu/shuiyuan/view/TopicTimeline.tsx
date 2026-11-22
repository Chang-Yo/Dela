import { useState } from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { ArrowDownToLine, ArrowUpToLine, Lock, Reply } from 'lucide-react';
import { Button } from '../../../ui/button';

type TopicTimelineProps = {
  current: number;
  highest: number;
  onJump: (postNumber: number) => Promise<void>;
  /** 主题级回复入口；回复卡片已展开时为 null，onClick 为 null 表示帖子已关闭。 */
  reply: { label: string; onClick: (() => void) | null } | null;
};

function ReplyButton({
  reply,
  className,
}: {
  reply: NonNullable<TopicTimelineProps['reply']>;
  className?: string;
}) {
  return (
    <Button
      className={className}
      disabled={!reply.onClick}
      onClick={reply.onClick ?? undefined}
      size="sm"
      title={reply.onClick ? undefined : '帖子已关闭，无法回复'}
    >
      {reply.onClick ? <Reply aria-hidden="true" /> : <Lock aria-hidden="true" />}
      {reply.label}
    </Button>
  );
}

const wideEdge = '-ml-1.5 gap-2 pr-2 pl-1.5 text-ink-3';

function FloorField({
  value,
  highest,
  onJump,
}: {
  value: number;
  highest: number;
  onJump: (postNumber: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        aria-label="跳到楼层"
        autoFocus
        className="h-7 w-16 rounded-control bg-surface px-1.5 text-xs tabular-nums text-ink shadow-focus outline-none"
        defaultValue={value}
        inputMode="numeric"
        onBlur={() => setEditing(false)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
          if (event.key !== 'Enter') return;
          const target = Number.parseInt(event.currentTarget.value, 10);
          setEditing(false);
          if (Number.isFinite(target)) onJump(Math.min(highest, Math.max(1, target)));
        }}
      />
    );
  }
  return (
    <Button
      className="gap-1 px-1.5 font-normal tabular-nums"
      onClick={() => setEditing(true)}
      size="sm"
      title="跳到楼层"
      variant="ghost"
    >
      <span className="font-medium text-ink">{value}</span>
      <span className="text-ink-3">/ {highest}</span>
    </Button>
  );
}

/** 宽版楼层进度：挂在整个阅读页而非滚动区，回复卡片升起时轴长不变（卡片只占正文列）。 */
export function TopicTimeline({ current, highest, onJump, reply }: TopicTimelineProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? current;
  const fraction = highest > 1 ? (value - 1) / (highest - 1) : 0;
  const jump = (postNumber: number) => void onJump(postNumber).finally(() => setDragging(null));

  return (
    <>
      {highest > 1 ? (
        <nav
          aria-label="楼层进度"
          className="absolute top-6 bottom-[4.25rem] left-[calc(50%+23rem)] hidden flex-col items-start justify-end @min-[62rem]:flex"
        >
          <Button className={wideEdge} onClick={() => jump(1)} size="sm" variant="ghost">
            <span className="grid w-4 place-items-center">
              <ArrowUpToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            </span>
            首楼
          </Button>
          <div className="relative my-2 max-h-128 min-h-24 w-full flex-1">
            <SliderPrimitive.Root
              aria-label="楼层"
              className="relative flex h-full w-4 cursor-pointer touch-none select-none flex-col items-center"
              inverted
              max={highest}
              min={1}
              onValueChange={(values) => setDragging(values[0] ?? 1)}
              onValueCommit={(values) => jump(values[0] ?? 1)}
              orientation="vertical"
              step={1}
              value={[value]}
            >
              <SliderPrimitive.Track className="relative w-px grow bg-line-strong">
                <SliderPrimitive.Range className="absolute w-full bg-ink-3" />
              </SliderPrimitive.Track>
              <SliderPrimitive.Thumb className="block h-8 w-1 rounded-full bg-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface" />
            </SliderPrimitive.Root>
            <div
              className="absolute left-[1.125rem] -translate-y-1/2"
              style={{ top: `calc(${fraction} * (100% - 2rem) + 1rem)` }}
            >
              <FloorField highest={highest} onJump={jump} value={value} />
            </div>
          </div>
          <Button className={wideEdge} onClick={() => jump(highest)} size="sm" variant="ghost">
            <span className="grid w-4 place-items-center">
              <ArrowDownToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            </span>
            最新
          </Button>
        </nav>
      ) : null}
      {reply ? (
        <ReplyButton
          className="absolute bottom-6 left-[calc(50%+23rem)] -ml-2 hidden @min-[62rem]:inline-flex"
          reply={reply}
        />
      ) : null}
    </>
  );
}

export function FloorCapsule({ current, highest, onJump, reply }: TopicTimelineProps) {
  const progress = highest > 1;
  if (!progress && !reply) return null;
  const jump = (postNumber: number) => void onJump(postNumber);

  return (
    // 与滚动区里的正文列同宽同内边距；right-2.5 让出滚动区恒留的 10px 滚动条槽，两者才同一中线。
    <div className="pointer-events-none absolute bottom-3 left-0 right-2.5 @min-[62rem]:hidden">
      <div className="mx-auto flex max-w-2xl justify-end px-5 max-md:px-4">
        <nav
          aria-label="楼层进度"
          className="pointer-events-auto flex items-center gap-0.5 rounded-control bg-surface/95 p-0.5 shadow-card backdrop-blur"
        >
          {progress ? (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="跳到首楼" onClick={() => jump(1)}>
                <ArrowUpToLine aria-hidden="true" strokeWidth={1.8} />
              </Button>
              <FloorField highest={highest} onJump={jump} value={current} />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="跳到最新楼层"
                onClick={() => jump(highest)}
              >
                <ArrowDownToLine aria-hidden="true" strokeWidth={1.8} />
              </Button>
            </>
          ) : null}
          {progress && reply ? (
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line" />
          ) : null}
          {reply ? <ReplyButton reply={reply} /> : null}
        </nav>
      </div>
    </div>
  );
}
