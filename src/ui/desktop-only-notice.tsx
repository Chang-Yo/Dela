import type * as React from 'react';
import { cn } from './lib/cn';

function DesktopOnlyNotice({
  title,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn('grid h-full place-items-center p-8', className)}
      data-slot="desktop-only-notice"
      {...props}
    >
      <div className="grid w-full max-w-[28.75rem] gap-2">
        <p className="text-xs font-medium text-ink-3">浏览器预览</p>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm leading-relaxed text-ink-3">{description}</p>
      </div>
    </div>
  );
}

export { DesktopOnlyNotice };
