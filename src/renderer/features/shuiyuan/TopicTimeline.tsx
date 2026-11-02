import { useState } from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { ArrowDownToLine, ArrowUpToLine, Lock, Reply } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';

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

const edgeButton =
  'flex h-7 items-center gap-2 rounded-control text-xs text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink';
/** 负边距让悬停底色外扩，而图标仍落在轴线栏中线上。 */
const wideEdge = '-ml-1.5 pr-2 pl-1.5';

/** 楼号读数，点击换成输入框直接跳楼；回车跳转，Esc 或失焦放弃。 */
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
        className="h-7 w-16 rounded-control bg-surface px-1.5 text-xs tabular-nums text-ink shadow-[0_0_0_1px_var(--bui-accent),0_0_0_3px_var(--bui-accent-tint)] outline-none"
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
    <button
      className="flex h-7 items-center gap-1 whitespace-nowrap rounded-control px-1.5 text-xs tabular-nums transition-colors duration-150 hover:bg-hover"
      onClick={() => setEditing(true)}
      title="跳到楼层"
      type="button"
    >
      <span className="font-medium text-ink">{value}</span>
      <span className="text-ink-3">/ {highest}</span>
    </button>
  );
}

/**
 * 宽版楼层进度：正文列右侧的竖向时间轴（拖动或点轨道跳楼），回复钮单独钉在轴下方。
 * 挂在整个阅读页上而非滚动区：回复卡片升起时轴长不变（卡片只占正文列）。
 */
export function TopicTimeline({ current, highest, onJump, reply }: TopicTimelineProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? current;
  const fraction = highest > 1 ? (value - 1) / (highest - 1) : 0;
  const jump = (postNumber: number) => void onJump(postNumber).finally(() => setDragging(null));

  return (
    <>
      {/* 正文列宽 42rem 居中，时间轴贴在列右侧 2rem 处。
          左侧 1rem 是轴线栏，两端图标、轴线与把手同一中线；楼号与端点文字共用 1.5rem 处的左边线。
          底部恒留回复钮的位置（1.5rem 底距 + 1.75rem 钮高 + 1rem 间距），轴长不随回复钮隐现变化。 */}
      {highest > 1 ? (
        <nav
          aria-label="楼层进度"
          className="absolute top-6 bottom-[4.25rem] left-[calc(50%+23rem)] hidden flex-col items-start justify-end @min-[62rem]:flex"
        >
          <button className={cn(edgeButton, wideEdge)} onClick={() => jump(1)} type="button">
            <span className="grid w-4 place-items-center">
              <ArrowUpToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            </span>
            首楼
          </button>
          {/* 轨道随阅读页高度伸缩，上限 32rem。 */}
          <div className="relative my-2 max-h-[32rem] min-h-24 w-full flex-1">
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
              <SliderPrimitive.Thumb className="block h-8 w-1 rounded-full bg-ink outline-none focus-visible:ring-2 focus-visible:ring-bui-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface" />
            </SliderPrimitive.Root>
            {/* Radix 把把手约束在轨道内：中心 = 比例 × (轨长 − 把手长) + 半个把手长（把手长 2rem）。 */}
            <div
              className="absolute left-[1.125rem] -translate-y-1/2"
              style={{ top: `calc(${fraction} * (100% - 2rem) + 1rem)` }}
            >
              <FloorField highest={highest} onJump={jump} value={value} />
            </div>
          </div>
          <button className={cn(edgeButton, wideEdge)} onClick={() => jump(highest)} type="button">
            <span className="grid w-4 place-items-center">
              <ArrowDownToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            </span>
            最新
          </button>
        </nav>
      ) : null}
      {/* -ml-2 让按钮图标与轴线栏同一中线。 */}
      {reply ? (
        <ReplyButton
          className="absolute bottom-6 left-[calc(50%+23rem)] -ml-2 hidden @min-[62rem]:inline-flex"
          reply={reply}
        />
      ) : null}
    </>
  );
}

/**
 * 窄版楼层进度：胶囊钉在正文列右下角（与楼层右沿对齐），挂在滚动区上，
 * 回复卡片升起时随滚动区一起上移，不被卡片压住。
 */
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
              <button
                aria-label="跳到首楼"
                className={cn(edgeButton, 'w-7 justify-center')}
                onClick={() => jump(1)}
                type="button"
              >
                <ArrowUpToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
              </button>
              <FloorField highest={highest} onJump={jump} value={current} />
              <button
                aria-label="跳到最新楼层"
                className={cn(edgeButton, 'w-7 justify-center')}
                onClick={() => jump(highest)}
                type="button"
              >
                <ArrowDownToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
              </button>
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
