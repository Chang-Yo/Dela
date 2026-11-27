import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Chip } from './chip';

function MessageChips({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-1.5 flex max-w-message flex-wrap justify-end gap-1.5', className)}
      data-slot="message-chips"
      {...props}
    />
  );
}

function MessageChip({
  icon,
  onClick,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Chip>, 'asChild' | 'onClick'> & {
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return onClick ? (
    <Chip
      asChild
      className={cn(
        'gap-1.5 px-2 transition-colors hover:bg-hover-strong hover:text-ink',
        className,
      )}
      data-slot="message-chip"
      {...props}
    >
      <button onClick={onClick} type="button">
        {content}
      </button>
    </Chip>
  ) : (
    <Chip className={cn('gap-1.5 px-2', className)} data-slot="message-chip" {...props}>
      {content}
    </Chip>
  );
}

export { MessageChip, MessageChips };
