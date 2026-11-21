import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { TraceDisclosure } from './trace';

/** 相邻工具步骤：给出 summary 时折成一行摘要，否则平铺。 */
function ToolGroup({
  icon,
  summary,
  meta,
  failed = false,
  children,
  className,
  ...props
}: ComponentProps<'div'> & {
  icon?: ReactNode;
  summary?: string;
  /** 摘要行尾的结果，例如「有失败」。 */
  meta?: ReactNode;
  failed?: boolean;
}) {
  return (
    <div className={cn('my-1', className)} data-slot="tool-group" {...props}>
      {summary === undefined ? (
        children
      ) : (
        <TraceDisclosure
          head={
            <>
              <span className="min-w-0 truncate">{summary}</span>
              {meta !== undefined && (
                <span
                  className={cn('ml-0.5 shrink-0 text-xs', failed ? 'text-danger' : 'text-ink-3')}
                >
                  {meta}
                </span>
              )}
            </>
          }
          icon={<span className={cn('contents', failed && 'text-danger')}>{icon}</span>}
        >
          {children}
        </TraceDisclosure>
      )}
    </div>
  );
}

export { ToolGroup };
