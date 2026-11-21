'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/cn';
import { DiffStat, type DiffCounts } from './diff-stat';

type ToolCardProps = ComponentProps<'div'> & {
  icon: ReactNode;
  title: string;
  stats?: DiffCounts;
  copyText?: string;
  failed?: boolean;
  bodyClassName?: string;
};

function ToolCard({
  icon,
  title,
  stats,
  copyText,
  failed = false,
  bodyClassName,
  children,
  className,
  ...props
}: ToolCardProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(copyText ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-card bg-surface shadow-card',
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
      {/* 标题保留正常行高：leading-none 会在字号调大后裁掉下划线与字形下缘。 */}
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 py-2 text-sm">
        {icon}
        <span className="min-w-0 truncate font-mono leading-normal text-ink">{title}</span>
        {stats && (
          <DiffStat
            className="ml-auto shrink-0 items-center gap-2 leading-none tabular-nums"
            counts={stats}
          />
        )}
        {copyText !== undefined && (
          <button
            type="button"
            aria-label="Copy code"
            onClick={copy}
            className={cn(
              '-mr-1 ml-auto flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 text-xs font-medium transition-colors duration-fast hover:bg-hover',
              copied ? 'text-success' : 'text-ink-3 hover:text-ink',
            )}
          >
            {copied ? (
              <Check aria-hidden className="size-3" />
            ) : (
              <Copy aria-hidden className="size-3" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

export { ToolCard, type ToolCardProps };
