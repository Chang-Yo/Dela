import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AgentToolResult, WorkspaceChat } from '../../../shared/api';
import { Shimmer } from '@/components/ui/beautifului/atoms/Shimmer';
import { cn } from '../../lib/utils';
import { ChatMarkdown } from './markdown';
import { ToolBody } from './tool-views';
import { fadeIn } from '../../components/ui/motion';

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
};

function verbOf(name: string) {
  return verbs[name] ?? { doing: `正在调用 ${name}`, done: `调用 ${name}`, noun: '次' };
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** 步骤对象：文件名、命令首行、搜索词；路径只显示文件名，完整值放 title。 */
export function stepTarget(result: AgentToolResult): { short: string; full: string } {
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
    default: {
      const value = [text('query'), text('url'), text('path'), text('name')].find(Boolean) ?? '';
      return { short: value, full: value };
    }
  }
}

/** edit 的增删行数（来自参数的 old/new 文本，无需工具 details）。 */
function editStat(result: AgentToolResult): { added: number; removed: number } | null {
  if (result.name !== 'edit') return null;
  const edits = ((result.input as { edits?: { oldText?: string; newText?: string }[] } | null)
    ?.edits ?? []) as { oldText?: string; newText?: string }[];
  if (!edits.length) return null;
  const lines = (value = '') => (value ? value.split('\n').length : 0);
  return edits.reduce(
    (total, edit) => ({
      added: total.added + lines(edit.newText),
      removed: total.removed + lines(edit.oldText),
    }),
    { added: 0, removed: 0 },
  );
}

function Disclosure({
  head,
  children,
  defaultOpen = false,
}: {
  head: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        // data-trace-toggle：ChatThread 据此在用户展开过程时暂停贴底跟随。
        data-trace-toggle
        onClick={() => setOpen(!open)}
        className="group/row flex h-7 w-full min-w-0 items-center gap-1 text-left text-13 text-ink-3 transition-colors duration-150 hover:text-ink-2 focus-visible:outline-none focus-visible:text-ink-2"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 opacity-60 transition-transform duration-150 group-hover/row:opacity-100 motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        {head}
      </button>
      {open && <div className={cn(fadeIn, 'mb-2 ml-[1.125rem] min-w-0')}>{children}</div>}
    </div>
  );
}

function StepHead({ result, live }: { result: AgentToolResult; live: boolean }) {
  const running = live && result.finishedAt === undefined;
  const failed = Boolean(result.output?.isError);
  const interrupted = !live && result.finishedAt === undefined;
  const verb = verbOf(result.name);
  const target = stepTarget(result);
  const stat = editStat(result);
  const label = running ? <Shimmer>{verb.doing}</Shimmer> : <span>{verb.done}</span>;
  return (
    <>
      <span className="shrink-0">{label}</span>
      {target.short && (
        <span
          className={cn(
            'min-w-0 truncate',
            result.name === 'bash' || result.name === 'grep' || result.name === 'find'
              ? 'font-mono text-xs'
              : '',
          )}
          title={target.full}
        >
          {target.short}
        </span>
      )}
      {stat && !running && !failed && (
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-green">+{stat.added}</span>{' '}
          <span className="text-red">−{stat.removed}</span>
        </span>
      )}
      {failed && <span className="shrink-0 text-red">失败</span>}
      {interrupted && <span className="shrink-0">未完成</span>}
    </>
  );
}

function ToolStep({ result, live }: { result: AgentToolResult; live: boolean }) {
  // 失败也走工具视图：bash 保持「$ 命令 + 输出」的代码块形态，
  // 失败只由行尾标记与卡片色条提示，不再把正文整段染红。
  return (
    <Disclosure head={<StepHead result={result} live={live} />}>
      <ToolBody failed={Boolean(result.output?.isError)} result={result} />
    </Disclosure>
  );
}

/** 完成后连续工具的一行摘要：按工具类别计数，保留首次出现的顺序。 */
function summarize(results: AgentToolResult[]): string {
  const counts = new Map<string, number>();
  for (const result of results) counts.set(result.name, (counts.get(result.name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => `${verbOf(name).done} ${count} ${verbOf(name).noun}`)
    .join('，');
}

/** 折叠行的用时：不足 1 秒按 1 秒计，分钟以上带分。 */
function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function ToolGroup({ results, live }: { results: AgentToolResult[]; live: boolean }) {
  const failed = results.filter((result) => result.output?.isError).length;
  // 运行中或单步时逐行展示；完成后多步收成摘要行，失败只在摘要标注。
  if (live || results.length === 1)
    return (
      <div className="my-1">
        {results.map((result) => (
          <ToolStep key={result.id} live={live} result={result} />
        ))}
      </div>
    );
  return (
    <div className="my-1">
      <Disclosure
        head={
          <>
            <span className="min-w-0 truncate">{summarize(results)}</span>
            {failed > 0 && <span className="shrink-0 text-red">有失败</span>}
          </>
        }
      >
        {results.map((result) => (
          <ToolStep key={result.id} live={false} result={result} />
        ))}
      </Disclosure>
    </div>
  );
}

/** 思考：运行中且是最后一块时为进行态；Pi 不提供思考结束时刻，不显示时长。 */
function Reasoning({ part, live }: { part: Extract<Part, { type: 'reasoning' }>; live: boolean }) {
  return (
    <div className="my-1">
      <Disclosure
        defaultOpen={false}
        head={live ? <Shimmer>正在思考</Shimmer> : <span>思考过程</span>}
      >
        <div
          data-reasoning-body
          className="max-h-72 overflow-y-auto border-l border-line pl-3 text-13 leading-6 whitespace-pre-wrap text-ink-3"
        >
          {part.text}
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * 回复正文与轨迹：parts 按事件顺序渲染。相邻的工具组合并（Pi 每轮一组工具调用，
 * 中间无正文时视为一段连续操作）。正文节点 key 取首次出现的索引，流式增长不重建。
 */
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
  // 只有最后一个过程块可能还在进行；更早的块已经结束。
  const lastIndex = blocks.length - 1;
  const renderBlock = ({ key, part }: (typeof blocks)[number], index: number) => {
    const blockLive = live && index === lastIndex;
    if (part.type === 'text')
      return (
        <div
          key={key}
          data-assistant-body
          className="my-3 min-w-0 text-13 leading-7 text-ink first:mt-0"
        >
          {renderText ? (
            renderText(part.text)
          ) : (
            <ChatMarkdown animated={false}>{part.text}</ChatMarkdown>
          )}
        </div>
      );
    if (part.type === 'reasoning') return <Reasoning key={key} live={blockLive} part={part} />;
    return <ToolGroup key={key} live={blockLive} results={part.results} />;
  };
  // 整轮结束且以正文收尾：之前的说明、思考与工具自动折进一行，只留最终回复。
  // 过程块保持原位只是隐藏，最终正文节点与运行中是同一个，折叠时不重建、不跳动。
  const foldable = !live && blocks.length > 1 && blocks[lastIndex]!.part.type === 'text';
  const [expanded, setExpanded] = useState(false);
  const folded = foldable && !expanded;
  const duration =
    startedAt !== undefined && finishedAt !== undefined && finishedAt > startedAt
      ? formatDuration(finishedAt - startedAt)
      : null;
  const hasTools = blocks.some(({ part }) => part.type === 'tools');
  const foldLabel = `${hasTools ? '已处理' : '已思考'}${duration ? ` · 用时 ${duration}` : ''}`;
  return (
    <div aria-label="对话过程" className="min-w-0">
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          data-trace-toggle
          onClick={() => setExpanded(!expanded)}
          className="group/row mb-1 flex h-7 w-full min-w-0 items-center gap-1 text-left text-13 text-ink-3 transition-colors duration-150 hover:text-ink-2 focus-visible:outline-none focus-visible:text-ink-2"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 opacity-60 transition-transform duration-150 group-hover/row:opacity-100 motion-reduce:transition-none',
              expanded && 'rotate-90',
            )}
          />
          <span className="min-w-0 truncate">{foldLabel}</span>
        </button>
      )}
      {blocks.map((block, index) =>
        foldable && index < lastIndex ? (
          <div
            key={block.key}
            hidden={folded}
            className={cn(fadeIn, 'ml-[0.4375rem] border-l border-line pl-[0.6875rem]')}
          >
            {renderBlock(block, index)}
          </div>
        ) : (
          renderBlock(block, index)
        ),
      )}
    </div>
  );
}
