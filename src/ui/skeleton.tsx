import type * as React from 'react';
import { cn } from './cn';

// 底色用 fill：在 surface、inset、page 上都看得见；尺寸与形状由调用方给出。
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-chip bg-fill motion-reduce:animate-none', className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
