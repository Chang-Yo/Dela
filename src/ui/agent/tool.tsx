import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Shimmer } from '../shimmer';
import { TraceDisclosure } from './trace';

export type ToolStepStatus = 'running' | 'done' | 'error' | 'interrupted';

export type ToolStepProps = {
  status: ToolStepStatus;
  /** 动词短语，已按状态选好进行时或完成时。 */
  label: string;
  target?: { text: string; title?: string; mono?: boolean };
  stats?: { added: number; deleted: number };
  /** 子任务运行中的当前动作。 */
  progress?: { text: string; title?: string };
  children: ReactNode;
};

/** 一步工具调用：一行「动词 + 对象」，展开后是工具的输入输出。 */
export function ToolStep({ status, label, target, stats, progress, children }: ToolStepProps) {
  const running = status === 'running';
  return (
    <TraceDisclosure
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
            <span className="shrink-0 font-mono text-xs tabular-nums">
              <span className="text-success">+{stats.added}</span>{' '}
              <span className="text-danger">−{stats.deleted}</span>
            </span>
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
    >
      {children}
    </TraceDisclosure>
  );
}

/** 相邻工具步骤：给出 summary 时折成一行摘要，否则平铺。 */
export function ToolGroup({
  summary,
  failed = false,
  children,
}: {
  summary?: string;
  failed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="my-1">
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
