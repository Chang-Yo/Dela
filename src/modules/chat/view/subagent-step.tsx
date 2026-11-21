import { createContext, Fragment, use, type ReactNode } from 'react';
import { Bot } from 'lucide-react';
import type {
  AgentToolResult,
  SubagentDetails,
  TaskNoticeDetails,
} from '../../../core/protocol/agent';
import { SubagentCard } from '../../../ui/agent/subagent-card';
import { ToolStep, type ToolStepStatus } from '../../../ui/agent/tool-step';
import { Button } from '../../../ui/button';
import { useNow } from '../../../ui/hooks/use-now';
import { useChatTabSource } from './chat-source';
import { formatDuration } from './format-duration';
import { ChatMarkdown } from './markdown';
import { openSubagent, toolEntry } from './tool-views';

// 后台子 Agent 的工具结果在派出时就定格了：运行中看会话的后台任务列表，结束后看它的完成通知。
export type BackgroundTaskState = {
  running: Map<string, number>;
  finished: Map<string, { status: TaskNoticeDetails['status']; durationMs: number; body: string }>;
};

export const BackgroundTaskContext = createContext<BackgroundTaskState>({
  running: new Map(),
  finished: new Map(),
});

type SubagentState =
  | { kind: 'running'; since?: number; steps: number; tool?: SubagentDetails['tool'] }
  | { kind: 'background'; since: number }
  | {
      kind: 'ended';
      status: TaskNoticeDetails['status'];
      steps?: number;
      durationMs?: number;
      result?: string;
    }
  /** 后台已结束但通知还没送到，或应用在它跑完前退出了。 */
  | { kind: 'unknown' }
  | { kind: 'interrupted' };

function subagentState(
  result: AgentToolResult,
  live: boolean,
  background: BackgroundTaskState,
): SubagentState {
  const details = result.output?.details as SubagentDetails | undefined;
  if (details?.background) {
    const since = background.running.get(details.taskId);
    if (since !== undefined) return { kind: 'background', since };
    const done = background.finished.get(details.taskId);
    return done
      ? { kind: 'ended', status: done.status, durationMs: done.durationMs, result: done.body }
      : { kind: 'unknown' };
  }
  if (result.finishedAt === undefined)
    return live
      ? {
          kind: 'running',
          since: result.startedAt,
          steps: details?.steps ?? 0,
          tool: details?.tool,
        }
      : { kind: 'interrupted' };
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
    steps: details?.steps,
    durationMs: result.startedAt === undefined ? undefined : result.finishedAt - result.startedAt,
    result: (status === 'completed' ? details?.reply : reason) || undefined,
  };
}

function stepStatus(state: SubagentState): ToolStepStatus {
  if (state.kind === 'running' || state.kind === 'background') return 'running';
  if (state.kind !== 'ended') return 'interrupted';
  return state.status === 'completed'
    ? 'done'
    : state.status === 'failed'
      ? 'error'
      : 'interrupted';
}

function dotted(items: ReactNode[]) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return shown.map((item, index) => (
    <Fragment key={index}>
      {index > 0 && <span aria-hidden>·</span>}
      {item}
    </Fragment>
  ));
}

function stateMeta(state: SubagentState, now: number): ReactNode {
  switch (state.kind) {
    case 'running':
      return dotted([
        state.steps > 0 && `第 ${state.steps} 步`,
        state.tool && (
          <span className="max-w-64 truncate" key="tool" title={state.tool.target}>
            {toolEntry(state.tool.name).doing} {state.tool.target}
          </span>
        ),
        state.since !== undefined && formatDuration(now - state.since),
      ]);
    case 'background':
      return dotted(['后台运行', formatDuration(now - state.since)]);
    case 'ended':
      if (state.status === 'failed') return '失败';
      if (state.status === 'stopped') return '已停止';
      return (
        dotted([
          state.steps && `${state.steps} 步`,
          state.durationMs !== undefined && formatDuration(state.durationMs),
        ]) || '完成'
      );
    case 'unknown':
      return '后台 · 已结束';
    case 'interrupted':
      return '未完成';
  }
}

/** 一个子 Agent 从派出到结束都是这一行：状态原地更新，行尾随时可以打开它的会话。 */
export function SubagentStep({ result, live }: { result: AgentToolResult; live: boolean }) {
  const { navigate } = useChatTabSource();
  const state = subagentState(result, live, use(BackgroundTaskContext));
  const now = useNow(1000, state.kind === 'running' || state.kind === 'background');
  const details = result.output?.details as SubagentDetails | undefined;
  const input = (result.input ?? {}) as { prompt?: unknown };
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const description = toolEntry('task').target(result);
  const output = state.kind === 'ended' ? state.result : undefined;
  return (
    <ToolStep
      action={
        details && (
          <Button
            className="shrink-0"
            onClick={() => void openSubagent(details.taskId, navigate)}
            size="sm"
            title="打开子会话"
            variant="ghost"
          >
            打开
          </Button>
        )
      }
      icon={<Bot />}
      label="子 Agent"
      meta={stateMeta(state, now)}
      status={stepStatus(state)}
      target={{ text: description.text, title: description.title }}
    >
      {(prompt || output) && (
        <SubagentCard
          prompt={prompt}
          result={output && <ChatMarkdown animated={false}>{output}</ChatMarkdown>}
        />
      )}
    </ToolStep>
  );
}
