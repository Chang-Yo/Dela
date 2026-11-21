import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type * as React from 'react';
import { Button } from './button';
import { cn } from './lib/cn';
import { fieldTrigger } from './lib/menu-styles';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// 固定六行：翻月时浮层高度不跳。
function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from(
    { length: 42 },
    (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + index),
  );
}

function dateLabel(date: Date): string {
  const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 周${weekdays[(date.getDay() + 6) % 7]}`;
}

/** 选日期时保留原值的时分，同一个 Date 可以交给时间选择器继续改。 */
function DatePicker({
  value,
  onValueChange,
  placeholder = '选择日期',
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value' | 'defaultValue' | 'onChange'> & {
  value: Date | null;
  onValueChange: (date: Date) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => value ?? new Date());
  const today = new Date();
  const pick = (date: Date) => {
    setOpen(false);
    onValueChange(
      new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        value?.getHours() ?? 0,
        value?.getMinutes() ?? 0,
      ),
    );
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(value ?? today);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        className={cn(fieldTrigger, 'tabular-nums', !value && 'text-ink-3', className)}
        data-slot="date-picker"
        {...props}
      >
        {value ? dateLabel(value) : placeholder}
        <CalendarDays className="text-ink-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="flex items-center justify-between pb-1">
          <Button
            aria-label="上个月"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium tabular-nums">
            {month.getFullYear()}年{month.getMonth() + 1}月
          </span>
          <Button
            aria-label="下个月"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-7 justify-items-center gap-y-0.5">
          {weekdays.map((day) => (
            <span className="grid size-8 place-items-center text-xs text-ink-3" key={day}>
              {day}
            </span>
          ))}
          {monthDays(month).map((date) => {
            const selected = !!value && sameDay(date, value);
            return (
              <button
                aria-current={sameDay(date, today) ? 'date' : undefined}
                aria-label={`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`}
                aria-pressed={selected}
                className={cn(
                  'grid size-8 place-items-center rounded-control text-sm tabular-nums outline-none transition-colors duration-fast hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent',
                  date.getMonth() !== month.getMonth() && 'text-ink-3',
                  sameDay(date, today) && 'font-semibold text-accent-ink',
                  selected && 'bg-ink text-surface hover:bg-ink',
                )}
                key={date.getTime()}
                onClick={() => pick(date)}
                type="button"
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end pt-1">
          <Button onClick={() => pick(today)} size="sm" variant="ghost">
            今天
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
