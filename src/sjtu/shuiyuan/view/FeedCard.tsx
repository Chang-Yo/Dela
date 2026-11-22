import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { Card } from '../../../ui/card';
import { cn } from '../../../ui/lib/cn';
import { Skeleton } from '../../../ui/skeleton';

export function FeedColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 pb-10 pt-4 max-md:px-3">
      {children}
    </div>
  );
}

export function FeedCard({
  className,
  leading,
  children,
  onClick,
}: {
  className?: string;
  leading: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'flex w-full items-start gap-3.5 rounded-card border border-line bg-surface p-5 text-left shadow-hairline transition-colors hover:bg-hover max-md:p-4',
        className,
      )}
      onClick={onClick}
      type="button"
    >
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
    </button>
  );
}

export function FeedIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-inset text-ink-3 max-md:size-8"
    >
      <Icon className="size-4" strokeWidth={1.8} />
    </span>
  );
}

export function FeedCardSkeleton() {
  return (
    <Card aria-hidden="true" className="p-5 max-md:p-4" variant="surface">
      <div className="flex items-start gap-3.5">
        <Skeleton className="mt-0.5 size-10 shrink-0 rounded-full max-md:size-8" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 py-0.5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </Card>
  );
}
