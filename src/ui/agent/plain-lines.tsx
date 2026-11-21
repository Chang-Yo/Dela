import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** 带行号的纯文本行：bash、ls、grep、find 等不需要语法高亮的工具输出。 */
function PlainLines({ lines, className, ...props }: ComponentProps<'div'> & { lines: string[] }) {
  // 行号列按位数定宽：左内边距 0.75rem、右内边距 0.5rem、分隔线 1px。
  const gutter = `calc(${String(lines.length).length}ch + 1.25rem + 1px)`;
  return (
    <div
      className={cn('font-mono text-xs leading-5 text-ink-2', className)}
      data-slot="plain-lines"
      {...props}
    >
      {lines.map((line, i) => (
        <div key={i} className="grid" style={{ gridTemplateColumns: `${gutter} minmax(0,1fr)` }}>
          <span
            className={cn(
              'border-r border-line pr-2 pl-3 text-right text-xs text-ink-3 select-none',
              i === 0 && 'pt-3',
              i === lines.length - 1 && 'pb-3',
            )}
          >
            {i + 1}
          </span>
          <code
            className={cn(
              'pr-3 pl-3 break-words whitespace-pre-wrap',
              i === 0 && 'pt-3',
              i === lines.length - 1 && 'pb-3',
            )}
          >
            {line}
          </code>
        </div>
      ))}
    </div>
  );
}

export { PlainLines };
