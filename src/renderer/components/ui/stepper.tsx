import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// 按住连发：立刻执行一次，短暂延迟后以固定间隔重复，松开或移出按钮即停止。
// 经 ref 转发最新回调，否则 interval 持有按下时的旧闭包，连发只会基于旧值原地重复。
function useHoldRepeat(action: () => void) {
  const actionRef = useRef(action);
  actionRef.current = action;
  const timeout = useRef<number | undefined>(undefined);
  const interval = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timeout.current);
      window.clearInterval(interval.current);
    },
    [],
  );
  const stop = () => {
    window.clearTimeout(timeout.current);
    window.clearInterval(interval.current);
  };
  const start = () => {
    stop();
    actionRef.current();
    timeout.current = window.setTimeout(() => {
      interval.current = window.setInterval(() => actionRef.current(), 64);
    }, 400);
  };
  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop } as const;
}

/** 单字段步进值：左箭头减、右箭头增，按住可连发；到达边界时禁用对应箭头。 */
export function StepperControl({
  canDecrease = true,
  canIncrease = true,
  display,
  label,
  onStep,
}: {
  canDecrease?: boolean;
  canIncrease?: boolean;
  display: string;
  label: string;
  onStep: (delta: 1 | -1) => void;
}) {
  const increase = useHoldRepeat(() => onStep(1));
  const decrease = useHoldRepeat(() => onStep(-1));
  const buttonClass =
    'grid size-7 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bui-accent select-none disabled:pointer-events-none disabled:opacity-40';
  return (
    <div aria-label={label} className="flex items-center gap-0.5" role="group">
      <button
        aria-label={`减少${label}`}
        className={buttonClass}
        disabled={!canDecrease}
        type="button"
        {...decrease}
      >
        <ChevronLeft className="size-3.5" strokeWidth={1.8} />
      </button>
      <span className="grid h-8 min-w-16 place-items-center rounded-control bg-field px-2 text-[13px] font-medium tabular-nums text-ink shadow-hairline">
        {display}
      </span>
      <button
        aria-label={`增加${label}`}
        className={buttonClass}
        disabled={!canIncrease}
        type="button"
        {...increase}
      >
        <ChevronRight className="size-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}
