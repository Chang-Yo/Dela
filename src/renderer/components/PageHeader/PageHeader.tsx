import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-5',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] leading-4 text-muted-foreground">{eyebrow}</p>}
        <h1 className="truncate text-[15px] font-semibold leading-5 tracking-tight">{title}</h1>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
