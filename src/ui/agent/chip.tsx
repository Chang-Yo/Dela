import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

function Chip({
  className,
  asChild = false,
  ...props
}: ComponentProps<'span'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <Comp
      className={cn(
        'flex h-7 min-w-0 max-w-full items-center rounded-control bg-field text-xs text-ink-2 shadow-hairline',
        className,
      )}
      data-slot="chip"
      {...props}
    />
  );
}

export { Chip };
