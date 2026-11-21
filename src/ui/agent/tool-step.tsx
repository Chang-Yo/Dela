import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Shimmer } from '../shimmer';
import { TraceDisclosure } from './trace';

type ToolStepStatus = 'running' | 'done' | 'error' | 'interrupted';

type ToolStepProps = Omit<ComponentProps<'div'>, 'children'> & {
  status: ToolStepStatus;
  icon: ReactNode;
  /** 动词短语，已按状态选好进行时或完成时。 */
  label: string;
  target?: { text: string; title?: string; mono?: boolean };
  /** 折叠时的一句结果：数量、行号、退出码、增删行数、来源头像等，由调用方按工具给出。 */
  meta?: ReactNode;
  /** 展开后的输入输出；不给时整行不可展开。 */
  children?: ReactNode;
};

/** 一步工具调用：一行「图标 + 动词 + 对象 + 结果」，展开后是工具的输入输出。 */
function ToolStep({ status, icon, label, target, meta, children, ...props }: ToolStepProps) {
  const failed = status === 'error';
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
          {meta !== undefined && (
            <span
              className={cn(
                'ml-0.5 flex shrink-0 items-center gap-1.5 text-xs tabular-nums',
                failed ? 'text-danger' : 'text-ink-3',
              )}
            >
              {meta}
            </span>
          )}
        </>
      }
      icon={<span className={cn('contents', failed && 'text-danger')}>{icon}</span>}
      {...props}
    >
      {children}
    </TraceDisclosure>
  );
}

export { ToolStep, type ToolStepProps, type ToolStepStatus };
