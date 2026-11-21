import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

function CommentRail({ className, ...props }: ComponentProps<'div'>) {
  return (
    // 评论数量不设上限：超过三行在轨道内滚动。
    <div
      className={cn('-m-px flex max-h-24 flex-wrap gap-1.5 overflow-y-auto p-px', className)}
      data-slot="comment-rail"
      {...props}
    />
  );
}

export { CommentRail };
