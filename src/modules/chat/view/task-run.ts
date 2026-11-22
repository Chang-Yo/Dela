import { createContext } from 'react';
import type {
  AgentToolResult,
  BackgroundBashDetails,
  SubagentDetails,
  TaskNoticeDetails,
} from '../../../core/protocol/agent';
import type { ToolStepStatus } from '../../../ui/agent/tool-step';
import { formatDuration } from './format-duration';

// 子 Agent 与后台命令在轨迹里只报状态与用时。后台任务的工具结果在派出时就定格了：
// 运行中看会话的后台任务列表，结束后看它的完成通知。

type TaskOutcome = {
  status: TaskNoticeDetails['status'];
  durationMs?: number;
  exitCode?: number;
  body?: string;
};

export type BackgroundTaskState = {
  running: Map<string, number>;
  finished: Map<string, TaskOutcome>;
};

export const BackgroundTaskContext = createContext<BackgroundTaskState>({
  running: new Map(),
  finished: new Map(),
});

export type TaskRun =
  | { kind: 'running'; since?: number; background: boolean }
  | ({ kind: 'ended' } & TaskOutcome)
  /** 后台任务已不在列表里，完成通知却没送到：应用在它跑完前退出了。 */
  | { kind: 'unknown' }
  | { kind: 'interrupted' };

export const TASK_STEP_STATUS: Record<TaskNoticeDetails['status'], ToolStepStatus> = {
  completed: 'done',
  failed: 'error',
  stopped: 'interrupted',
};

function backgroundRun(result: AgentToolResult, tasks: BackgroundTaskState): TaskRun | undefined {
  const details = result.output?.details as SubagentDetails | BackgroundBashDetails | undefined;
  if (!details?.background) return undefined;
  const since = tasks.running.get(details.taskId);
  if (since !== undefined) return { kind: 'running', since, background: true };
  const outcome = tasks.finished.get(details.taskId);
  return outcome ? { kind: 'ended', ...outcome } : { kind: 'unknown' };
}

function subagentRun(result: AgentToolResult, live: boolean): TaskRun {
  if (result.finishedAt === undefined)
    return live
      ? { kind: 'running', since: result.startedAt, background: false }
      : { kind: 'interrupted' };
  const details = result.output?.details as SubagentDetails | undefined;
  const status =
    details && details.status !== 'running'
      ? details.status
      : result.output?.isError
        ? 'failed'
        : 'completed';
  // 工具输出开头的 taskId 是给模型续接用的，界面不显示。
  const reason = (result.output?.text ?? '').replace(/^taskId: \S+\n\n/, '').trim();
  return {
    kind: 'ended',
    status,
    durationMs: result.startedAt === undefined ? undefined : result.finishedAt - result.startedAt,
    body: (status === 'completed' ? details?.reply : reason) || undefined,
  };
}

/** 子 Agent 与后台命令的运行状态；普通工具调用返回 undefined。 */
export function taskRun(
  result: AgentToolResult,
  live: boolean,
  tasks: BackgroundTaskState,
): TaskRun | undefined {
  return (
    backgroundRun(result, tasks) ?? (result.name === 'task' ? subagentRun(result, live) : undefined)
  );
}

export function taskStepStatus(run: TaskRun): ToolStepStatus {
  if (run.kind === 'running') return 'running';
  return run.kind === 'ended' ? TASK_STEP_STATUS[run.status] : 'interrupted';
}

export function taskMeta(run: TaskRun, now: number): string | undefined {
  switch (run.kind) {
    case 'running':
      return (
        [run.background && '后台', run.since !== undefined && formatDuration(now - run.since)]
          .filter(Boolean)
          .join(' · ') || undefined
      );
    case 'ended':
      if (run.status === 'failed')
        return run.exitCode === undefined ? '失败' : `退出码 ${run.exitCode}`;
      if (run.status === 'stopped') return '已停止';
      return run.durationMs === undefined ? undefined : formatDuration(run.durationMs);
    case 'unknown':
      return '后台 · 已结束';
    case 'interrupted':
      return '未完成';
  }
}
