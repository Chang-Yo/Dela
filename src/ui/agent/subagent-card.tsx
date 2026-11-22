import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** 子 Agent 步骤展开后的正文：交给它的任务与它交回的结果（回复或失败原因）。 */
function SubagentCard({
  prompt,
  result,
  className,
  ...props
}: ComponentProps<'div'> & {
  prompt?: string;
  result?: ReactNode;
}) {
  return (
    <div
      className={cn('my-1 grid min-w-0 gap-2.5', className)}
      data-slot="subagent-card"
      {...props}
    >
      {prompt && (
        <section className="grid gap-0.5">
          <h4 className="text-xs text-ink-3">任务</h4>
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-6 text-ink-2">
            {prompt}
          </p>
        </section>
      )}
      {result && (
        <section className="grid gap-0.5">
          <h4 className="text-xs text-ink-3">结果</h4>
          <div className="max-h-80 overflow-y-auto rounded-card border border-line px-3 py-2 text-sm leading-6">
            {result}
          </div>
        </section>
      )}
    </div>
  );
}

export { SubagentCard };
