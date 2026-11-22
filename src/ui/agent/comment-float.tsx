import type { ComponentProps } from 'react';
import { Button } from '../button';
import { cn } from '../lib/cn';

function CommentFloat({
  editing,
  className,
  ...props
}: ComponentProps<'div'> & { editing: boolean }) {
  return (
    <div
      className={cn(
        'absolute z-20 rounded-card bg-surface shadow-raised animate-pop-in',
        editing ? 'w-80 max-w-float p-1' : 'w-max p-0.5',
        className,
      )}
      data-slot="comment-float"
      {...props}
    />
  );
}

function CommentFloatAction({ className, ...props }: ComponentProps<'button'>) {
  return (
    <Button
      className={cn('select-none px-2 [&_svg]:size-3.5', className)}
      data-slot="comment-float-action"
      // 不抢焦点、不清选区：点下去之前选中的文字保持原样。
      onPointerDown={(event) => event.preventDefault()}
      size="sm"
      variant="ghost"
      {...props}
    />
  );
}

export { CommentFloat, CommentFloatAction };
