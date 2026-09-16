import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, Copy, LoaderCircle, NotebookPen } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { useReducedMotion } from 'framer-motion';
import { Dialog } from 'radix-ui';
import type { PreparedEmail, WorkspaceChat } from '../../../shared/api';
import { MailComposer } from '../mail/MailComposer';
import { leaveComposer } from '../mail/compose-close';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { errorText } from '../projects/workspace';
import { formatDuration, ReasoningBlock, ToolTimeline, useNow } from './ToolTimeline';
import styles from './timeline.module.css';

const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0';

// 使用 Streamdown 默认淡入时长与积压上限；中文按字符渐显，不额外延迟真实数据。
const textAnimation = { animation: 'fadeIn', sep: 'char' } as const;

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
  // 整轮“正在工作 · X 秒”：运行中每秒跳动，结束冻结为用时；与动作组触发行构成两层状态。
  const working = live && message.startedAt !== undefined && message.finishedAt === undefined;
  const now = useNow(working);
  const elapsedMs =
    message.startedAt !== undefined && (message.finishedAt !== undefined || working)
      ? (message.finishedAt ?? now) - message.startedAt
      : null;
  return (
    <div className="group/msg mb-8 min-w-0 text-sm leading-7 [overflow-wrap:anywhere]">
      {message.startedAt !== undefined && (
        <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span
            className={cn('tabular-nums', working && styles.shimmer)}
            role={working ? 'status' : undefined}
          >
            {elapsedMs === null
              ? '执行中断'
              : working
                ? `正在工作 · ${formatDuration(elapsedMs)}`
                : `${message.interrupted ? '执行中断' : '用时'} · ${formatDuration(elapsedMs)}`}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {parts.map((part, index) =>
        part.type === 'tools' ? (
          <ToolTimeline
            key={index}
            results={part.results}
            running={live && index === parts.length - 1}
            activeTool={activeTool}
            onOpenDraft={onOpenDraft}
          />
        ) : part.type === 'reasoning' ? (
          <ReasoningBlock
            key={index}
            text={part.text}
            live={live && index === parts.length - 1}
            startedAt={part.startedAt}
            finishedAt={part.finishedAt}
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
      {live &&
        !activeTool &&
        !parts.some((part) => (part.type === 'text' || part.type === 'reasoning') && part.text) && (
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
