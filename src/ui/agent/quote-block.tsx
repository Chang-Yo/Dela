import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

function QuoteBlock({ className, ...props }: ComponentProps<'blockquote'>) {
  return (
    <blockquote
      className={cn('whitespace-pre-wrap border-l-2 border-line-strong pl-2 text-ink-3', className)}
      data-slot="quote-block"
      {...props}
    />
  );
}

export { QuoteBlock };
