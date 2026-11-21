import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

type DiffCounts = { added: number; deleted: number };

function DiffStat({
  counts,
  hideZero = false,
  className,
  ...props
}: ComponentProps<'span'> & { counts: DiffCounts; hideZero?: boolean }) {
  return (
    <span
      className={cn('flex gap-1.5 font-mono text-xs', className)}
      data-slot="diff-stat"
      {...props}
    >
      {(!hideZero || counts.added > 0) && <span className="text-success">+{counts.added}</span>}
      {(!hideZero || counts.deleted > 0) && <span className="text-danger">-{counts.deleted}</span>}
    </span>
  );
}

export { DiffStat, type DiffCounts };
