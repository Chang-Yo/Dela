import type * as React from 'react';
import { cn } from '../../lib/utils';

// 样式 token 与 input.tsx 完全对齐（rounded/border/bg/px/py/text/focus ring/disabled），
// 仅替换为 textarea 并去掉 file 输入专用类；高度用 min-h 而非固定 h，供调用方按需覆盖。
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex min-h-16 w-full min-w-0 rounded-md bg-transparent px-3 py-1 text-sm transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'border-input border shadow-xs focus-visible:border-ring dark:bg-input/30',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
