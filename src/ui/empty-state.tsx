import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from './lib/cn';

/** 加载中、出错不用它，分别用状态文字与 Callout。 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-center justify-center gap-2 p-6 text-center',
        className,
      )}
      data-slot="empty-state"
    >
      {Icon && <Icon aria-hidden="true" className="size-8 text-ink-3" strokeWidth={1.5} />}
      <p className="text-sm text-ink-2">{title}</p>
      {description && <p className="text-xs leading-relaxed text-ink-3">{description}</p>}
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
