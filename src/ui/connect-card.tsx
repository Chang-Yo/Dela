import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from './lib/cn';

function ConnectCard({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'grid w-full max-w-120 justify-items-start gap-3 rounded-card border border-line bg-surface p-6',
        className,
      )}
      data-slot="connect-card"
    >
      {Icon && (
        <div className="grid size-10 place-items-center rounded-card bg-fill">
          <Icon aria-hidden="true" className="size-5" />
        </div>
      )}
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm leading-relaxed text-ink-3">{description}</p>
      </div>
      {children}
    </section>
  );
}

export { ConnectCard };
