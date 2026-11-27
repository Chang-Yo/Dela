import { Bot, SquareTerminal } from 'lucide-react';
import type {
  AgentToolResult,
  SubagentDetails,
  TaskNoticeDetails,
} from '../../../core/protocol/agent';
import { SubagentCard } from '../../../ui/agent/subagent-card';
import { ToolStep } from '../../../ui/agent/tool-step';
import { Button } from '../../../ui/button';
import { useNow } from '../../../ui/hooks/use-now';
import { useChatTabSource } from './chat-source';
import { formatDuration } from './format-duration';
import { ChatMarkdown } from './markdown';
import {
  TASK_STATUS_LABEL,
  TASK_STEP_STATUS,
  taskMeta,
  taskStepStatus,
  type TaskRun,
} from './task-run';
import { BashView, openSubagent, toolEntry } from './tool-views';

/**
 * 子 Agent 或后台命令从派出到结束都是这一行：只报状态与用时，原地更新；子 Agent 行尾随时可以打开它的会话。
 * 后台命令展开只有命令本身，输出随完成通知送达。
 */
export function TaskStep({ result, run }: { result: AgentToolResult; run: TaskRun }) {
  const { navigate } = useChatTabSource();
  const now = useNow(1000, run.kind === 'running');
  const status = taskStepStatus(run);
  const entry = toolEntry(result.name);
  const target = entry.target(result);
  const subagent = result.name === 'task';
  const details = result.output?.details as SubagentDetails | undefined;
  const input = (result.input ?? {}) as { prompt?: unknown; command?: unknown };
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const command = typeof input.command === 'string' ? input.command : '';
  const reply = run.kind === 'ended' ? run.body : undefined;
  return (
    <ToolStep
      action={
        subagent &&
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
      icon={entry.icon}
      label={status === 'running' ? entry.doing : entry.done}
      meta={taskMeta(run, now)}
      status={status}
      target={{ text: target.text, title: target.title, mono: entry.mono }}
    >
      {subagent
        ? (prompt || reply) && (
            <SubagentCard
              prompt={prompt}
              result={reply && <ChatMarkdown animated={false}>{reply}</ChatMarkdown>}
            />
          )
        : command && <BashView command={command} failed={status === 'error'} output="" />}
    </ToolStep>
  );
}

export function TaskNoticeStep({ content, task }: { content: string; task: TaskNoticeDetails }) {
  return (
    <ToolStep
      className="my-2"
      icon={task.kind === 'bash' ? <SquareTerminal /> : <Bot />}
      label={`后台${task.kind === 'bash' ? '命令' : '子 Agent '}${TASK_STATUS_LABEL[task.status]}`}
      meta={
        task.status === 'failed' && task.exitCode !== undefined
          ? `退出码 ${task.exitCode}`
          : formatDuration(task.durationMs)
      }
      status={TASK_STEP_STATUS[task.status]}
      target={{ text: task.label, title: task.label, mono: task.kind === 'bash' }}
    >
      {content.trim() && (
        <ChatMarkdown className="text-sm" mode="static">
          {content}
        </ChatMarkdown>
      )}
    </ToolStep>
  );
}
