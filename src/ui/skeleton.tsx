import type * as React from 'react';
import { cn } from './lib/cn';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-chip bg-fill motion-reduce:animate-none', className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
