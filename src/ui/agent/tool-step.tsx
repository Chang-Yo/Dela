import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Shimmer } from '../shimmer';
import { DiffStat, type DiffCounts } from './diff-stat';
import { TraceDisclosure } from './trace';

type ToolStepStatus = 'running' | 'done' | 'error' | 'interrupted';

type ToolStepProps = Omit<ComponentProps<'div'>, 'children'> & {
  status: ToolStepStatus;
  /** 动词短语，已按状态选好进行时或完成时。 */
  label: string;
  target?: { text: string; title?: string; mono?: boolean };
  stats?: DiffCounts;
  /** 子任务运行中的当前动作。 */
  progress?: { text: string; title?: string };
  children: ReactNode;
};

/** 一步工具调用：一行「动词 + 对象」，展开后是工具的输入输出。 */
function ToolStep({ status, label, target, stats, progress, children, ...props }: ToolStepProps) {
  const running = status === 'running';
  return (
    <TraceDisclosure
      data-slot="tool-step"
      head={
        <>
          <span className="shrink-0">
            {running ? <Shimmer>{label}</Shimmer> : <span>{label}</span>}
          </span>
          {target?.text && (
            <span
              className={cn('min-w-0 truncate', target.mono && 'font-mono text-xs')}
              title={target.title}
            >
              {target.text}
            </span>
          )}
          {stats && (status === 'done' || status === 'interrupted') && (
            <DiffStat className="shrink-0 tabular-nums" counts={stats} />
          )}
          {progress && (
            <span className="min-w-0 truncate text-xs" title={progress.title}>
              {progress.text}
            </span>
          )}
          {status === 'error' && <span className="shrink-0 text-danger">失败</span>}
          {status === 'interrupted' && <span className="shrink-0">未完成</span>}
        </>
      }
      {...props}
    >
      {children}
    </TraceDisclosure>
  );
}

export { ToolStep, type ToolStepProps, type ToolStepStatus };
