import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** 助手消息容器：同时是操作栏悬停出现的分组。 */
function AssistantMessage({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('group/message mb-8 min-w-0 text-sm leading-7 wrap-anywhere', className)}
      data-slot="assistant-message"
      {...props}
    />
  );
}

export { AssistantMessage };
