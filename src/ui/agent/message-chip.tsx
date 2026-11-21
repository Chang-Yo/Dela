import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Chip } from './chip';

/** 用户消息气泡下方的一行附件、引用或会话 chip。 */
function MessageChips({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5', className)}
      data-slot="message-chips"
      {...props}
    />
  );
}

function MessageChip({
  icon,
  title,
  onClick,
  children,
}: {
  icon?: ReactNode;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
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
      className="gap-1.5 px-2 transition-colors hover:bg-hover-strong hover:text-ink"
      data-slot="message-chip"
      title={title}
    >
      <button onClick={onClick} type="button">
        {content}
      </button>
    </Chip>
  ) : (
    <Chip className="gap-1.5 px-2" data-slot="message-chip" title={title}>
      {content}
    </Chip>
  );
}

export { MessageChip, MessageChips };
