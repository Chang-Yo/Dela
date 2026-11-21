import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { TraceDisclosure } from './trace';

/** 相邻工具步骤：给出 summary 时折成一行摘要，否则平铺。 */
function ToolGroup({
  summary,
  failed = false,
  children,
  className,
  ...props
}: ComponentProps<'div'> & { summary?: string; failed?: boolean }) {
  return (
    <div className={cn('my-1', className)} data-slot="tool-group" {...props}>
      {summary === undefined ? (
        children
      ) : (
        <TraceDisclosure
          head={
            <>
              <span className="min-w-0 truncate">{summary}</span>
              {failed && <span className="shrink-0 text-danger">有失败</span>}
            </>
          }
        >
          {children}
        </TraceDisclosure>
      )}
    </div>
  );
}

export { ToolGroup };
