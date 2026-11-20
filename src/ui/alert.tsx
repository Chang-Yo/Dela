import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './lib/cn';

const errorTextVariants = cva('wrap-anywhere text-danger', {
  variants: { size: { xs: 'text-xs', sm: 'text-sm' } },
  defaultVariants: { size: 'xs' },
});

function ErrorText({
  className,
  size,
  ...props
}: React.ComponentProps<'p'> & VariantProps<typeof errorTextVariants>) {
  return (
    <p
      className={cn(errorTextVariants({ size }), className)}
      data-slot="error-text"
      role="alert"
      {...props}
    />
  );
}

const calloutVariants = cva('flex items-center gap-2 rounded-card px-3 py-2 text-xs', {
  variants: { tone: { error: 'bg-danger-tint text-danger', info: 'bg-inset text-ink-2' } },
  defaultVariants: { tone: 'error' },
});

function Callout({
  className,
  tone,
  action,
  children,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof calloutVariants> & { action?: React.ReactNode }) {
  return (
    <div
      className={cn(calloutVariants({ tone }), className)}
      data-slot="callout"
      data-tone={tone ?? 'error'}
      {...props}
    >
      <div className="min-w-0 flex-1 wrap-anywhere">{children}</div>
      {action}
    </div>
  );
}

export { Callout, ErrorText };
