import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { cn } from './lib/cn';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// 固定六行：翻月时高度不跳。
function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from(
    { length: 42 },
    (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + index),
  );
}

/** 月历网格，打开时停在 value 所在的月份。 */
function Calendar({
  value,
  onValueChange,
  className,
}: {
  value: Date | null;
  onValueChange: (date: Date) => void;
  className?: string;
}) {
  const [month, setMonth] = useState(() => value ?? new Date());
  const today = new Date();
  return (
    <div className={cn('w-56', className)} data-slot="calendar">
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
              onClick={() => {
                setMonth(date);
                onValueChange(date);
              }}
              type="button"
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { Calendar };
