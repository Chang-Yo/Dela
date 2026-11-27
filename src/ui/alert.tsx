import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './lib/cn';

const alertVariants = cva('flex items-center gap-2 rounded-card px-3 py-2 text-xs', {
  variants: { tone: { danger: 'bg-danger-tint text-danger', neutral: 'bg-inset text-ink-2' } },
  defaultVariants: { tone: 'danger' },
});

function Alert({
  className,
  tone,
  action,
  children,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & { action?: React.ReactNode }) {
  return (
    <div
      className={cn(alertVariants({ tone }), className)}
      data-slot="alert"
      data-tone={tone ?? 'danger'}
      {...props}
    >
      <div className="min-w-0 flex-1 wrap-anywhere">{children}</div>
      {action}
    </div>
  );
}

export { Alert };
