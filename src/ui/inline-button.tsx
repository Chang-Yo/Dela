import type * as React from 'react';
import { cn } from './lib/cn';

/** 夹在一行文字里的操作（如错误提示后的「重试」）：沿用所在文字的颜色与字号。 */
function InlineButton({ className, type, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'rounded-chip underline underline-offset-2 outline-none transition-opacity duration-base hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      data-slot="inline-button"
      type={type ?? 'button'}
      {...props}
    />
  );
}

export { InlineButton };
