import { useEffect, useLayoutEffect, useMemo, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Wrench,
  Copy,
  LoaderCircle,
  NotebookPen,
} from 'lucide-react';
import { Streamdown } from 'streamdown';
import { useReducedMotion } from 'framer-motion';
import { Dialog } from 'radix-ui';
import type { AgentToolResult, PreparedEmail, WorkspaceChat } from '../../../shared/api';
import { MailComposer } from '../mail/MailComposer';
import { leaveComposer } from '../mail/compose-close';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { errorText } from '../projects/workspace';

const toolLabels: Record<string, string> = {
  prepare_email: '准备邮件草稿',
  query_schedule: '查询日程',
  query_assignments: '查询作业',
  find_courses: '查找课程',
  sync_sources: '同步课程资料',
  search_sources: '查找资料',
  search_workspace: '查找项目文件',
  search_mail: '查找邮件',
  read_resource: '读取资料',
  create_entry: '创建条目',
  update_entry: '整理条目',
  write_note: '保存笔记',
  link_source: '关联资料',
  copy_file_to_project: '复制文件',
  create_event: '创建日程',
};

type ToolOutput = {
  ok?: boolean;
  error?: { message?: string };
  result?: { draftId?: string };
} | null;

// 从工具输入提取一行摘要；没有稳定字段的工具不显示摘要。
function toolSummary(result: AgentToolResult): string {
  const input = result.input as { title?: string; name?: string; subject?: string } | null;
  const name = input?.title ?? input?.name ?? input?.subject;
  return name ? `「${name}」` : '';
}

const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0';

// 使用 Streamdown 默认淡入时长与积压上限；中文按字符渐显，不额外延迟真实数据。
const textAnimation = { animation: 'fadeIn', sep: 'char' } as const;

/** 工具步骤行：摘要 + 可展开的原始结果。 */
function ToolStep({ result }: { result: AgentToolResult }) {
  const output = result.output as ToolOutput;
  const ok = Boolean(output?.ok);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <li className="min-w-0">
      <button
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {ok ? (
          <Wrench className="size-3.5 shrink-0" />
        ) : (
          <CircleAlert className="size-3.5 shrink-0 text-destructive" />
        )}
        <span className="shrink-0 font-medium">{toolLabels[result.name] ?? result.name}</span>
        {ok && <span className="truncate text-muted-foreground">{toolSummary(result)}</span>}
        {!ok && output?.error?.message && (
          <span className="truncate text-destructive">{output.error.message}</span>
        )}
        <ChevronRight
          className={cn(
            'ms-auto size-3 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      <div id={detailId} hidden={!open}>
        <pre className="my-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
          {JSON.stringify({ input: result.input, output }, null, 2)}
        </pre>
      </div>
    </li>
  );
}

/** 执行过程：一条消息内的工具调用折叠为一组（ChainOfThought 模式），运行中显示当前工具。 */
function ToolGroup({
  results,
  runningTool,
  onOpenDraft,
}: {
  results: AgentToolResult[];
  runningTool: string | undefined;
  onOpenDraft: (draftId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const groupId = useId();
  const failed = results.filter((result) => !(result.output as ToolOutput)?.ok).length;
  const label = runningTool
    ? `正在${toolLabels[runningTool] ?? runningTool}…`
    : results.length
      ? `已执行 ${results.length} 个动作${failed ? ` · ${failed} 个失败` : ''}`
      : '执行已中断';
  return (
    <div className="my-4 min-w-0 text-sm text-muted-foreground">
      <button
        aria-expanded={open}
        aria-controls={groupId}
        className="flex max-w-full items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {runningTool ? (
          <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" />
        ) : failed ? (
          <CircleAlert className="size-4 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-4 shrink-0" />
        )}
        <span className="truncate" role={runningTool ? 'status' : undefined}>
          {label}
        </span>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
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
              <ToolStep key={result.id} result={result} />
            ))}
            {runningTool && (
              <li className="flex items-center gap-2 py-1" role="status">
                <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" />
                正在{toolLabels[runningTool] ?? runningTool}…
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

/** 消息悬停操作栏：复制与保存为笔记，参照 assistant-ui ActionBar 的自动显隐。 */
function MessageActions({
  content,
  onSaveNote,
}: {
  content: string;
  onSaveNote: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/msg:opacity-100 group-hover/msg:opacity-100">
      <Button
        aria-label="复制回答"
        className="text-muted-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(content);
          setCopied(true);
        }}
        size="icon-sm"
        title="复制"
        variant="ghost"
      >
        {copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
      </Button>
      <Button
        aria-label="保存为笔记"
        className="text-muted-foreground"
        onClick={() => onSaveNote(content)}
        size="icon-sm"
        title="保存为笔记"
        variant="ghost"
      >
        <NotebookPen />
      </Button>
    </div>
  );
}

function UserMessage({
  message,
  anchor,
  onOpenSource,
}: {
  message: WorkspaceChat['messages'][number];
  anchor: boolean;
  onOpenSource: (key: string) => void;
}) {
  return (
    <div data-turn-anchor={anchor || undefined} className="mb-5 flex flex-col items-end">
      <div className="max-w-[85%] [overflow-wrap:anywhere] whitespace-pre-wrap rounded-3xl bg-secondary px-4 py-2.5 text-sm leading-relaxed">
        {message.content}
      </div>
      {message.sources?.length ? (
        <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1">
          {message.sources.map((source) => (
            <button
              key={source.key}
              className="max-w-full truncate rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40"
              onClick={() => onOpenSource(source.key)}
            >
              {source.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssistantMessage({
  message,
  live,
  activeTool,
  onSaveNote,
  onOpenDraft,
}: {
  message: WorkspaceChat['messages'][number];
  live: boolean;
  activeTool: string | undefined;
  onSaveNote: (text: string) => void;
  onOpenDraft: (draftId: string) => void;
}) {
  const reduced = useReducedMotion();
  // 旧会话缺少顺序信息，仅按原来的工具组 + 正文展示，不虚构中间说明。
  const parts = message.parts ?? [
    ...(message.toolResults?.length
      ? [{ type: 'tools' as const, results: message.toolResults }]
      : []),
    ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
  ];
  const elapsed =
    message.startedAt && message.finishedAt
      ? Math.max(0, Math.round((message.finishedAt - message.startedAt) / 1000))
      : null;
  return (
    <div className="group/msg mb-8 min-w-0 text-sm leading-7 [overflow-wrap:anywhere]">
      {message.startedAt && (
        <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {elapsed === null ? (
              live ? (
                '正在处理'
              ) : (
                '执行中断'
              )
            ) : (
              <>
                {message.interrupted ? '执行中断' : '用时'} ·{' '}
                {elapsed >= 60 ? `${Math.floor(elapsed / 60)} 分 ` : ''}
                {elapsed % 60} 秒
              </>
            )}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {parts.map((part, index) =>
        part.type === 'tools' ? (
          <ToolGroup
            key={index}
            results={part.results}
            runningTool={live && index === parts.length - 1 ? activeTool : undefined}
            onOpenDraft={onOpenDraft}
          />
        ) : (
          <Streamdown
            key={index}
            className={cn(markdownStyles, 'my-4 min-w-0 first:mt-0')}
            mode="streaming"
            isAnimating={live && !activeTool && index === parts.length - 1}
            animated={live && !reduced && index === parts.length - 1 ? textAnimation : false}
            controls={false}
            skipHtml
          >
            {part.text}
          </Streamdown>
        ),
      )}
      {live && !activeTool && !parts.some((part) => part.type === 'text' && part.text) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-4 motion-safe:animate-spin" />
          正在思考…
        </p>
      )}
      {!live && message.content && (
        <MessageActions content={message.content} onSaveNote={onSaveNote} />
      )}
    </div>
  );
}

/** 对话消息流：发送后用户消息锚定视口顶部，回复在其下生长；工具步骤折叠展示。 */
export function ChatThread({
  chat,
  onOpenSource,
  onSaveNote,
  className,
}: {
  chat: WorkspaceChat;
  onOpenSource: (key: string) => void;
  onSaveNote: (text: string) => void;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [draft, setDraft] = useState<{ draft: PreparedEmail; address: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const messages = chat.messages;
  const streaming = Boolean(chat.running);

  const lastUserIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') return index;
    }
    return -1;
  }, [messages]);

  // 以一行正文高度作为到底部容差，避免固定像素阈值随字号失效。
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const line =
      parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize);
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= line);
  };

  const anchoredKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    const spacer = spacerRef.current;
    if (!viewport || !content || !spacer) return;
    const key = `${chat.sessionId}:${lastUserIndex}`;
    const anchor = content.querySelector<HTMLElement>('[data-turn-anchor]');
    if (anchoredKey.current !== key) {
      anchoredKey.current = key;
      followBottom.current = false;
      spacer.style.height = '0px';
      if (streaming && anchor) {
        const inset = parseFloat(getComputedStyle(content).paddingTop);
        const target = anchor.offsetTop - inset;
        spacer.style.height = `${Math.max(0, viewport.clientHeight + target - content.scrollHeight)}px`;
        viewport.scrollTo({ top: target, behavior: 'instant' });
      } else viewport.scrollTop = viewport.scrollHeight;
    }
    const resize = () => {
      // 保留当前滚动位置所需的最小空白；回答增长时逐渐消耗，不在结束时突然归零。
      const heightWithoutReserve = content.scrollHeight - spacer.offsetHeight;
      spacer.style.height = `${Math.max(0, viewport.scrollTop + viewport.clientHeight - heightWithoutReserve)}px`;
      if (followBottom.current) viewport.scrollTop = viewport.scrollHeight;
      onScroll();
    };
    resize();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(content);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [chat.sessionId, lastUserIndex, streaming]);

  const openDraft = async (draftId: string) => {
    if (!window.dela) return;
    setHint('正在打开草稿…');
    try {
      const state = await window.dela.mail.getState();
      if (!state.account) throw new Error('请先在邮箱页面配置账号');
      const prepared = await window.dela.mail.openDraft(draftId);
      setDraft({ draft: prepared, address: state.account.address });
      setHint(null);
    } catch (e) {
      setHint(errorText(e));
    }
  };

  return (
    <div className={`relative min-h-0 flex-1 ${className ?? ''}`}>
      <div
        ref={scrollRef}
        className="size-full overflow-y-auto [overflow-anchor:none]"
        aria-label="对话消息"
        onWheel={() => {
          followBottom.current = false;
        }}
        onTouchStart={() => {
          followBottom.current = false;
        }}
        onPointerDown={() => {
          followBottom.current = false;
        }}
        onKeyDown={(event) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) followBottom.current = false;
        }}
        onScroll={onScroll}
      >
        <div ref={contentRef} className="relative mx-auto w-full max-w-3xl px-4 py-4">
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <UserMessage
                anchor={index === lastUserIndex}
                key={`${chat.sessionId}:${index}`}
                message={message}
                onOpenSource={onOpenSource}
              />
            ) : (
              <AssistantMessage
                key={`${chat.sessionId}:${index}`}
                live={streaming && index === messages.length - 1}
                message={message}
                activeTool={chat.activeTool}
                onOpenDraft={(id) => void openDraft(id)}
                onSaveNote={onSaveNote}
              />
            ),
          )}
          <div ref={spacerRef} aria-hidden="true" className="h-0" />
        </div>
      </div>
      {!atBottom && messages.length > 0 && (
        <button
          aria-label="回到底部"
          className="absolute bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-full border bg-background shadow-md transition-colors hover:bg-muted/60"
          onClick={() => {
            followBottom.current = true;
            const el = scrollRef.current;
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            el?.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
          }}
          type="button"
        >
          <ArrowDown className="size-4" strokeWidth={1.8} />
        </button>
      )}
      {hint && (
        <p
          role="status"
          className="absolute inset-x-0 bottom-0 px-4 pb-2 text-xs text-muted-foreground"
        >
          {hint}
        </p>
      )}
      <Dialog.Root
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open && !leaveComposer(() => setDraft(null))) return;
          setDraft(open ? draft : null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">检查邮件草稿</Dialog.Title>
            {draft && (
              <MailComposer
                key={draft.draft.id}
                draft={draft.draft}
                accountAddress={draft.address}
                onDirtyChange={() => {}}
                onClose={() => {
                  if (leaveComposer(() => setDraft(null))) setDraft(null);
                }}
                onSent={(warning) => {
                  setDraft(null);
                  if (warning) setHint(warning);
                }}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
