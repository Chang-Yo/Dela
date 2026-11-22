import { use, type ReactNode } from 'react';
import { Layers } from 'lucide-react';
import type { AgentToolResult, WorkspaceChat } from '../../../core/protocol/agent';
import { Reasoning } from '../../../ui/agent/reasoning';
import { ToolGroup } from '../../../ui/agent/tool-group';
import { ToolStep, type ToolStepStatus } from '../../../ui/agent/tool-step';
import { Trace, type TraceFold } from '../../../ui/agent/trace';
import { formatDuration } from './format-duration';
import { ChatMarkdown } from './markdown';
import { BackgroundTaskContext, taskRun } from './task-run';
import { TaskStep } from './task-step';
import { stepMeta, toolBody, toolEntry } from './tool-views';

// 回复的行内轨迹：思考与工具步骤按发生顺序夹在正文之间，每步一行，展开看输入输出。
// 状态只用颜色表达：运行中 accent，失败 danger。整轮折叠后不再单独列出任何步骤，
// 仍在后台运行的任务由折叠行尾报出；失败标在步骤行尾，整轮失败由错误卡说明。

type ChatParts = NonNullable<WorkspaceChat['messages'][number]['parts']>;
type Part = ChatParts[number];

function ChatToolStep({ result, live }: { result: AgentToolResult; live: boolean }) {
  const run = taskRun(result, live, use(BackgroundTaskContext));
  if (run) return <TaskStep result={result} run={run} />;
  const failed = Boolean(result.output?.isError);
  const status: ToolStepStatus =
    live && result.finishedAt === undefined
      ? 'running'
      : failed
        ? 'error'
        : !live && result.finishedAt === undefined
          ? 'interrupted'
          : 'done';
  const entry = toolEntry(result.name);
  const target = entry.target(result);
  // 失败也走工具视图，只由行尾标记与卡片色条提示，不把正文染红。
  return (
    <ToolStep
      icon={entry.icon}
      label={status === 'running' ? entry.doing : entry.done}
      meta={stepMeta(result, status)}
      status={status}
      target={{ text: target.text, title: target.title, mono: entry.mono }}
    >
      {toolBody(result, failed)}
    </ToolStep>
  );
}

function summarize(results: AgentToolResult[]): string {
  const counts = new Map<string, number>();
  for (const result of results) counts.set(result.name, (counts.get(result.name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => `${toolEntry(name).done} ${count} ${toolEntry(name).noun}`)
    .join('，');
}

// 步骤少时折叠省不了几行，却多一次点击。
const FOLD_MIN_STEPS = 4;

/** live 是整条回复是否在运行；正在增长的最后一组不折叠。 */
function ChatToolGroup({
  results,
  live,
  last,
}: {
  results: AgentToolResult[];
  live: boolean;
  last: boolean;
}) {
  const tasks = use(BackgroundTaskContext);
  const fold = !(live && last) && results.length >= FOLD_MIN_STEPS;
  const running = results.some((result) => taskRun(result, live, tasks)?.kind === 'running');
  const failed = results.some((result) => result.output?.isError);
  return (
    <ToolGroup
      icon={<Layers />}
      meta={running ? '运行中' : failed ? '有失败' : undefined}
      summary={fold ? summarize(results) : undefined}
      tone={running ? 'accent' : failed ? 'danger' : 'neutral'}
    >
      {results.map((result) => (
        <ChatToolStep key={result.id} live={live} result={result} />
      ))}
    </ToolGroup>
  );
}

/** 回复正文与轨迹：相邻工具合并为一块；块 key 取首个 part 的索引，流式增长不重建。 */
export function ReplyTrace({
  parts,
  live,
  startedAt,
  finishedAt,
  renderText,
}: {
  parts: ChatParts;
  live: boolean;
  /** 本轮的起止时刻（用户发问到回复落定）；旧会话没有，折叠行只报状态。 */
  startedAt?: number;
  finishedAt?: number;
  renderText?: (text: string) => ReactNode;
}) {
  const tasks = use(BackgroundTaskContext);
  const blocks: { key: number; part: Part }[] = [];
  parts.forEach((part, index) => {
    const last = blocks.at(-1);
    if (part.type === 'tools' && last?.part.type === 'tools')
      blocks[blocks.length - 1] = {
        key: last.key,
        part: { type: 'tools', results: [...last.part.results, ...part.results] },
      };
    else if (part.type === 'tools' ? part.results.length : part.text.trim())
      blocks.push({ key: index, part });
  });
  const lastIndex = blocks.length - 1;
  const renderBlock = ({ part }: (typeof blocks)[number], index: number) => {
    const blockLive = live && index === lastIndex;
    if (part.type === 'text')
      return (
        <div data-assistant-body className="my-3 min-w-0 text-sm leading-7 text-ink first:mt-0">
          {renderText ? (
            renderText(part.text)
          ) : (
            <ChatMarkdown animated={false}>{part.text}</ChatMarkdown>
          )}
        </div>
      );
    if (part.type === 'reasoning')
      return (
        <Reasoning
          label={
            part.startedAt !== undefined && part.finishedAt !== undefined
              ? `思考了 ${formatDuration(part.finishedAt - part.startedAt)}`
              : undefined
          }
          live={blockLive}
        >
          {part.text}
        </Reasoning>
      );
    return <ChatToolGroup last={index === lastIndex} live={live} results={part.results} />;
  };
  // 整轮结束且以正文收尾：之前的说明、思考与工具自动折进一行，只留最终回复。
  const foldable = !live && blocks.length > 1 && blocks[lastIndex]!.part.type === 'text';
  let fold: TraceFold | undefined;
  if (foldable) {
    const results = blocks.flatMap(({ part }) => (part.type === 'tools' ? part.results : []));
    const duration =
      startedAt !== undefined && finishedAt !== undefined && finishedAt > startedAt
        ? formatDuration(finishedAt - startedAt)
        : null;
    const running = results.filter(
      (result) => taskRun(result, live, tasks)?.kind === 'running',
    ).length;
    fold = {
      label: `${results.length ? '已处理' : '已思考'}${duration ? ` · 用时 ${duration}` : ''}`,
      meta: running ? `${running} 个后台任务运行中` : undefined,
      tone: 'accent',
    };
  }
  return (
    <Trace
      blocks={blocks.map((block, index) => ({ key: block.key, node: renderBlock(block, index) }))}
      fold={fold}
    />
  );
}
