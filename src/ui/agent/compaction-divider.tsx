import type { ComponentProps } from 'react';
import { Archive } from 'lucide-react';
import { cn } from '../lib/cn';
import { Shimmer } from '../shimmer';

function CompactionDivider({
  pending = false,
  className,
  ...props
}: ComponentProps<'div'> & { pending?: boolean }) {
  return (
    <div
      className={cn('my-6 flex items-center gap-3 text-xs text-ink-3', className)}
      data-slot="compaction-divider"
      role="status"
      {...props}
    >
      <span className="h-px flex-1 bg-line" />
      <Archive aria-hidden className="size-3.5 shrink-0" />
      {pending ? <Shimmer>正在压缩上下文</Shimmer> : <span>上下文已自动压缩</span>}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export { CompactionDivider };
