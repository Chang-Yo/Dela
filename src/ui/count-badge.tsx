import { cn } from './cn';

// 反色数量气泡，超过 99 显示 99+；叠在按钮角上时由调用方给定位。
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
