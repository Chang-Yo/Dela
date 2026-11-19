import type * as React from 'react';
import { cn } from './cn';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-16 py-1.5',
        'placeholder:text-ink-3 selection:bg-accent-tint flex w-full min-w-0 rounded-control bg-transparent px-2.5 text-sm leading-relaxed text-ink transition-[background-color,box-shadow] duration-base outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'bg-field shadow-hairline hover:shadow-hairline-strong focus-visible:bg-surface focus-visible:shadow-focus',
        'aria-invalid:shadow-invalid',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
