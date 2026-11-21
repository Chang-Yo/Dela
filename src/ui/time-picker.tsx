import { useState } from 'react';
import { Clock } from 'lucide-react';
import type * as React from 'react';
import { cn } from './lib/cn';
import { fieldTrigger } from './lib/menu-styles';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const pad = (value: number) => `${value}`.padStart(2, '0');
const hours = Array.from({ length: 24 }, (_, index) => index);

function TimeColumn({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly number[];
  value: number;
  onPick: (value: number) => void;
}) {
  return (
    <div
      aria-label={label}
      className="relative grid h-48 content-start gap-0.5 overflow-y-auto [scrollbar-width:none]"
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={option === value}
          className={cn(
            'h-7 w-12 shrink-0 rounded-chip text-sm tabular-nums outline-none transition-colors duration-fast hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent',
            option === value && 'bg-ink text-surface hover:bg-ink',
          )}
          key={option}
          onClick={() => onPick(option)}
          // 选中项滚到列的正中，打开浮层和每次点选后都能看到当前值。
          ref={
            option === value
              ? (node) => {
                  if (node)
                    node.parentElement!.scrollTop =
                      node.offsetTop - (node.parentElement!.clientHeight - node.offsetHeight) / 2;
                }
              : undefined
          }
          type="button"
        >
          {pad(option)}
        </button>
      ))}
    </div>
  );
}

/** 只改时分，日期沿用 value。分钟列五分钟一格，其他分钟可以直接输入。 */
function TimePicker({
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.ComponentProps<'button'>, 'value' | 'defaultValue' | 'onChange'> & {
  value: Date;
  onValueChange: (date: Date) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const label = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  const set = (hour: number, minute: number) =>
    onValueChange(new Date(value.getFullYear(), value.getMonth(), value.getDate(), hour, minute));
  const minutes = [
    ...new Set([...Array.from({ length: 12 }, (_, index) => index * 5), value.getMinutes()]),
  ].sort((a, b) => a - b);
  const commit = () => {
    const match = /^(\d{1,2}):?(\d{2})$/.exec(draft?.trim() ?? '');
    if (match && Number(match[1]) < 24 && Number(match[2]) < 60)
      set(Number(match[1]), Number(match[2]));
    setDraft(null);
  };
  return (
    <Popover onOpenChange={(open) => !open && commit()}>
      <PopoverTrigger
        className={cn(fieldTrigger, 'tabular-nums', className)}
        data-slot="time-picker"
        {...props}
      >
        {label}
        <Clock className="text-ink-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto min-w-0 p-1">
        <input
          aria-label="输入时间"
          className="mb-1 h-7 w-full rounded-chip bg-field px-2 text-center text-sm tabular-nums text-ink shadow-hairline outline-none focus-visible:bg-surface focus-visible:shadow-focus"
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit();
          }}
          placeholder="HH:MM"
          value={draft ?? label}
        />
        <div className="flex gap-1">
          <TimeColumn
            label="小时"
            onPick={(hour) => set(hour, value.getMinutes())}
            options={hours}
            value={value.getHours()}
          />
          <TimeColumn
            label="分钟"
            onPick={(minute) => set(value.getHours(), minute)}
            options={minutes}
            value={value.getMinutes()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { TimePicker };
