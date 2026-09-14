import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
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

function ToolRow({
  result,
  onOpenDraft,
}: {
  result: AgentToolResult;
  onOpenDraft: (draftId: string) => void;
}) {
  const output = result.output as ToolOutput;
  const ok = Boolean(output?.ok);
  return (
    <details className="group my-1.5 rounded-lg border text-xs">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
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
        <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="border-t px-3 py-2">
        {result.name === 'prepare_email' && ok && output?.result?.draftId && (
          <Button size="sm" className="mb-2" onClick={() => onOpenDraft(output.result!.draftId!)}>
            <ArrowUpRight />
            检查并发送
          </Button>
        )}
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
          {JSON.stringify(output?.result ?? output, null, 2)}
        </pre>
      </div>
    </details>
  );
}

const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0';

// 流式期间未闭合的 ``` 会让剩余全文渲染成代码块；奇数个围栏时补一个临时闭合。
function completeFences(text: string): string {
  const fences = text.match(/```/g)?.length ?? 0;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

/** 对话消息流：唯一滚动容器，向上生长，流式时自动吸底。 */
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
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [draft, setDraft] = useState<{ draft: PreparedEmail; address: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // 距底 48px 内视为“在底部”：流式输出继续跟随；滚轮向上立即脱离，翻阅历史不被打扰。
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom !== followingRef.current) {
      followingRef.current = atBottom;
      setFollowing(atBottom);
    }
  };
  const onWheel = (event: React.WheelEvent) => {
    if (event.deltaY < 0 && !followingRef.current) return;
    if (event.deltaY < 0) {
      followingRef.current = false;
      setFollowing(false);
    }
  };

  // 内容高度变化（流式增量、图片加载）时处于跟随态就吸底。
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && followingRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    followingRef.current = true;
    setFollowing(true);
    el?.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  };

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

  const messages = chat.messages;
  const lastIndex = messages.length - 1;
  const streaming = Boolean(chat.running);

  return (
    <div className={`relative min-h-0 flex-1 ${className ?? ''}`}>
      <div
        ref={scrollRef}
        className="size-full overflow-y-auto [overflow-anchor:none]"
        onScroll={onScroll}
        onWheel={onWheel}
      >
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 py-4">
          {messages.map((message, index) => {
            const isLast = index === lastIndex;
            return message.role === 'user' ? (
              <div key={index} className="mb-4 flex flex-col items-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed">
                  {message.content}
                </div>
                {message.sources?.length ? (
                  <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1">
                    {message.sources.map((source) => (
                      <button
                        key={source.key}
                        className="max-w-full truncate rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40"
                        onClick={() => onOpenSource(source.key)}
                      >
                        {source.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div key={index} className="mb-6 text-sm leading-relaxed">
                <div className={markdownStyles}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({ alt }) => <span>{alt}</span>,
                      a: ({ href, children }) => (
                        <button
                          className="underline underline-offset-2"
                          onClick={() =>
                            href &&
                            void window.dela?.canvas
                              .openLink(href)
                              .catch((e) => setHint(errorText(e)))
                          }
                        >
                          {children}
                        </button>
                      ),
                    }}
                  >
                    {streaming && isLast ? completeFences(message.content) : message.content}
                  </ReactMarkdown>
                  {streaming && isLast && !chat.activeTool && (
                    <span
                      aria-hidden="true"
                      className="ml-0.5 inline-block h-4 w-[3px] translate-y-[3px] animate-pulse rounded-full bg-foreground/70"
                    />
                  )}
                </div>
                {streaming && isLast && !message.content && !chat.activeTool && (
                  <p
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <LoaderCircle className="size-3 animate-spin" />
                    正在思考…
                  </p>
                )}
                {streaming && isLast && chat.activeTool && (
                  <p
                    className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <LoaderCircle className="size-3 animate-spin" />
                    {toolLabels[chat.activeTool] ?? chat.activeTool}…
                  </p>
                )}
                {message.toolResults?.map((result) => (
                  <ToolRow
                    key={result.id}
                    result={result}
                    onOpenDraft={(id) => void openDraft(id)}
                  />
                ))}
                {!streaming && (
                  <button
                    className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => onSaveNote(message.content)}
                  >
                    <NotebookPen className="size-3.5" />
                    保存为笔记
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!following && messages.length > 0 && (
        <button
          aria-label="回到底部"
          className="absolute bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-full border bg-background shadow-md transition-colors hover:bg-muted/60"
          onClick={scrollToBottom}
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
