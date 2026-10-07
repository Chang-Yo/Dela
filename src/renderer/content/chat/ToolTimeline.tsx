import { useId, useState, type ReactNode } from 'react';
import {
  BookOpen,
  Brain,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Check,
  CircleAlert,
  ClipboardList,
  CopyPlus,
  FilePen,
  FilePenLine,
  FilePlus,
  FileText,
  FolderPen,
  FolderSearch,
  Globe,
  GraduationCap,
  Link2,
  LoaderCircle,
  Mail,
  MailPlus,
  RefreshCw,
  Search,
  SquareTerminal,
  TextSearch,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AgentToolResult, WorkspaceChat } from '../../../shared/api';
import { cn } from '../../lib/utils';
import { ChatMarkdown } from './markdown';
import { ToolBody } from './tool-views';
import styles from './timeline.module.css';

type ChatParts = NonNullable<WorkspaceChat['messages'][number]['parts']>;

const toolDisplay: Record<string, { label: string; icon: LucideIcon; verb?: string }> = {
  // 内核工具行显示英文工具名（与工具表一致）；verb 只用于状态行"正在…"的中文动词。
  Read: { label: 'Read', icon: FileText, verb: '读取文件' },
  Write: { label: 'Write', icon: FilePen, verb: '写入文件' },
  Edit: { label: 'Edit', icon: FilePenLine, verb: '编辑文件' },
  Grep: { label: 'Grep', icon: TextSearch, verb: '搜索内容' },
  Glob: { label: 'Glob', icon: FolderSearch, verb: '查找文件' },
  Bash: { label: 'Bash', icon: SquareTerminal, verb: '执行命令' },
  WebFetch: { label: 'WebFetch', icon: Globe, verb: '读取网页' },
  WebSearch: { label: 'WebSearch', icon: Globe, verb: '搜索网页' },
  ReadSkills: { label: 'ReadSkills', icon: BookOpen, verb: '读取 Skill' },
  prepare_email: { label: '准备邮件草稿', icon: MailPlus },
  query_schedule: { label: '查询日程', icon: CalendarDays },
  query_assignments: { label: '查询作业', icon: ClipboardList },
  find_courses: { label: '查找课程', icon: GraduationCap },
  sync_sources: { label: '同步课程资料', icon: RefreshCw },
  search_sources: { label: '查找资料', icon: Search },
  search_workspace: { label: '查找项目文件', icon: Search },
  search_mail: { label: '查找邮件', icon: Mail },
  read_resource: { label: '读取资料', icon: BookOpen },
  web_search: { label: '搜索网页', icon: Globe },
  fetch_page: { label: '读取网页', icon: FileText },
  create_entry: { label: '创建条目', icon: FilePlus },
  update_entry: { label: '整理条目', icon: FolderPen },
  write_note: { label: '保存笔记', icon: FilePenLine },
  link_source: { label: '关联资料', icon: Link2 },
  copy_file_to_project: { label: '复制文件', icon: CopyPlus },
  create_event: { label: '创建日程', icon: CalendarPlus },
};

function display(name: string): { label: string; icon: LucideIcon; verb?: string } {
  return toolDisplay[name] ?? { label: name, icon: Wrench };
}

export type ToolOutput = {
  ok?: boolean;
  error?: { message?: string };
  result?: { draftId?: string };
} | null;

// 从工具输入提取一行摘要 chip：内核工具按类型取关键字段，其余工具按旧字段顺序兜底。
function stepChip(result: AgentToolResult): string {
  const input = result.input as Record<string, unknown> | null;
  if (!input || typeof input !== 'object') return '';
  const text = (key: string) =>
    typeof input[key] === 'string' && input[key] ? (input[key] as string) : '';
  switch (result.name) {
    case 'Bash':
      if (text('command')) return text('command').split('\n')[0]!;
      return input.cancel ? '取消任务' : '继续读取';
    case 'Read':
    case 'Write':
    case 'Edit':
      return text('path');
    case 'Grep':
    case 'Glob':
      return text('pattern');
    case 'WebFetch':
      return text('url');
    case 'WebSearch':
      return text('query');
    case 'ReadSkills':
      return text('file') ? `${text('skill')} · ${text('file')}` : text('skill');
    default: {
      const value = [
        text('query'),
        text('title'),
        text('name'),
        text('subject'),
        text('url'),
        text('path'),
        text('command'),
      ].find(Boolean);
      return value ?? '';
    }
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

type StepState = 'running' | 'done' | 'failed' | 'interrupted';

function stepState(result: AgentToolResult, live: boolean): StepState {
  if (result.output === undefined) return live ? 'running' : 'interrupted';
  return (result.output as ToolOutput)?.ok ? 'done' : 'failed';
}

/** 左侧连线的图标节点：所有行共用一个槽位，保证 rail 对齐一致。 */
function RailNode({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="relative z-10 grid size-6 place-items-center bg-background">
      {children}
    </span>
  );
}

/**
 * 思考段：过程叙事里最弱的一层。收起时只有一行小号弱化文案（思考 · N 秒），
 * 点击展开全文；运行中尚未结束的思考默认展开（实时可见），结束后自动收起，
 * 手动开合后尊重用户选择。
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
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? (live && finishedAt === undefined);
  const duration =
    startedAt !== undefined && finishedAt !== undefined
      ? formatDuration(finishedAt - startedAt)
      : null;
  return (
    <li className="grid min-w-0 animate-in grid-cols-[auto_minmax(0,1fr)] gap-3 fade-in duration-300 motion-reduce:animate-none">
      <RailNode>
        <Brain className="size-3.5" />
      </RailNode>
      <div className="min-w-0 py-0.5">
        <button
          type="button"
          aria-expanded={open}
          className="flex items-center gap-1 rounded-sm py-0.5 text-left text-xs transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-ring"
          onClick={() => setOverride(!open)}
        >
          <span>思考</span>
          {duration && <span className="tabular-nums">· {duration}</span>}
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 transition-transform motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
        </button>
        <div
          aria-hidden={!open}
          className={cn(
            'grid transition-[grid-template-rows,opacity] motion-reduce:transition-none',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            {/* 展开后限高滚动：思考很长时不把页面拖得过高。 */}
            <div
              data-reasoning-body
              className="max-h-64 overflow-y-auto py-0.5 leading-relaxed whitespace-pre-wrap"
            >
              {text}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** 工具动作行直接展开输入输出，错误说明始终可见。 */
function TimelineStep({ result, live }: { result: AgentToolResult; live: boolean }) {
  const { label, icon: Icon } = display(result.name);
  const state = stepState(result, live);
  const output = result.output as ToolOutput | undefined;
  const chip = stepChip(result);
  return (
    <li className="grid min-w-0 animate-in grid-cols-[auto_minmax(0,1fr)] gap-3 fade-in duration-300 motion-reduce:animate-none">
      <RailNode>
        {state === 'running' ? (
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
        ) : state === 'failed' ? (
          <CircleAlert className="size-3.5 text-destructive" />
        ) : (
          <Icon className="size-3.5" />
        )}
      </RailNode>
      <div className="min-w-0 py-0.5">
        <details className="group/details">
          <summary className="flex min-w-0 cursor-pointer list-none items-center gap-x-2 rounded-sm py-0.5 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className="shrink-0">{label}</span>
            {chip && (
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={chip}>
                {chip}
              </span>
            )}
            {state === 'running' && <span className="sr-only">进行中</span>}
            {state === 'interrupted' && <span className="shrink-0 text-xs">未完成</span>}
            <ChevronRight
              aria-hidden
              className="size-3 shrink-0 self-center transition-transform motion-reduce:transition-none group-open/details:rotate-90"
            />
          </summary>
          <ToolBody result={result} />
        </details>
        {state === 'failed' && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-destructive">
            {output?.error?.message || '工具未返回成功结果'}
          </p>
        )}
      </div>
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
  const active = live ? tools.findLast((tool) => tool.output === undefined) : undefined;
  const lastPart = parts.findLast((part) => part.type !== 'tools' && Boolean(part.text));
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
    <div className="min-w-0 text-sm text-muted-foreground">
      {/* 汇总行收成一个左对齐的整簇：状态图标 + 结论 + 弱化的元信息 + 旋转指示，
          不再把元信息推到右端割裂成两团。 */}
      {hasActivity && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            if (!open) onInspect?.();
            setDisclosure({ live, open: !open });
          }}
          className="my-4 flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-left transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-ring"
        >
          <StatusIcon
            aria-hidden
            className={cn(
              'size-3.5 shrink-0',
              live && 'motion-safe:animate-spin',
              !live && failed > 0 && 'text-destructive',
            )}
          />
          <span
            className={cn('min-w-0 truncate', live && styles.shimmer)}
            role={live ? 'status' : undefined}
          >
            {label}
            {context && <span> · {context}</span>}
          </span>
          {tools.length > 0 && (
            <span className="shrink-0 text-xs tabular-nums">· {tools.length} 项操作</span>
          )}
          {elapsedMs !== null && (
            <span className="shrink-0 text-xs tabular-nums">· {formatDuration(elapsedMs)}</span>
          )}
          {failed > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-destructive">
              · {failed} 项失败
            </span>
          )}
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
        </button>
      )}
      <ul id={bodyId} aria-label="对话过程" className="space-y-2">
        {groups.map((group) => {
          const first = group.parts[0]!;
          if (first.type === 'text')
            return first.text ? (
              <li
                key={group.key}
                data-assistant-body
                className="my-4 min-w-0 text-foreground leading-7"
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
                <div data-worked-body aria-label="工作过程" className="relative">
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-3 w-px -translate-x-1/2 bg-border"
                  />
                  <ul className="space-y-2">
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
