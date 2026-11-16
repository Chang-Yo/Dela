'use client';

import { Undo2 } from 'lucide-react';

export function QueuedMessages({
  messages,
  onWithdraw,
}: {
  messages: string[];
  onWithdraw?: () => void;
}) {
  return (
    <div
      aria-label="待送达的消息"
      className="mb-2 flex items-start gap-2 rounded-card bg-surface px-3 py-1.5 text-sm leading-6 shadow-hairline"
      role="status"
      style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}
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
