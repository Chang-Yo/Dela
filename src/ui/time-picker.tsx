import { useState } from 'react';
import { Clock } from 'lucide-react';
import type * as React from 'react';
import { cn } from './lib/cn';
import { fieldTrigger } from './lib/menu-styles';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const pad = (value: number) => `${value}`.padStart(2, '0');
const offsets = [-3, -2, -1, 0, 1, 2, 3];
// 一格滚轮（Chromium 约 100px）走一格；触控板的小增量累积到一格再走。
const wheelStep = 100;

/** 首尾相接的滚轮列：选中值固定在正中，滚轮、方向键和点击都只是改值。 */
function TimeColumn({
  label,
  count,
  value,
  onPick,
}: {
  label: string;
  count: number;
  value: number;
  onPick: (value: number) => void;
}) {
  const [wheel, setWheel] = useState(0);
  const shift = (delta: number) => onPick((((value + delta) % count) + count) % count);
  return (
    <div
      aria-label={label}
      aria-valuemax={count - 1}
      aria-valuemin={0}
      aria-valuenow={value}
      aria-valuetext={pad(value)}
      className="flex flex-col gap-0.5 rounded-control outline-none focus-visible:outline-2 focus-visible:outline-accent"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        shift(event.key === 'ArrowUp' ? -1 : 1);
      }}
      onWheel={(event) => {
        const total = wheel + event.deltaY;
        const steps = Math.trunc(total / wheelStep);
        setWheel(total - steps * wheelStep);
        if (steps) shift(steps);
      }}
      role="spinbutton"
      tabIndex={0}
    >
      {offsets.map((offset) => (
        <button
          className={cn(
            'h-7 w-12 rounded-chip text-sm tabular-nums transition-colors duration-fast hover:bg-hover',
            offset === 0 ? 'bg-ink text-surface hover:bg-ink' : 'text-ink-3',
            Math.abs(offset) === 3 && 'opacity-50',
          )}
          key={offset}
          onClick={() => shift(offset)}
          tabIndex={-1}
          type="button"
        >
          {pad((((value + offset) % count) + count) % count)}
        </button>
      ))}
    </div>
  );
}

/** 只改时分，日期沿用 value。 */
function TimePicker({
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value' | 'defaultValue' | 'onChange'> & {
  value: Date;
  onValueChange: (date: Date) => void;
}) {
  const set = (hour: number, minute: number) =>
    onValueChange(new Date(value.getFullYear(), value.getMonth(), value.getDate(), hour, minute));
  return (
    <Popover>
      <PopoverTrigger
        className={cn(fieldTrigger, 'tabular-nums', className)}
        data-slot="time-picker"
        {...props}
      >
        {pad(value.getHours())}:{pad(value.getMinutes())}
        <Clock className="text-ink-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto min-w-0 gap-1 p-1">
        <TimeColumn
          count={24}
          label="小时"
          onPick={(hour) => set(hour, value.getMinutes())}
          value={value.getHours()}
        />
        <TimeColumn
          count={60}
          label="分钟"
          onPick={(minute) => set(value.getHours(), minute)}
          value={value.getMinutes()}
        />
      </PopoverContent>
    </Popover>
  );
}

export { TimePicker };
