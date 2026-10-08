import { useId, useState, type ReactNode } from 'react';
import {
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  FilePen,
  FilePenLine,
  FileText,
  FolderOpen,
  FolderSearch,
  Globe,
  LoaderCircle,
  SquareTerminal,
  TextSearch,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AgentToolResult, WorkspaceChat } from '../../../shared/api';
import { cn } from '../../lib/utils';
import ThinkingState from '@/components/ui/beautifului/primitives/ThinkingState';
import { ChatMarkdown } from './markdown';
import { ToolBody } from './tool-views';

type ChatParts = NonNullable<WorkspaceChat['messages'][number]['parts']>;

const toolDisplay: Record<string, { label: string; icon: LucideIcon; verb?: string }> = {
  // Pi 内置工具显示英文工具名；verb 只用于状态行"正在…"的中文动词。
  read: { label: 'read', icon: FileText, verb: '读取文件' },
  write: { label: 'write', icon: FilePen, verb: '写入文件' },
  edit: { label: 'edit', icon: FilePenLine, verb: '编辑文件' },
  grep: { label: 'grep', icon: TextSearch, verb: '搜索内容' },
  find: { label: 'find', icon: FolderSearch, verb: '查找文件' },
  ls: { label: 'ls', icon: FolderOpen, verb: '列出目录' },
  bash: { label: 'bash', icon: SquareTerminal, verb: '执行命令' },
  web_fetch: { label: 'web_fetch', icon: Globe, verb: '读取网页' },
  web_search: { label: 'web_search', icon: Globe, verb: '搜索网页' },
};

function display(name: string): { label: string; icon: LucideIcon; verb?: string } {
  return toolDisplay[name] ?? { label: name, icon: Wrench };
}

// 从工具输入提取一行摘要 chip：内置工具按类型取关键字段，其余工具按常见字段兜底。
function stepChip(result: AgentToolResult): string {
  const input = result.input as Record<string, unknown> | null;
  if (!input || typeof input !== 'object') return '';
  const text = (key: string) =>
    typeof input[key] === 'string' && input[key] ? (input[key] as string) : '';
  switch (result.name) {
    case 'bash':
      return text('command').split('\n')[0]!;
    case 'read':
    case 'write':
    case 'edit':
    case 'ls':
      return text('path');
    case 'grep':
    case 'find':
      return text('pattern');
    default:
      return [text('query'), text('url'), text('path'), text('name')].find(Boolean) ?? '';
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

type StepState = 'running' | 'done' | 'failed' | 'interrupted';

function stepState(result: AgentToolResult, live: boolean): StepState {
  if (result.finishedAt === undefined) return live ? 'running' : 'interrupted';
  return result.output?.isError ? 'failed' : 'done';
}

/**
 * 思考段：基于 beautiful-ui ThinkingState 的受控用法。收起时只有一行小号弱化文案
 * （思考 · N 秒），点击展开全文；运行中尚未结束的思考默认展开（实时可见），结束后
 * 自动收起，手动开合后尊重用户选择。
 */
function ThoughtStep({
  text,
  startedAt,
  finishedAt,
  live,
}: {
  text: string;
  startedAt?: number;
  finishedAt?: number;
  live: boolean;
}) {
  const duration =
    startedAt !== undefined && finishedAt !== undefined
      ? formatDuration(finishedAt - startedAt)
      : null;
  return (
    <li className="min-w-0 animate-in fade-in duration-300 motion-reduce:animate-none">
      <ThinkingState
        variant="Reasoning"
        active="思考中"
        done={duration ? `思考 · ${duration}` : '思考'}
        fill
        icon={<Brain className="size-4" />}
        working={live && finishedAt === undefined}
        rows={[{ primary: text }]}
        renderBody={() => (
          <div
            data-reasoning-body
            className="max-h-64 overflow-y-auto px-1.5 py-0.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2"
          >
            {text}
          </div>
        )}
      />
    </li>
  );
}

/** 工具动作行直接展开输入输出，错误说明始终可见；行样式取自 beautiful-ui ToolChips。 */
function TimelineStep({ result, live }: { result: AgentToolResult; live: boolean }) {
  const { label, icon: Icon } = display(result.name);
  const state = stepState(result, live);
  const chip = stepChip(result);
  return (
    <li className="min-w-0 animate-in fade-in duration-300 motion-reduce:animate-none">
      <details className="group/details">
        <summary
          className="-mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 cursor-pointer list-none
            items-center gap-2 rounded-control px-[3px] text-left text-ink transition-colors
            duration-100 hover:bg-hover-2 focus-visible:outline focus-visible:outline-2
            focus-visible:outline-bui-accent [&::-webkit-details-marker]:hidden"
        >
          {/* 图标槽：常态显示工具/状态图标，悬浮或展开时切出旋转箭头（ToolChips 行模式）。 */}
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <span
              aria-hidden
              className="flex size-3.5 items-center justify-center text-ink-3 transition-opacity duration-100 group-hover/details:opacity-0 group-open/details:opacity-0"
            >
              {state === 'running' ? (
                <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
              ) : state === 'failed' ? (
                <CircleAlert className="size-3.5 text-red" />
              ) : (
                <Icon className="size-3.5" />
              )}
            </span>
            <ChevronRight
              aria-hidden
              className="absolute size-3 opacity-0 transition-[opacity,transform] duration-150 motion-reduce:transition-none group-hover/details:opacity-100 group-open/details:rotate-90 group-open/details:opacity-100"
            />
          </span>
          <span className="shrink-0 text-[12.5px] font-medium">{label}</span>
          {chip && (
            <span
              className="inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5 font-mono text-[11.5px] text-ink-2 shadow-hairline"
              title={chip}
            >
              {chip}
            </span>
          )}
          {state === 'running' && <span className="sr-only">进行中</span>}
          {state === 'interrupted' && (
            <span className="shrink-0 text-[11.5px] text-ink-3">未完成</span>
          )}
        </summary>
        <div className="mt-0.5 mb-1 ml-2 border-l border-line py-0.5 pl-3.5">
          <ToolBody result={result} />
        </div>
      </details>
      {state === 'failed' && (
        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[11.5px] text-red">
          {result.output?.text || '工具未返回成功结果'}
        </p>
      )}
    </li>
  );
}

/** 新一轮自动展开，整轮结束后收起；运行期间保留手动开合选择。 */
export function WorkingSection({
  parts,
  live,
  status,
  elapsedMs,
  failed,
  onInspect,
  renderText,
}: {
  parts: ChatParts;
  live: boolean;
  status: 'done' | 'interrupted' | 'stopped';
  elapsedMs: number | null;
  failed: number;
  onInspect?: () => void;
  renderText?: (text: string) => ReactNode;
}) {
  const [disclosure, setDisclosure] = useState({ live, open: live });
  // 只在运行阶段改变时重置开合，正文和工具更新不触发自动收起。
  const open = disclosure.live === live ? disclosure.open : live;
  if (disclosure.live !== live) setDisclosure({ live, open: live });
  const bodyId = useId();
  // 参照 OpenCode groupParts：只合并相邻过程条目，正文作为顺序边界。
  // key 使用 append-only parts 的首索引，流式增长不会改变已有正文节点身份。
  const groups: { key: number; parts: ChatParts }[] = [];
  parts.forEach((part, index) => {
    if (part.type === 'tools' ? part.results.length === 0 : !part.text) return;
    const last = groups.at(-1);
    if (part.type !== 'text' && last && last.parts[0]?.type !== 'text') last.parts.push(part);
    else groups.push({ key: index, parts: [part] });
  });
  const hasActivity = parts.some((part) =>
    part.type === 'tools'
      ? part.results.length > 0
      : part.type === 'reasoning' && Boolean(part.text),
  );
  const tools = parts.flatMap((part) => (part.type === 'tools' ? part.results : []));
  const active = live ? tools.findLast((tool) => tool.finishedAt === undefined) : undefined;
  const lastPart = parts.findLast((part) => part.type !== 'tools' && Boolean(part.text));
  // 折叠时中途的说明文字随过程一起收起，只保留最后一段正文（最终回答）。
  const lastTextKey = groups.findLast((group) => group.parts[0]?.type === 'text')?.key;
  const label = live
    ? active
      ? `正在${display(active.name).verb ?? display(active.name).label}`
      : lastPart?.type === 'reasoning'
        ? '正在思考'
        : '正在工作'
    : status === 'interrupted'
      ? '工作中断'
      : status === 'stopped'
        ? '已停止'
        : '已完成';
  const context = active ? stepChip(active) : '';
  const StatusIcon = live ? LoaderCircle : status !== 'done' || failed > 0 ? CircleAlert : Check;

  return (
    <div className="min-w-0 text-[13px] text-ink-2">
      {/* 汇总行收成一个左对齐的整簇（ThinkingState 头部样式）：状态图标 + 结论 +
          弱化的元信息 + 旋转指示，运行中结论走库的 shimmer-text 渐变。 */}
      {hasActivity && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            if (!open) onInspect?.();
            setDisclosure({ live, open: !open });
          }}
          className="-mx-1.5 my-4 flex w-full min-w-0 items-center gap-1.5 rounded-control px-1.5 py-1 text-left transition-colors duration-100 hover:bg-hover-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bui-accent"
        >
          <StatusIcon
            aria-hidden
            className={cn(
              'size-3.5 shrink-0',
              live ? 'motion-safe:animate-spin text-ink-2' : '',
              !live && failed > 0 && 'text-red',
              !live && status === 'done' && failed === 0 && 'text-green',
            )}
          />
          <span
            className={cn('min-w-0 truncate font-medium', !live && 'text-ink-2')}
            role={live ? 'status' : undefined}
          >
            {/* 渐变与 bg-clip-text 必须同元素：背景在外层会把整个盒子涂满而非裁进文字。 */}
            <span
              className={live ? 'bg-clip-text text-transparent' : undefined}
              style={
                live
                  ? {
                      backgroundImage:
                        'linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer-text 1.4s linear infinite',
                    }
                  : undefined
              }
            >
              {label}
            </span>
            {context && <span> · {context}</span>}
          </span>
          {tools.length > 0 && (
            <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
              · {tools.length} 项操作
            </span>
          )}
          {elapsedMs !== null && (
            <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
              · {formatDuration(elapsedMs)}
            </span>
          )}
          {failed > 0 && (
            <span className="shrink-0 text-[11.5px] tabular-nums text-red">· {failed} 项失败</span>
          )}
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-ink-3 transition-transform motion-reduce:transition-none"
            style={{ transform: open ? 'rotate(90deg)' : undefined }}
          />
        </button>
      )}
      <ul id={bodyId} aria-label="对话过程" className="space-y-1">
        {groups.map((group) => {
          const first = group.parts[0]!;
          if (first.type === 'text')
            return first.text ? (
              <li
                key={group.key}
                data-assistant-body
                hidden={!open && group.key !== lastTextKey}
                className="my-4 min-w-0 text-sm leading-7 text-ink"
              >
                {renderText ? (
                  renderText(first.text)
                ) : (
                  <ChatMarkdown animated={false}>{first.text}</ChatMarkdown>
                )}
              </li>
            ) : null;
          return (
            <li key={group.key} hidden={!open}>
              {open && (
                <div data-worked-body aria-label="工作过程" className="min-w-0">
                  <ul className="space-y-1">
                    {group.parts.map((part, index) => {
                      if (part.type === 'tools')
                        return part.results.map((result) => (
                          <TimelineStep key={result.id} live={live} result={result} />
                        ));
                      if (part.type !== 'reasoning' || !part.text) return null;
                      return (
                        <ThoughtStep
                          key={index}
                          text={part.text}
                          startedAt={part.startedAt}
                          finishedAt={part.finishedAt}
                          live={live}
                        />
                      );
                    })}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
