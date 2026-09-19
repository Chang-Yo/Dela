import { useId, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
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
import { ChatMarkdown } from './markdown';
import styles from './timeline.module.css';

export type ChatParts = NonNullable<WorkspaceChat['messages'][number]['parts']>;

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

/** 单个动作行：图标钉在左侧连线上，动词 + 摘要一行；点击展开原始输入输出。 */
function TimelineStep({ result, live }: { result: AgentToolResult; live: boolean }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const { label, icon: Icon } = display(result.name);
  const state = stepState(result, live);
  const output = result.output as ToolOutput | undefined;
  return (
    <li className="relative animate-in fade-in pl-6 duration-300 motion-reduce:animate-none slide-in-from-bottom-1">
      <span className="absolute left-0 top-1 grid size-3.5 place-items-center">
        {state === 'running' ? (
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
        ) : state === 'failed' ? (
          <CircleAlert className="size-3.5 text-destructive" />
        ) : state === 'interrupted' ? (
          <CircleAlert className="size-3.5 text-muted-foreground" />
        ) : (
          <Icon className="size-3.5 text-muted-foreground" />
        )}
      </span>
      <button
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-foreground"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
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
        <ChevronRight
          className={cn(
            'ms-auto size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      <div id={detailId} hidden={!open}>
        <pre className="my-1 max-h-48 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
          {JSON.stringify({ input: result.input, output: result.output }, null, 2)}
        </pre>
      </div>
    </li>
  );
}

/** 思考段落：圆点钉在连线上，正文以弱化色阅读。 */
function ThoughtRow({ text }: { text: string }) {
  return (
    <li className="relative pl-6">
      <span
        aria-hidden
        className="absolute left-[4px] top-[9px] size-1.5 rounded-full bg-muted-foreground/50"
      />
      <div data-reasoning-body className="whitespace-pre-wrap py-0.5 text-sm leading-relaxed">
        {text}
      </div>
    </li>
  );
}

/** 工具之间的说明文字：与思考段落同级展示，但不带圆点。 */
function NarrationRow({ text }: { text: string }) {
  return (
    <li className="relative pl-6">
      <div className="py-0.5 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        <ChatMarkdown
          className="text-sm leading-relaxed"
          mode="streaming"
          isAnimating={false}
          animated={false}
        >
          {text}
        </ChatMarkdown>
      </div>
    </li>
  );
}

/**
 * 工作过程区（DeepSeek 风格）：思考、动作与中间说明按发生顺序平铺在一条左侧连线上，
 * 整段只有一个折叠层级——消除此前“已工作 > 动作组 > 步骤”的冗余层级。
 * 运行中自动展开；尾部公开正文开始后整段自动收起；手动开合后尊重用户选择。
 */
export function WorkingSection({
  parts,
  live,
  autoOpen,
  status,
  elapsedMs,
  failed,
}: {
  parts: ChatParts;
  live: boolean;
  autoOpen: boolean;
  status: 'working' | 'done' | 'interrupted' | 'stopped';
  elapsedMs: number | null;
  failed: number;
}) {
  // null 跟随 autoOpen 自动开合；首次手动点击后固定用户选择，不再被流式状态覆盖。
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? autoOpen;
  const bodyId = useId();

  return (
    <div className="my-4 min-w-0 text-sm text-muted-foreground">
      <button
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex max-w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors hover:text-foreground"
        onClick={() => setOverride(!open)}
        type="button"
      >
        {live ? (
          <span className={`shrink-0 ${styles.shimmer}`} role="status">
            正在工作
          </span>
        ) : (
          <span className="truncate tabular-nums">
            {status === 'interrupted' ? '工作中断' : status === 'stopped' ? '已停止' : '已工作'}
            {elapsedMs !== null ? ` · ${formatDuration(elapsedMs)}` : ''}
            {failed > 0 && <span className="text-destructive"> · {failed} 个失败</span>}
          </span>
        )}
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      <div
        id={bodyId}
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows,opacity] motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div data-worked-body className="min-h-0 overflow-hidden">
          <div aria-label="工作过程" className="relative my-1 py-1">
            <div
              aria-hidden
              className="absolute inset-y-0 left-[7px] w-px -translate-x-1/2 bg-border"
            />
            <ul className="space-y-1">
              {parts.map((part, index) => {
                if (part.type === 'tools') {
                  return part.results.map((result) => (
                    <TimelineStep key={result.id} live={live} result={result} />
                  ));
                }
                if (!part.text) return null;
                return part.type === 'reasoning' ? (
                  <ThoughtRow key={index} text={part.text} />
                ) : (
                  <NarrationRow key={index} text={part.text} />
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
