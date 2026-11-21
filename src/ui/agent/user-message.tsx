import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** 用户消息：右对齐，操作栏悬停时出现。 */
function UserMessage({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('group/message mb-5 flex flex-col items-end', className)}
      data-slot="user-message"
      {...props}
    />
  );
}

function UserMessageBubble({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'max-w-message rounded-card bg-field px-3.5 py-2 text-sm leading-relaxed text-ink shadow-hairline wrap-anywhere',
        className,
      )}
      data-slot="user-message-bubble"
      {...props}
    />
  );
}

export { UserMessage, UserMessageBubble };
