import { useEffect, useState, type ComponentProps } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './lib/cn';

type HoldPhase = 'idle' | 'waiting' | 'repeating';

// 按住连发：interval 随 action 重建，连发总是基于最新值。
function useHoldRepeat(action: () => void, enabled: boolean) {
  const [phase, setPhase] = useState<HoldPhase>('idle');
  if (!enabled && phase !== 'idle') setPhase('idle');
  useEffect(() => {
    if (phase !== 'waiting') return;
    const timeout = window.setTimeout(() => setPhase('repeating'), 400);
    return () => window.clearTimeout(timeout);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'repeating') return;
    const interval = window.setInterval(action, 64);
    return () => window.clearInterval(interval);
  }, [phase, action]);
  const stop = () => setPhase('idle');
  const start = () => {
    action();
    setPhase('waiting');
  };
  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop } as const;
}

/** 编辑期用本地草稿，失焦或回车才收敛：逐键提交会让「1」「12」这类中间态被 clamp 弹回。 */
function StepperInput({
  label,
  max,
  min,
  onValueChange,
  unit,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  unit: string;
  value: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const parsed = Number(draft.trim());
    if (draft.trim() === '' || !Number.isFinite(parsed)) return;
    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    if (next !== value) onValueChange(next);
  };
  return (
    <span className="flex h-8 min-w-16 items-center justify-end gap-0.5 rounded-control bg-field pl-2 pr-1.5 text-sm font-medium tabular-nums text-ink shadow-hairline">
      <input
        aria-label={label}
        className="w-6 bg-transparent text-right outline-none"
        inputMode="numeric"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        value={draft ?? String(value)}
      />
      <span className="text-ink-3">{unit}</span>
    </span>
  );
}

function Stepper({
  canDecrease = true,
  canIncrease = true,
  className,
  display,
  input,
  label,
  onStep,
  ...props
}: ComponentProps<'div'> & {
  canDecrease?: boolean;
  canIncrease?: boolean;
  display: string;
  input?: {
    unit: string;
    value: number;
    min: number;
    max: number;
    onValueChange: (value: number) => void;
  };
  label: string;
  onStep: (delta: 1 | -1) => void;
}) {
  const increase = useHoldRepeat(() => onStep(1), canIncrease);
  const decrease = useHoldRepeat(() => onStep(-1), canDecrease);
  const buttonClass =
    'grid size-7 place-items-center rounded-control text-ink-3 transition-colors duration-base hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent select-none disabled:pointer-events-none disabled:opacity-40';
  return (
    <div
      aria-label={label}
      className={cn('flex items-center gap-0.5', className)}
      data-slot="stepper"
      role="group"
      {...props}
    >
      <button
        aria-label={`减少${label}`}
        className={buttonClass}
        disabled={!canDecrease}
        type="button"
        {...decrease}
      >
        <ChevronLeft className="size-3.5" strokeWidth={1.8} />
      </button>
      {input ? (
        <StepperInput
          label={label}
          max={input.max}
          min={input.min}
          onValueChange={input.onValueChange}
          unit={input.unit}
          value={input.value}
        />
      ) : (
        <span className="grid h-8 min-w-16 place-items-center rounded-control bg-field px-2 text-sm font-medium tabular-nums text-ink shadow-hairline">
          {display}
        </span>
      )}
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

export { Stepper };
