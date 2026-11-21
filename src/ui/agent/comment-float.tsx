import type { ComponentProps } from 'react';
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
    <button
      className={cn(
        'flex h-7 select-none items-center gap-1.5 whitespace-nowrap rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-fast hover:bg-hover hover:text-ink [&_svg]:size-3.5',
        className,
      )}
      data-slot="comment-float-action"
      // 不抢焦点、不清选区：点下去之前选中的文字保持原样。
      onPointerDown={(event) => event.preventDefault()}
      type="button"
      {...props}
    />
  );
}

export { CommentFloat, CommentFloatAction };
