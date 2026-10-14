import type { CalendarEventColor } from '../../../shared/api';
import { cn } from '../../lib/utils';
import { eventPalette } from './timetable-format';

/** 事件颜色选择行：日历新建事件与待办表单共用同一套候选色圆点。 */
export function EventColorRow({
  className,
  onColorChange,
  value,
}: {
  className?: string;
  onColorChange: (value: CalendarEventColor) => void;
  value: CalendarEventColor;
}) {
  return (
    <div className={cn('flex h-11 items-center gap-2 px-3', className)}>
      <span className="w-8 shrink-0 text-xs text-ink-3">颜色</span>
      <div className="flex flex-1 items-center gap-1.5">
        {eventPalette.map(({ key, label }) => (
          <button
            aria-label={label}
            aria-pressed={value === key}
            className={cn(
              'size-5 rounded-full outline-offset-2 transition-transform hover:scale-110',
              value === key && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
            )}
            key={key}
            onClick={() => onColorChange(key)}
            style={{ backgroundColor: `var(--cal-${key}-bg)` }}
            title={label}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}
