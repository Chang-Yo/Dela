'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from './cn';

const iconButtonVariants = cva(
  `flex shrink-0 items-center justify-center rounded-control text-ink-3
   transition-[background-color,color,transform] duration-base
   hover:bg-hover hover:text-ink active:scale-[0.94]
   disabled:pointer-events-none disabled:opacity-50
   aria-pressed:bg-selected aria-pressed:text-ink
   aria-[current=page]:bg-selected aria-[current=page]:text-ink`,
  {
    variants: {
      size: {
        xs: 'size-5 [&_svg]:size-3.5',
        sm: 'size-6 [&_svg]:size-3.5',
        md: 'size-7 [&_svg]:size-4',
        lg: 'size-8 [&_svg]:size-4',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

function IconButton({
  className,
  size,
  type = 'button',
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof iconButtonVariants>) {
  return (
    <button
      className={cn(iconButtonVariants({ size }), className)}
      data-slot="icon-button"
      type={type}
      {...props}
    />
  );
}

export { IconButton };
