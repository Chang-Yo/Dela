import type { ComponentProps } from 'react';
import { Package } from 'lucide-react';
import { Card } from '../card';
import { cn } from '../lib/cn';

/** 扩展注入的消息：标明来源类型，正文由 children 渲染。 */
function ExtensionMessage({
  customType,
  children,
  className,
  ...props
}: ComponentProps<'div'> & { customType: string }) {
  return (
    <Card
      className={cn('my-3 grid gap-1.5', className)}
      data-slot="extension-message"
      variant="inset"
      {...props}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
        <Package aria-hidden className="size-3" strokeWidth={1.8} />
        扩展 · {customType}
      </span>
      {children}
    </Card>
  );
}

export { ExtensionMessage };
