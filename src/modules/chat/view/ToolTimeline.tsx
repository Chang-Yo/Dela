import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import type { AgentToolResult, WorkspaceChat } from '../../../core/protocol/agent';
import { Reasoning } from '../../../ui/agent/reasoning';
import { ToolGroup } from '../../../ui/agent/tool-group';
import { ToolStep, type ToolStepStatus } from '../../../ui/agent/tool-step';
import { Trace } from '../../../ui/agent/trace';
import { formatDuration } from './format-duration';
import { ChatMarkdown } from './markdown';
import { SubagentStep } from './subagent-step';
import { stepMeta, toolBody, toolEntry } from './tool-views';

// 回复的行内轨迹：思考与工具步骤按发生顺序夹在正文之间，每步一行，展开看输入输出。
// 整轮折叠行只报用时；失败标在步骤行尾，整轮失败由错误卡说明。

type ChatParts = NonNullable<WorkspaceChat['messages'][number]['parts']>;
type Part = ChatParts[number];

function ChatToolStep({ result, live }: { result: AgentToolResult; live: boolean }) {
  if (result.name === 'task') return <SubagentStep live={live} result={result} />;
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

// 步骤少时折叠省不了几行，却多一次点击；子 Agent 单独成块，不折叠。
const FOLD_MIN_STEPS = 4;

/** live 是整条回复是否在运行：并行调用里子 Agent 单独成块，不在最后一块时也可能还在跑。 */
function ChatToolGroup({
  results,
  live,
  last,
}: {
  results: AgentToolResult[];
  live: boolean;
  last: boolean;
}) {
  const fold = !(live && last) && results.length >= FOLD_MIN_STEPS && results[0]!.name !== 'task';
  const failed = results.some((result) => result.output?.isError);
  return (
    <ToolGroup
      failed={failed}
      icon={<Layers />}
      meta={failed ? '有失败' : undefined}
      summary={fold ? summarize(results) : undefined}
    >
      {results.map((result) => (
        <ChatToolStep key={result.id} live={live} result={result} />
      ))}
    </ToolGroup>
  );
}

/** 回复正文与轨迹：相邻工具合并（子 Agent 另成一块，整轮折叠时不收起）；块 key 由 part 索引派生，流式增长不重建。 */
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
  const blocks: { key: number; part: Part; pinned?: boolean }[] = [];
  parts.forEach((part, index) => {
    if (part.type !== 'tools') {
      if (part.text.trim()) blocks.push({ key: index * 1000, part });
      return;
    }
    let created = 0;
    for (const result of part.results) {
      const pinned = result.name === 'task';
      const last = blocks.at(-1);
      if (last?.part.type === 'tools' && Boolean(last.pinned) === pinned)
        blocks[blocks.length - 1] = {
          ...last,
          part: { type: 'tools', results: [...last.part.results, result] },
        };
      else
        blocks.push({
          key: index * 1000 + created++,
          part: { type: 'tools', results: [result] },
          pinned,
        });
    }
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
  const duration =
    startedAt !== undefined && finishedAt !== undefined && finishedAt > startedAt
      ? formatDuration(finishedAt - startedAt)
      : null;
  const hasTools = blocks.some(({ part }) => part.type === 'tools');
  const foldLabel = `${hasTools ? '已处理' : '已思考'}${duration ? ` · 用时 ${duration}` : ''}`;
  return (
    <Trace
      blocks={blocks.map((block, index) => ({
        key: block.key,
        node: renderBlock(block, index),
        pinned: block.pinned,
      }))}
      foldLabel={foldable ? foldLabel : undefined}
    />
  );
}
