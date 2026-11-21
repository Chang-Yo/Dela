import type { ComponentProps, ReactNode } from 'react';
import { Button } from '../button';
import { cn } from '../lib/cn';

/** 子 Agent 工具步骤的正文：任务说明、最终回复与进入子会话的入口。 */
function SubagentCard({
  prompt,
  reply,
  footer,
  className,
  ...props
}: ComponentProps<'div'> & {
  prompt?: string;
  reply?: ReactNode;
  footer?: { text: string; openLabel: string; onOpen: () => void };
}) {
  return (
    <div
      className={cn('my-1 grid min-w-0 gap-1.5', className)}
      data-slot="subagent-card"
      {...props}
    >
      {prompt && (
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-ink-2">
          {prompt}
        </p>
      )}
      {reply && (
        <div className="max-h-80 overflow-y-auto rounded-card border border-line px-3 py-2 text-sm leading-6">
          {reply}
        </div>
      )}
      {footer && (
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <span>{footer.text}</span>
          <Button size="sm" variant="ghost" onClick={footer.onOpen}>
            {footer.openLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export { SubagentCard };
