import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  CopyPlus,
  FilePenLine,
  FilePlus,
  FolderPen,
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
import type { AgentToolResult } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import styles from './timeline.module.css';

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

type ToolOutput = {
  ok?: boolean;
  error?: { message?: string };
  result?: { draftId?: string };
} | null;

// 从工具输入提取一行摘要 chip；没有稳定字段的工具不显示。
function stepChip(result: AgentToolResult): string {
  const input = result.input as Record<string, unknown> | null;
  if (!input || typeof input !== 'object') return '';
  const value = [input.query, input.title, input.name, input.subject].find(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  return value ?? '';
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/** 运行期间每秒跳动、结束时冻结的时钟；非运行态不启动定时器。 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

type StepState = 'running' | 'done' | 'failed' | 'interrupted';

function stepState(result: AgentToolResult, groupActive: boolean): StepState {
  if (result.output === undefined) return groupActive ? 'running' : 'interrupted';
  return (result.output as ToolOutput)?.ok ? 'done' : 'failed';
}

/** 单个动作行：图标 + 动词 + 摘要 + 耗时，可展开原始输入输出。 */
function TimelineStep({ result, state }: { result: AgentToolResult; state: StepState }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const { label, icon: Icon } = display(result.name);
  const output = result.output as ToolOutput;
  const duration =
    result.startedAt !== undefined && result.finishedAt !== undefined
      ? formatDuration(result.finishedAt - result.startedAt)
      : null;
  return (
    <li className="min-w-0 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <button
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {state === 'running' ? (
          <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" />
        ) : state === 'failed' ? (
          <CircleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : state === 'interrupted' ? (
          <CircleAlert className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {state === 'running' ? (
          <span className={`shrink-0 font-medium ${styles.shimmer}`} role="status">
            正在{label}…
          </span>
        ) : (
          <span className="shrink-0 font-medium">{label}</span>
        )}
        {state !== 'failed' && state !== 'interrupted' && stepChip(result) && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            「{stepChip(result)}」
          </span>
        )}
        {state === 'failed' && output?.error?.message && (
          <span className="min-w-0 truncate text-xs text-destructive">{output.error.message}</span>
        )}
        {state === 'interrupted' && <span className="text-xs text-muted-foreground">未完成</span>}
        {duration && (
          <span className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground/70">
            {duration}
          </span>
        )}
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            !duration && 'ms-auto',
            open && 'rotate-90',
          )}
        />
      </button>
      <div id={detailId} hidden={!open}>
        <pre className="my-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
          {JSON.stringify({ input: result.input, output: result.output })}
        </pre>
      </div>
    </li>
  );
}

/**
 * 动作执行链时间线（移植 assistant-ui ToolTimeline 的交互模式）：
 * 触发行流光提示当前动作，执行中自动展开让步骤逐个进入，完成后收起为摘要行；
 * 用户手动开合后尊重其选择。旧会话没有时间戳时按原有行样式降级。
 */
export function ToolTimeline({
  results,
  running,
  activeTool,
  onOpenDraft,
}: {
  results: AgentToolResult[];
  running: boolean;
  activeTool: string | undefined;
  onOpenDraft: (draftId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const touched = useRef(false);
  // 运行中步骤以“无输出的占位结果”表示；activeTool 是旧推送（无占位）时的兜底。
  const pending = results.length > 0 && results.at(-1)?.output === undefined;
  const active = running && (pending || Boolean(activeTool));
  const activeLabel = display(activeTool ?? (pending ? results.at(-1)!.name : '')).label;

  useEffect(() => {
    if (touched.current) return;
    setOpen(active);
  }, [active]);

  const groupId = useId();
  const completed = results.filter((result) => result.output !== undefined);
  const failed = completed.filter((result) => !(result.output as ToolOutput)?.ok).length;
  const label = active ? (
    <span className={styles.shimmer} role="status">
      正在{activeLabel}…
    </span>
  ) : completed.length ? (
    <>
      已执行 {completed.length} 个动作
      {failed ? <span className="text-destructive"> · {failed} 个失败</span> : ''}
    </>
  ) : (
    '执行已中断'
  );
  return (
    <div className="my-4 min-w-0 text-sm text-muted-foreground">
      <button
        aria-expanded={open}
        aria-controls={groupId}
        className="flex max-w-full items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground"
        onClick={() => {
          touched.current = true;
          setOpen((current) => !current);
        }}
        type="button"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="truncate">{label}</span>
      </button>
      <div
        id={groupId}
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows,opacity] motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ol
            aria-label="动作时间线"
            className="my-2 max-h-64 space-y-1 overflow-y-auto overscroll-contain border-l pl-4"
          >
            {results.map((result) => (
              <TimelineStep key={result.id} result={result} state={stepState(result, active)} />
            ))}
            {running && !pending && activeTool && (
              <li
                className="animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
                role="status"
              >
                <span className="flex items-center gap-2 py-1">
                  <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" />
                  正在{activeLabel}…
                </span>
              </li>
            )}
          </ol>
        </div>
      </div>
      {results.map((result) => {
        const output = result.output as ToolOutput;
        const draftId =
          result.name === 'prepare_email' && output?.ok ? output.result?.draftId : undefined;
        return draftId ? (
          <Button
            key={result.id}
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => onOpenDraft(draftId)}
          >
            <ArrowUpRight />
            检查并发送邮件
          </Button>
        ) : null;
      })}
    </div>
  );
}

/**
 * 思考过程块（参照 ChatGPT/Claude 的思考折叠交互）：流式期间展开、标签流光计时
 * “正在思考 · X 秒”，思考结束自动收起为“已思考 · X 秒”；用户手动开合后尊重其选择。
 */
export function ReasoningBlock({
  text,
  live,
  startedAt,
  finishedAt,
}: {
  text: string;
  live: boolean;
  startedAt?: number;
  finishedAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const touched = useRef(false);
  const thinking = live && startedAt !== undefined && finishedAt === undefined;
  const now = useNow(thinking);
  const durationMs =
    startedAt !== undefined && finishedAt !== undefined ? finishedAt - startedAt : null;

  useEffect(() => {
    if (touched.current) return;
    setOpen(thinking);
  }, [thinking]);

  const label = thinking ? (
    <span className={cn('tabular-nums', styles.shimmer)} role="status">
      正在思考 · {formatDuration(now - (startedAt ?? now))}
    </span>
  ) : durationMs !== null ? (
    <span className="tabular-nums">已思考 · {formatDuration(durationMs)}</span>
  ) : (
    '思考过程'
  );
  return (
    <div className="my-4 min-w-0 text-sm text-muted-foreground">
      <button
        aria-expanded={open}
        onClick={() => {
          touched.current = true;
          setOpen((current) => !current);
        }}
        className="flex max-w-full items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground"
        type="button"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="truncate">{label}</span>
      </button>
      <div
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows,opacity] motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            data-reasoning-body
            className="my-2 max-h-64 overflow-y-auto overscroll-contain whitespace-pre-wrap border-l pl-4 text-xs leading-6 text-muted-foreground/80"
          >
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}
