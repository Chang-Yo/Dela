import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { TraceDisclosure, type TraceTone } from './trace';

/** 相邻工具步骤：给出 summary 时折成一行摘要，否则平铺。 */
function ToolGroup({
  icon,
  summary,
  meta,
  tone,
  children,
  className,
  ...props
}: ComponentProps<'div'> & {
  icon?: ReactNode;
  summary?: string;
  /** 摘要行尾的整体状态，例如「运行中」「有失败」。 */
  meta?: ReactNode;
  tone?: TraceTone;
}) {
  return (
    <div className={cn('my-1', className)} data-slot="tool-group" {...props}>
      {summary === undefined ? (
        children
      ) : (
        <TraceDisclosure
          head={<span className="min-w-0 truncate">{summary}</span>}
          icon={icon}
          meta={meta}
          tone={tone}
        >
          {children}
        </TraceDisclosure>
      )}
    </div>
  );
}

export { ToolGroup };
