import { useState, type ReactNode } from 'react';
import { Collapsible } from 'radix-ui';
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
  FilePenLine,
  FilePlus,
  FileText,
  FolderPen,
  Globe,
  GraduationCap,
  Link2,
  LoaderCircle,
  Mail,
  MailPlus,
  RefreshCw,
  Search,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AgentToolResult, WorkspaceChat } from '../../../shared/api';
import { cn } from '../../lib/utils';
import styles from './timeline.module.css';

type ChatParts = NonNullable<WorkspaceChat['messages'][number]['parts']>;

const toolDisplay: Record<string, { label: string; icon: LucideIcon }> = {
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

function display(name: string) {
  return toolDisplay[name] ?? { label: name, icon: Wrench };
}

export type ToolOutput = {
  ok?: boolean;
  error?: { message?: string };
  result?: { draftId?: string };
} | null;

// 从工具输入提取一行摘要 chip；没有稳定字段的工具不显示。
function stepChip(result: AgentToolResult): string {
  const input = result.input as Record<string, unknown> | null;
  if (!input || typeof input !== 'object') return '';
  const value = [
    input.query,
    input.title,
    input.name,
    input.subject,
    input.url,
    input.path,
    input.command,
  ].find((item): item is string => typeof item === 'string' && item.length > 0);
  return value ?? '';
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
            <div data-reasoning-body className="whitespace-pre-wrap py-0.5 leading-relaxed">
              {text}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** 工具动作：单行紧凑条目（图标 + 动词 + 一行摘要），成功不需要文字说明；
 *  原始数据收进安静的「输入与结果」disclosure。 */
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
        <div className="flex min-w-0 items-baseline gap-x-2">
          <span className="shrink-0">{label}</span>
          {chip && (
            <span className="min-w-0 truncate text-xs text-muted-foreground" title={chip}>
              {chip}
            </span>
          )}
          {state === 'running' && <span className="sr-only">进行中</span>}
          {state === 'interrupted' && <span className="shrink-0 text-xs">未完成</span>}
        </div>
        {state === 'failed' && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-destructive">
            {output?.error?.message || '工具未返回成功结果'}
          </p>
        )}
        <details className="group/details text-xs">
          <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-0.5 rounded-sm py-0.5 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            输入与结果
            <ChevronRight
              aria-hidden
              className="size-3 transition-transform motion-reduce:transition-none group-open/details:rotate-90"
            />
          </summary>
          <pre className="mb-1 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3">
            {JSON.stringify({ input: result.input, output: result.output }, null, 2)}
          </pre>
        </details>
      </div>
    </li>
  );
}

/** 新一轮自动展开，整轮结束后收起；运行期间保留手动开合选择。 */
export function WorkingSection({
  parts,
  live,
  answering = false,
  status,
  elapsedMs,
  failed,
  onInspect,
}: {
  parts: ChatParts;
  live: boolean;
  answering?: boolean;
  status: 'done' | 'interrupted' | 'stopped';
  elapsedMs: number | null;
  failed: number;
  onInspect?: () => void;
}) {
  const [disclosure, setDisclosure] = useState({ live, open: live });
  // 只在运行阶段改变时重置开合，正文和工具更新不触发自动收起。
  const open = disclosure.live === live ? disclosure.open : live;
  if (disclosure.live !== live) setDisclosure({ live, open: live });
  const tools = parts.flatMap((part) => (part.type === 'tools' ? part.results : []));
  const active = live ? tools.findLast((tool) => tool.output === undefined) : undefined;
  const lastPart = parts.findLast((part) => part.type !== 'tools' && Boolean(part.text));
  const label = live
    ? active
      ? `正在${display(active.name).label}`
      : answering
        ? '正在整理回答'
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
    <Collapsible.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onInspect?.();
        setDisclosure({ live, open: next });
      }}
      className="my-4 min-w-0 text-sm text-muted-foreground"
    >
      {/* 汇总行收成一个左对齐的整簇：状态图标 + 结论 + 弱化的元信息 + 旋转指示，
          不再把元信息推到右端割裂成两团。 */}
      <Collapsible.Trigger className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-left transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-ring">
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
          <span className="shrink-0 text-xs tabular-nums text-destructive">· {failed} 项失败</span>
        )}
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div data-worked-body aria-label="工作过程" className="relative mt-3">
          <div aria-hidden className="absolute inset-y-0 left-3 w-px -translate-x-1/2 bg-border" />
          <ul className="space-y-2">
            {parts.map((part, index) => {
              if (part.type === 'tools')
                return part.results.map((result) => (
                  <TimelineStep key={result.id} live={live} result={result} />
                ));
              // 工具前后的公开正文可能只是流式短片段，不作为过程记录展示。
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
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
