import type { ComponentProps, ReactNode } from 'react';
import { Card } from '../card';
import { cn } from '../lib/cn';

/** 不是用户也不是模型写的消息（扩展注入、主 Agent 派来的任务）：标明来源，正文由 children 渲染。 */
function SystemMessage({
  icon,
  label,
  children,
  className,
  ...props
}: ComponentProps<'div'> & { icon: ReactNode; label: string }) {
  return (
    <Card
      className={cn('my-3 grid gap-1.5', className)}
      data-slot="system-message"
      variant="inset"
      {...props}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink-3 [&_svg]:size-3.5 [&_svg]:shrink-0">
        {icon}
        {label}
      </span>
      {children}
    </Card>
  );
}

export { SystemMessage };
