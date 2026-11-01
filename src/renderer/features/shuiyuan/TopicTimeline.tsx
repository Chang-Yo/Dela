import { useState } from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { cn } from '../../lib/utils';

type TopicTimelineProps = {
  current: number;
  highest: number;
  onJump: (postNumber: number) => Promise<void>;
};

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
 * 楼层进度：宽版是正文列右侧的竖向时间轴（拖动或点轨道跳楼），
 * 窄版收成右下角的读数胶囊。宽窄按阅读区容器宽度切换，不看窗口宽度。
 */
export function TopicTimeline({ current, highest, onJump }: TopicTimelineProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? current;
  const fraction = highest > 1 ? (value - 1) / (highest - 1) : 0;
  const jump = (postNumber: number) => void onJump(postNumber).finally(() => setDragging(null));

  return (
    <>
      {/* 正文列宽 42rem 居中，时间轴贴在列右侧 2rem 处。
          左侧 1rem 是轴线栏，两端图标、轴线与把手同一中线；楼号与端点文字共用 1.5rem 处的左边线。 */}
      <nav
        aria-label="楼层进度"
        className="absolute top-6 bottom-6 left-[calc(50%+23rem)] hidden flex-col items-start @min-[62rem]:flex"
      >
        <button className={cn(edgeButton, wideEdge)} onClick={() => jump(1)} type="button">
          <span className="grid w-4 place-items-center">
            <ArrowUpToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
          </span>
          首楼
        </button>
        {/* 轨道随阅读区高度伸缩（回复框展开时跟着收短），上限 32rem。 */}
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
      <nav
        aria-label="楼层进度"
        className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-control bg-surface/95 p-0.5 shadow-card backdrop-blur @min-[62rem]:hidden"
      >
        <button
          aria-label="跳到首楼"
          className={cn(edgeButton, 'w-7 justify-center')}
          onClick={() => jump(1)}
          type="button"
        >
          <ArrowUpToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
        </button>
        <FloorField highest={highest} onJump={jump} value={value} />
        <button
          aria-label="跳到最新楼层"
          className={cn(edgeButton, 'w-7 justify-center')}
          onClick={() => jump(highest)}
          type="button"
        >
          <ArrowDownToLine aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
        </button>
      </nav>
    </>
  );
}
