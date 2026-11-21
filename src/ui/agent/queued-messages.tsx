'use client';

import type { ComponentProps } from 'react';
import { Undo2 } from 'lucide-react';
import { cn } from '../lib/cn';

function QueuedMessages({
  messages,
  onWithdraw,
  className,
  ...props
}: ComponentProps<'div'> & {
  messages: string[];
  onWithdraw?: () => void;
}) {
  return (
    <div
      aria-label="待送达的消息"
      className={cn(
        'mb-2 flex animate-pop-in items-start gap-2 rounded-card bg-surface px-3 py-1.5 text-sm leading-6 shadow-hairline',
        className,
      )}
      data-slot="queued-messages"
      role="status"
      {...props}
    >
      <ol className="min-w-0 flex-1">
        {messages.map((text, index) => (
          <li className="flex min-w-0 items-baseline gap-2" key={index}>
            <span
              aria-hidden
              className="min-w-3 shrink-0 text-right text-xs tabular-nums text-ink-3"
            >
              {index + 1}
            </span>
            <span className="truncate text-ink-2" title={text}>
              {text}
            </span>
          </li>
        ))}
      </ol>
      {onWithdraw && (
        <button
          className="-mr-1 flex h-6 shrink-0 items-center gap-1 rounded-chip px-1.5 text-xs text-ink-3 transition-colors hover:bg-hover hover:text-ink [&_svg]:size-3"
          onClick={onWithdraw}
          title="撤回到输入框"
          type="button"
        >
          <Undo2 />
          撤回
        </button>
      )}
    </div>
  );
}

export { QueuedMessages };
