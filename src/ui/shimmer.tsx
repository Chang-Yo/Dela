import type * as React from 'react';
import { cn } from './lib/cn';

function Shimmer({ className, style, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-block animate-shimmer bg-clip-text text-transparent motion-reduce:animate-none',
        className,
      )}
      data-slot="shimmer"
      style={{
        backgroundImage:
          'linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)',
        backgroundSize: '200% 100%',
        ...style,
      }}
      {...props}
    />
  );
}

export { Shimmer };
