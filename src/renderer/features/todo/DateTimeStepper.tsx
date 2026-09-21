import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

type StepperField = 'year' | 'month' | 'day' | 'hour' | 'minute';

const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// 各字段步进后超出范围时靠 Date 进位（59 分 +1 → 下一小时）；月/年切换时把日收敛到
// 目标月份的真实天数（1月31日 +1 月得 2月28/29日），避免 JS 日期溢出到三月。
function step(date: Date, field: StepperField, delta: 1 | -1): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  if (field === 'minute') return new Date(year, month, day, hour, minute + delta);
  if (field === 'hour') return new Date(year, month, day, hour + delta, minute);
  if (field === 'day') return new Date(year, month, day + delta, hour, minute);
  if (field === 'month') {
    const next = new Date(year, month + delta, 1);
    return new Date(
      next.getFullYear(),
      next.getMonth(),
      Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())),
      hour,
      minute,
    );
  }
  if (year + delta < MIN_YEAR || year + delta > MAX_YEAR) return date;
  return new Date(
    year + delta,
    month,
    Math.min(day, daysInMonth(year + delta, month)),
    hour,
    minute,
  );
}

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

function StepperColumn({
  display,
  label,
  onStep,
}: {
  display: string;
  label: string;
  onStep: (delta: 1 | -1) => void;
}) {
  const increase = useHoldRepeat(() => onStep(1));
  const decrease = useHoldRepeat(() => onStep(-1));
  const buttonClass =
    'grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 select-none';
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button aria-label={`增加${label}`} className={buttonClass} type="button" {...increase}>
        <ChevronUp className="size-4" strokeWidth={1.8} />
      </button>
      <span
        aria-label={label}
        className="grid h-8 min-w-10 place-items-center rounded-md bg-muted/60 px-1 text-sm font-medium tabular-nums"
      >
        {display}
      </span>
      <button aria-label={`减少${label}`} className={buttonClass} type="button" {...decrease}>
        <ChevronDown className="size-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}

/** 年/月/日/时/分 五列步进选择器：每列上方 ^ 增、下方 v 减，按住可连发。 */
export function DateTimeStepper({
  label = '截止时间',
  value,
  onChange,
}: {
  label?: string;
  value: Date;
  onChange: (date: Date) => void;
}) {
  const pad = (input: number) => `${input}`.padStart(2, '0');
  const columns: { display: string; field: StepperField; label: string }[] = [
    { display: `${value.getFullYear()}年`, field: 'year', label: '年份' },
    { display: `${value.getMonth() + 1}月`, field: 'month', label: '月份' },
    { display: `${value.getDate()}日`, field: 'day', label: '日期' },
    { display: `${pad(value.getHours())}时`, field: 'hour', label: '小时' },
    { display: `${pad(value.getMinutes())}分`, field: 'minute', label: '分钟' },
  ];
  return (
    <div aria-label={label} className="flex items-start justify-center gap-1" role="group">
      {columns.map((column) => (
        <StepperColumn
          display={column.display}
          key={column.field}
          label={column.label}
          onStep={(delta) => onChange(step(value, column.field, delta))}
        />
      ))}
    </div>
  );
}
