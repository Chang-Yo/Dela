import { cn } from './lib/cn';

function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'min-w-4 rounded-full bg-ink px-1 text-center text-xs font-medium leading-4 tabular-nums text-surface',
        className,
      )}
      data-slot="count-badge"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export { CountBadge };
