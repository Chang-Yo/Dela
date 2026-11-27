import { cn } from '../../../ui/lib/cn';
import {
  calendarColorLabels,
  calendarColors,
  type CalendarColor,
} from '../../../ui/lib/calendar-colors';

export function EventColorRow({
  className,
  onColorChange,
  value,
}: {
  className?: string;
  onColorChange: (value: CalendarColor) => void;
  value: CalendarColor;
}) {
  return (
    <div className={cn('flex h-11 items-center gap-2 px-3', className)}>
      <span className="w-8 shrink-0 text-xs text-ink-3">颜色</span>
      <div className="flex flex-1 items-center gap-1.5">
        {calendarColors.map((key) => (
          <button
            aria-label={calendarColorLabels[key]}
            aria-pressed={value === key}
            className={cn(
              'size-5 rounded-full outline-offset-2 transition-transform hover:scale-110',
              value === key && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
            )}
            key={key}
            onClick={() => onColorChange(key)}
            style={{ backgroundColor: `var(--cal-${key}-bg)` }}
            title={calendarColorLabels[key]}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}
