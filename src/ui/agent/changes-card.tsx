'use client';

import { useState, type ComponentProps } from 'react';
import { Card } from '../card';
import { cn } from '../lib/cn';
import { Collapsible, CollapsibleChevron } from '../collapsible';
import { DiffStat, type DiffCounts } from './diff-stat';

/** 回答末尾的「本轮改动」卡片：默认折叠，防止大轮次刷屏；children 是 ChangedFile 列表。 */
function ChangesCard({
  fileCount,
  counts,
  warning,
  children,
  className,
  ...props
}: ComponentProps<'section'> & {
  fileCount: number;
  counts?: DiffCounts;
  warning?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card asChild>
      <section
        aria-label="本轮改动"
        className={cn('mt-3 text-sm', className)}
        data-slot="changes-card"
        {...props}
      >
        <button
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors duration-base hover:bg-hover"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <CollapsibleChevron className="text-ink-3" open={open} />
          <span className="shrink-0 text-xs text-ink-3">本轮改动 · {fileCount} 个文件</span>
          {counts && <DiffStat className="min-w-0" counts={counts} hideZero />}
        </button>
        <Collapsible open={open}>
          <ul className="grid border-t border-line">{children}</ul>
          {warning && (
            <p className="border-t border-line px-3 py-2 text-xs leading-5 text-ink-3">{warning}</p>
          )}
        </Collapsible>
      </section>
    </Card>
  );
}

export { ChangesCard };
