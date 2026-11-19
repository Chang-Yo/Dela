import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import type * as React from 'react';
import { cn } from './cn';

const spinnerVariants = cva('animate-spin', {
  variants: { size: { xs: 'size-3', sm: 'size-3.5', md: 'size-4', lg: 'size-5' } },
  defaultVariants: { size: 'md' },
});

function Spinner({
  className,
  size,
  ...props
}: Omit<React.ComponentProps<typeof LoaderCircle>, 'size'> & VariantProps<typeof spinnerVariants>) {
  return (
    <LoaderCircle
      aria-hidden
      className={cn(spinnerVariants({ size }), className)}
      data-slot="spinner"
      {...props}
    />
  );
}

export { Spinner };
