'use client';

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { CopyAction } from './copy-action';
import { DiffStat, type DiffCounts } from './diff-stat';

type ToolCardProps = ComponentProps<'div'> & {
  icon: ReactNode;
  title: string;
  /** title 是路径时，目录淡色并允许截断，文件名始终完整。 */
  titleIsPath?: boolean;
  /** 标题后的补充说明，例如起始行号。 */
  meta?: ReactNode;
  stats?: DiffCounts;
  copyText?: string;
  failed?: boolean;
  bodyClassName?: string;
};

function ToolCardTitle({ title, isPath }: { title: string; isPath: boolean }) {
  if (!isPath)
    return <span className="min-w-0 truncate font-mono leading-normal text-ink">{title}</span>;
  const nameStart = Math.max(title.lastIndexOf('/'), title.lastIndexOf('\\')) + 1;
  return (
    <span className="flex min-w-0 font-mono leading-normal" title={title}>
      {nameStart > 0 && (
        <span className="min-w-0 truncate text-ink-3">{title.slice(0, nameStart)}</span>
      )}
      <span className="shrink-0 text-ink">{title.slice(nameStart)}</span>
    </span>
  );
}

function ToolCard({
  icon,
  title,
  titleIsPath = false,
  meta,
  stats,
  copyText,
  failed = false,
  bodyClassName,
  children,
  className,
  ...props
}: ToolCardProps) {
  return (
    <div
      className={cn(
        'group/card relative w-full overflow-hidden rounded-card border border-line bg-surface',
        className,
      )}
      data-slot="tool-card"
      {...props}
    >
      {failed && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-0.75 bg-danger"
        />
      )}
      <div className="flex h-8 items-center gap-2 border-b border-line bg-inset px-3 text-xs">
        {icon}
        <ToolCardTitle isPath={titleIsPath} title={title} />
        {meta && <span className="shrink-0 text-ink-3">{meta}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {stats && <DiffStat className="tabular-nums" counts={stats} />}
          {copyText !== undefined && (
            <span className="-mr-1.5 opacity-0 transition-opacity duration-fast group-focus-within/card:opacity-100 group-hover/card:opacity-100">
              <CopyAction label="复制" text={copyText} />
            </span>
          )}
        </span>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

export { ToolCard, type ToolCardProps };
