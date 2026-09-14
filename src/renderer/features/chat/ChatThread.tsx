import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  LoaderCircle,
  NotebookPen,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

// 流式光标：以 sentinel 字符跟随正文尾部，随 Markdown 一起进入所在段落，
// 渲染时替换为闪烁光标——避免在 Markdown 块之外渲染出与正文脱离的光标。
const STREAM_CURSOR = '▍';

const caretSpan = (
  <span
    aria-hidden="true"
    className="mx-px inline-block h-[1em] w-[2px] animate-pulse rounded-full bg-foreground/80"
  />
);

function withCursor(children: ReactNode): ReactNode {
  if (typeof children === 'string') {
    if (!children.includes(STREAM_CURSOR)) return children;
    return children.split(STREAM_CURSOR).map((part, index) => (
      <Fragment key={index}>
        {index > 0 && caretSpan}
        {part}
      </Fragment>
    ));
  }
  if (Array.isArray(children)) return children.map((child) => withCursor(child));
  return children;
}

// 只需在可承载光标的块级元素上做替换；className 透传以保留语言标记等行为。
const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => <p>{withCursor(children)}</p>,
  li: ({ children }: { children?: ReactNode }) => <li>{withCursor(children)}</li>,
  h1: ({ children }: { children?: ReactNode }) => <h1>{withCursor(children)}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2>{withCursor(children)}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3>{withCursor(children)}</h3>,
  code: ({ className, children }: { className?: string; children?: ReactNode }) => (
    <code className={className}>{withCursor(children)}</code>
  ),
};

const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0';

// 流式期间未闭合的 ``` 会让剩余全文渲染成代码块；奇数个围栏时补一个临时闭合。
function completeFences(text: string): string {
  const fences = text.match(/```/g)?.length ?? 0;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

/** 工具步骤行：摘要 + 可展开的原始结果。 */
function ToolStep({
  result,
  onOpenDraft,
}: {
  result: AgentToolResult;
  onOpenDraft: (draftId: string) => void;
}) {
  const output = result.output as ToolOutput;
  const ok = Boolean(output?.ok);
  const [open, setOpen] = useState(false);
  const draftId = result.name === 'prepare_email' && ok ? output?.result?.draftId : undefined;
  return (
    <li className="min-w-0">
      <button
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {ok ? (
          <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
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
      {draftId && (
        <Button size="sm" className="my-1" onClick={() => onOpenDraft(draftId)}>
          <ArrowUpRight />
          检查并发送
        </Button>
      )}
      {open && (
        <pre className="my-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2 text-muted-foreground">
          {JSON.stringify(output?.result ?? output, null, 2)}
        </pre>
      )}
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
  const running = Boolean(runningTool);
  // 完成后自动收起；用户手动展开过则保持其选择。
  const [open, setOpen] = useState(running);
  const touched = useRef(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && !touched.current) setOpen(false);
    wasRunning.current = running;
  }, [running]);

  const done = results.length > 0;
  const label = runningTool
    ? `正在${toolLabels[runningTool] ?? runningTool}…`
    : done
      ? results.length > 1
        ? `已执行 ${results.length} 步`
        : (toolLabels[results[0]!.name] ?? results[0]!.name)
      : '';
  if (!label) return null;
  return (
    <div className="my-3 text-xs">
      <button
        className="flex items-center gap-2 rounded-md text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => {
          touched.current = true;
          setOpen((current) => !current);
        }}
        type="button"
      >
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <CircleCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <span>{label}</span>
        {done && (
          <ChevronRight
            className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
          />
        )}
      </button>
      {open && done && (
        <ul className="ml-[7px] mt-1 space-y-0.5 border-l pl-3">
          {results.map((result) => (
            <ToolStep key={result.id} result={result} onOpenDraft={onOpenDraft} />
          ))}
        </ul>
      )}
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
      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-secondary px-4 py-2.5 text-sm leading-relaxed">
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
  // 文字流式进行中才携带光标；执行工具期间光标停驻。
  const cursor = live && !activeTool && message.content ? STREAM_CURSOR : '';
  const text = live ? completeFences(message.content + cursor) : message.content;
  const hasTools = Boolean(message.toolResults?.length) || Boolean(live && activeTool);
  return (
    <div className="group/msg mb-8 text-sm leading-relaxed">
      {hasTools && (
        <ToolGroup
          results={message.toolResults ?? []}
          runningTool={live ? activeTool : undefined}
          onOpenDraft={onOpenDraft}
        />
      )}
      <div className={markdownStyles}>
        {text && (
          <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
            {text}
          </ReactMarkdown>
        )}
        {live && !message.content && !activeTool && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <LoaderCircle className="size-3 animate-spin" />
            正在思考…
          </p>
        )}
      </div>
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

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAtBottom((current) => (current === bottom ? current : bottom));
  };

  // 新一轮发送（流式进行中出现新用户消息）把该消息锚定到视口顶部；打开历史则直接回底部。
  const anchoredKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (lastUserIndex < 0) return;
    const key = `${chat.sessionId}:${lastUserIndex}:${messages[lastUserIndex]!.content}`;
    if (anchoredKey.current === key) return;
    anchoredKey.current = key;
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    if (!streaming) {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }
    const anchor = content.querySelector<HTMLElement>('[data-turn-anchor]');
    if (!anchor) return;
    const viewportHeight = viewport.clientHeight;
    const anchorTop = anchor.offsetTop;
    // 预留底部空白，保证锚点位置在回复内容不足一屏时也可达（assistant-ui 的 reserve 思路）。
    const below = content.scrollHeight - anchorTop;
    if (spacerRef.current)
      spacerRef.current.style.height = `${Math.max(0, viewportHeight - below)}px`;
    // 超高消息只保留底部可见：阈值为 10em，可见高度 6em（assistant-ui topAnchorMessageClamp 默认值）。
    const em = parseFloat(getComputedStyle(content).fontSize);
    const target =
      anchor.offsetHeight > em * 10 ? anchorTop + anchor.offsetHeight - em * 6 : anchorTop - 24;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    viewport.scrollTo({ top: Math.max(0, target), behavior: reduced ? 'auto' : 'smooth' });
    setAtBottom(true);
  }, [chat.sessionId, lastUserIndex, messages, streaming]);

  // 回合结束收起预留空白；收起的是答案下方的空白，视口位置不动。
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming && spacerRef.current) {
      spacerRef.current.style.height = '0px';
    }
    wasStreaming.current = streaming;
  }, [streaming]);

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
        onScroll={onScroll}
      >
        <div ref={contentRef} className="relative mx-auto w-full max-w-3xl px-4 py-4">
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <UserMessage
                anchor={index === lastUserIndex}
                key={index}
                message={message}
                onOpenSource={onOpenSource}
              />
            ) : (
              <AssistantMessage
                key={index}
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
