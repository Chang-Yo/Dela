import type * as React from 'react';
import { cn } from './lib/cn';

const inputVariants = {
  default:
    'bg-field shadow-hairline hover:shadow-hairline-strong focus-visible:bg-surface focus-visible:shadow-focus',
  ghost: '',
} as const;

const inputSizes = {
  default: '',
  lg: 'h-10 rounded-card px-3',
} as const;

function Input({
  className,
  type,
  variant = 'default',
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & {
  variant?: keyof typeof inputVariants;
  size?: keyof typeof inputSizes;
}) {
  return (
    <input
      className={cn(
        'h-8 py-1 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink',
        'placeholder:text-ink-3 selection:bg-accent-tint flex w-full min-w-0 rounded-control bg-transparent px-2.5 text-sm text-ink transition-[background-color,box-shadow] duration-base outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:shadow-invalid',
        inputVariants[variant],
        inputSizes[size],
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
