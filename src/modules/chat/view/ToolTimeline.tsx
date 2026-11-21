import type { ReactNode } from 'react';
import type { AgentToolResult, SubagentDetails, WorkspaceChat } from '../../../core/protocol/agent';
import { Reasoning } from '../../../ui/agent/reasoning';
import { ToolGroup } from '../../../ui/agent/tool-group';
import { ToolStep, type ToolStepStatus } from '../../../ui/agent/tool-step';
import { Trace } from '../../../ui/agent/trace';
import { ChatMarkdown } from './markdown';
import { ToolBody } from './tool-views';

// 回复的行内轨迹（Codex / Claude 式）：思考与工具步骤按发生顺序夹在正文之间，每步一行「动词 + 对象」。
// 整轮折叠行只报用时：失败标在步骤行尾，整轮失败由错误卡说明。

type ChatParts = NonNullable<WorkspaceChat['messages'][number]['parts']>;
type Part = ChatParts[number];

const verbs: Record<string, { doing: string; done: string; noun: string }> = {
  read: { doing: '正在读取', done: '读取', noun: '个文件' },
  write: { doing: '正在写入', done: '写入', noun: '个文件' },
  edit: { doing: '正在编辑', done: '编辑', noun: '个文件' },
  bash: { doing: '正在运行', done: '运行', noun: '条命令' },
  grep: { doing: '正在搜索', done: '搜索', noun: '次' },
  find: { doing: '正在查找', done: '查找', noun: '次' },
  ls: { doing: '正在查看', done: '查看', noun: '个目录' },
  web_search: { doing: '正在搜索网页', done: '搜索网页', noun: '次' },
  web_fetch: { doing: '正在读取网页', done: '读取网页', noun: '个' },
  task: { doing: '子 Agent 正在处理', done: '子 Agent', noun: '个任务' },
};

function verbOf(name: string) {
  return verbs[name] ?? { doing: `正在调用 ${name}`, done: `调用 ${name}`, noun: '次' };
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** 步骤对象：文件名、命令首行、搜索词；路径只显示文件名，完整值放 title。 */
function stepTarget(result: AgentToolResult): { short: string; full: string } {
  const input = (result.input ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  switch (result.name) {
    case 'read':
    case 'write':
    case 'edit':
    case 'ls': {
      const path = text('path');
      return { short: basename(path) || '.', full: path };
    }
    case 'bash': {
      const command = text('command');
      return { short: command.split('\n')[0]!, full: command };
    }
    case 'grep':
    case 'find':
      return { short: text('pattern'), full: text('pattern') };
    case 'task':
      return { short: text('description'), full: text('prompt') };
    default: {
      const value = [text('query'), text('url'), text('path'), text('name')].find(Boolean) ?? '';
      return { short: value, full: value };
    }
  }
}

/** edit 的增删行数（来自参数的 old/new 文本，无需工具 details）。 */
function editStat(result: AgentToolResult): { added: number; deleted: number } | undefined {
  if (result.name !== 'edit') return undefined;
  const edits = ((result.input as { edits?: { oldText?: string; newText?: string }[] } | null)
    ?.edits ?? []) as { oldText?: string; newText?: string }[];
  if (!edits.length) return undefined;
  const lines = (value = '') => (value ? value.split('\n').length : 0);
  return edits.reduce(
    (total, edit) => ({
      added: total.added + lines(edit.newText),
      deleted: total.deleted + lines(edit.oldText),
    }),
    { added: 0, deleted: 0 },
  );
}

function ChatToolStep({ result, live }: { result: AgentToolResult; live: boolean }) {
  const failed = Boolean(result.output?.isError);
  const status: ToolStepStatus =
    live && result.finishedAt === undefined
      ? 'running'
      : failed
        ? 'error'
        : !live && result.finishedAt === undefined
          ? 'interrupted'
          : 'done';
  const verb = verbOf(result.name);
  const target = stepTarget(result);
  const subagentTool =
    status === 'running' && result.name === 'task'
      ? (result.output?.details as SubagentDetails | undefined)?.tool
      : undefined;
  // 失败也走工具视图，只由行尾标记与卡片色条提示，不把正文染红。
  return (
    <ToolStep
      label={status === 'running' ? verb.doing : verb.done}
      progress={
        subagentTool && {
          text: `· ${verbOf(subagentTool.name).doing} ${subagentTool.target}`,
          title: subagentTool.target,
        }
      }
      stats={editStat(result)}
      status={status}
      target={{
        text: target.short,
        title: target.full,
        mono: result.name === 'bash' || result.name === 'grep' || result.name === 'find',
      }}
    >
      <ToolBody failed={failed} result={result} />
    </ToolStep>
  );
}

function summarize(results: AgentToolResult[]): string {
  const counts = new Map<string, number>();
  for (const result of results) counts.set(result.name, (counts.get(result.name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => `${verbOf(name).done} ${count} ${verbOf(name).noun}`)
    .join('，');
}

/** 折叠行的用时：不足 1 秒按 1 秒计，分钟以上带分。 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function ChatToolGroup({ results, live }: { results: AgentToolResult[]; live: boolean }) {
  const flat = live || results.length === 1;
  return (
    <ToolGroup
      failed={results.some((result) => result.output?.isError)}
      summary={flat ? undefined : summarize(results)}
    >
      {results.map((result) => (
        <ChatToolStep key={result.id} live={live} result={result} />
      ))}
    </ToolGroup>
  );
}

/** 回复正文与轨迹：相邻工具组合并（Pi 每轮一组工具调用）；正文节点 key 取首次出现的索引，流式增长不重建。 */
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
  const blocks: { key: number; part: Part }[] = [];
  parts.forEach((part, index) => {
    if (part.type === 'tools' ? part.results.length === 0 : !part.text.trim()) return;
    const last = blocks.at(-1)?.part;
    if (part.type === 'tools' && last?.type === 'tools') {
      blocks[blocks.length - 1] = {
        key: blocks.at(-1)!.key,
        part: { type: 'tools', results: [...last.results, ...part.results] },
      };
    } else blocks.push({ key: index, part });
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
    if (part.type === 'reasoning') return <Reasoning live={blockLive}>{part.text}</Reasoning>;
    return <ChatToolGroup live={blockLive} results={part.results} />;
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
      blocks={blocks.map((block, index) => ({ key: block.key, node: renderBlock(block, index) }))}
      foldLabel={foldable ? foldLabel : undefined}
    />
  );
}
