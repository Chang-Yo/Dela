import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Shimmer } from '../shimmer';
import { TraceDisclosure, type TraceTone } from './trace';

type ToolStepStatus = 'running' | 'done' | 'error' | 'interrupted';

const statusTone: Record<ToolStepStatus, TraceTone> = {
  running: 'accent',
  done: 'neutral',
  error: 'danger',
  interrupted: 'neutral',
};

type ToolStepProps = Omit<ComponentProps<'div'>, 'children'> & {
  status: ToolStepStatus;
  icon: ReactNode;
  /** 动词短语，已按状态选好进行时或完成时。 */
  label: string;
  target?: { text: string; title?: string; mono?: boolean };
  /** 行尾的一句结果：数量、行号、退出码、增删行数、用时等，由调用方按工具给出。 */
  meta?: ReactNode;
  action?: ReactNode;
  /** 展开后的输入输出；不给时整行不可展开。 */
  children?: ReactNode;
};

function ToolStep({ status, label, target, ...props }: ToolStepProps) {
  return (
    <TraceDisclosure
      data-slot="tool-step"
      data-status={status}
      head={
        <>
          <span className="shrink-0">
            {status === 'running' ? <Shimmer>{label}</Shimmer> : label}
          </span>
          {target?.text && (
            <span
              className={cn('min-w-0 truncate', target.mono && 'font-mono text-xs')}
              title={target.title}
            >
              {target.text}
            </span>
          )}
        </>
      }
      tone={statusTone[status]}
      {...props}
    />
  );
}

export { ToolStep, type ToolStepProps, type ToolStepStatus };
