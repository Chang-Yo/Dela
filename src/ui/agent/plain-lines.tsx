import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** 带行号的纯文本行：bash、ls、grep、find 等不需要语法高亮的工具输出。 */
function PlainLines({ lines, className, ...props }: ComponentProps<'div'> & { lines: string[] }) {
  return (
    <div
      className={cn('py-3 font-mono text-xs leading-5 text-ink-2', className)}
      data-slot="plain-lines"
      {...props}
    >
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

export { PlainLines };
