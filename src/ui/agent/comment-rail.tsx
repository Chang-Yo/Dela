import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

function CommentRail({ className, ...props }: ComponentProps<'div'>) {
  return (
    // 评论数量不设上限：超过三行在轨道内滚动；留 4px 边距，焦点框不被滚动区裁掉。
    <div
      className={cn('-m-1 flex max-h-26 flex-wrap gap-1.5 overflow-y-auto p-1', className)}
      data-slot="comment-rail"
      {...props}
    />
  );
}

export { CommentRail };
