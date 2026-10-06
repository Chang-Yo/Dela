import type * as React from 'react';
import { cn } from '../../lib/utils';

// default 保持标准输入框外观；ghost 无边框透明、无阴影，聚焦只保留 ring 不加边框，
// 供面板内的裸输入（如标题行）使用。
const inputVariants = {
  default: 'border-input border shadow-xs focus-visible:border-ring dark:bg-input/30',
  ghost: '',
} as const;

function Input({
  className,
  type,
  variant = 'default',
  ...props
}: React.ComponentProps<'input'> & { variant?: keyof typeof inputVariants }) {
  return (
    <input
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-9 w-full min-w-0 rounded-md bg-transparent px-3 py-1 text-sm transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        inputVariants[variant],
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
