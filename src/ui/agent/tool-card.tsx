'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

export type ToolCardProps = {
  icon: ReactNode;
  title: string;
  stats?: { added: number; deleted: number };
  copyText?: string;
  failed?: boolean;
  bodyClassName?: string;
  children: ReactNode;
};

export function ToolCard({
  icon,
  title,
  stats,
  copyText,
  failed = false,
  bodyClassName,
  children,
}: ToolCardProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(copyText ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative w-full overflow-hidden rounded-card bg-surface shadow-card">
      {failed && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[0.1875rem] bg-danger"
        />
      )}
      {/* 标题保留正常行高：leading-none 会在字号调大后裁掉下划线与字形下缘。 */}
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 py-2 text-sm">
        {icon}
        <span className="min-w-0 truncate font-mono leading-normal text-ink">{title}</span>
        {stats && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-2 font-mono text-xs leading-none tabular-nums">
            <span className="text-success">+{stats.added}</span>
            <span className="text-danger">-{stats.deleted}</span>
          </span>
        )}
        {copyText !== undefined && (
          <button
            type="button"
            aria-label="Copy code"
            onClick={copy}
            className={`-mr-1 ml-auto flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 text-xs
              font-medium transition-colors duration-fast hover:bg-hover
              ${copied ? 'text-success' : 'text-ink-3 hover:text-ink'}`}
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

/** 带行号的纯文本行：bash、ls、grep、find 等不需要语法高亮的工具输出。 */
export function PlainLines({ lines }: { lines: string[] }) {
  return (
    <div className="py-3 font-mono text-sm leading-[1.65] text-ink-2">
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start">
            <span className="select-none text-center text-xs text-ink-3">{i + 1}</span>
            <code className="pr-3 pl-1 break-words whitespace-pre-wrap">{line}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
