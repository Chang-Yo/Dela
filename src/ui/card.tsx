import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

const cardVariants = cva('rounded-card', {
  variants: {
    variant: {
      outline: 'overflow-hidden border border-line',
      surface: 'border border-line bg-surface p-4',
      inset: 'bg-inset px-4 py-3',
    },
  },
  defaultVariants: { variant: 'outline' },
});

function Card({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof cardVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div';
  return <Comp className={cn(cardVariants({ variant }), className)} data-slot="card" {...props} />;
}

export { Card };
