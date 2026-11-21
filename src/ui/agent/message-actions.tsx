import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** 消息操作栏：位于 UserMessage 或 AssistantMessage 内，悬停或聚焦时出现。 */
function MessageActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100',
        className,
      )}
      data-slot="message-actions"
      {...props}
    />
  );
}

export { MessageActions };
