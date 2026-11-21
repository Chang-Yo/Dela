import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import type * as React from 'react';
import { Button } from './button';
import { Calendar } from './calendar';
import { cn } from './lib/cn';
import { fieldTrigger } from './lib/menu-styles';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

function dateLabel(date: Date): string {
  const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 周${weekdays[date.getDay()]}`;
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
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className={cn(fieldTrigger, 'tabular-nums', !value && 'text-ink-3', className)}
        data-slot="date-picker"
        {...props}
      >
        {value ? dateLabel(value) : placeholder}
        <CalendarDays className="text-ink-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar onValueChange={pick} value={value} />
        <div className="flex justify-end pt-1">
          <Button onClick={() => pick(new Date())} size="sm" variant="ghost">
            今天
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
