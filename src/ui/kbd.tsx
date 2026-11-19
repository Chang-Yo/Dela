import type * as React from 'react';
import { cn } from './cn';

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-chip bg-field px-1.5 text-xs font-medium text-ink-2 shadow-hairline',
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

export { Kbd };
