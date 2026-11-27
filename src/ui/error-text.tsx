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

export { ErrorText };
