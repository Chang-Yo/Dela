import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  LoaderCircle,
  NotebookPen,
  Pencil,
  X,
} from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import type { WorkspaceChat } from '../../../shared/api';
import { chatImageToken } from '../../../shared/chat-input';
import { Button } from '../../components/ui/button';
import type { MailDraftDialog } from './chat-source';
import { WorkingSection, formatDuration, type ToolOutput } from './ToolTimeline';
import { ChatMarkdown } from './markdown';
import styles from './timeline.module.css';
import { ensureChatMediaPreview, getChatMediaPreview } from './media';

// 使用 Streamdown 默认淡入时长与积压上限；中文按字符渐显，不额外延迟真实数据。
const textAnimation = { animation: 'fadeIn', sep: 'char' } as const;

/** 消息悬停操作栏：复制与保存为笔记，参照 assistant-ui ActionBar 的自动显隐。 */
function MessageActions({
  content,
  onSaveNote,
}: {
  content: string;
  onSaveNote: ((text: string) => void) | undefined;
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
      {onSaveNote && (
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
      )}
    </div>
  );
}

/** 用户消息里的内联图片：会话内有缓存直接显示，历史消息按需拉取缩略图。 */
function MessageImage({ id, name }: { id: string; name: string }) {
  const [url, setUrl] = useState(() => getChatMediaPreview(id) ?? null);
  useEffect(() => {
    if (url) return;
    let active = true;
    void ensureChatMediaPreview(id).then((next) => {
      if (active && next) setUrl(next);
    });
    return () => {
      active = false;
    };
  }, [id, url]);
  return url ? (
    <img
      alt={name}
      className="size-20 rounded-xl border object-cover"
      src={url}
      title={name || undefined}
    />
  ) : (
    <span
      className="grid size-20 place-items-center rounded-xl border bg-background/60 text-[11px] text-muted-foreground"
      title={name || undefined}
    >
      图片
    </span>
  );
}

function UserMessage({
  message,
  onOpenSource,
  onEdit,
  editable,
}: {
  message: WorkspaceChat['messages'][number];
  onOpenSource: ((key: string) => void) | undefined;
  onEdit: (text: string) => void;
  editable: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  // 已发送消息的正文不含图片 token；编辑重发时按原消息把图片补回尾部，原图随新消息保留。
  const confirmEdit = () => {
    const tokens = (message.images ?? [])
      .map((image) => chatImageToken(image.id, image.name))
      .join('\n');
    const next = [text.trim(), tokens].filter(Boolean).join('\n');
    setEditing(false);
    onEdit(next);
  };
  if (editing) {
    return (
      <div className="mb-5 flex flex-col items-end">
        <textarea
          autoFocus
          className="max-h-64 w-[85%] resize-none rounded-2xl border border-ring/60 bg-card px-4 py-2.5 text-sm leading-relaxed outline-none [field-sizing:content]"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              confirmEdit();
            }
            if (event.key === 'Escape') setEditing(false);
          }}
          rows={2}
          value={text}
        />
        <div className="mt-1.5 flex items-center gap-1">
          <Button
            aria-label="取消编辑"
            className="text-muted-foreground"
            onClick={() => setEditing(false)}
            size="icon-sm"
            title="取消"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
          <Button
            aria-label="重新发送"
            className="rounded-full"
            disabled={!text.trim() && !message.images?.length}
            onClick={confirmEdit}
            size="icon-sm"
            title="重新发送"
            type="button"
          >
            <ArrowUp />
          </Button>
        </div>
        {message.images?.length ? (
          <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {message.images.map((image) => (
              <MessageImage id={image.id} key={image.id} name={image.name} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="group/user mb-5 flex flex-col items-end">
      {message.content ? (
        <div className="max-w-[85%] rounded-3xl bg-secondary px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">
          <ChatMarkdown>{message.content}</ChatMarkdown>
        </div>
      ) : null}
      {message.images?.length ? (
        <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.images.map((image) => (
            <MessageImage id={image.id} key={image.id} name={image.name} />
          ))}
        </div>
      ) : null}
      {message.attachments?.length ? (
        <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1">
          {message.attachments.map((attachment, index) => (
            <span
              className="flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
              key={`${attachment.name}:${index}`}
              title={attachment.name}
            >
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{attachment.name}</span>
            </span>
          ))}
        </div>
      ) : null}
      {message.sources?.length ? (
        <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1">
          {message.sources.map((source) =>
            onOpenSource ? (
              <button
                key={source.key}
                className="max-w-full truncate rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/10"
                onClick={() => onOpenSource(source.key)}
              >
                {source.title}
              </button>
            ) : (
              <span
                key={source.key}
                className="max-w-full truncate rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {source.title}
              </span>
            ),
          )}
        </div>
      ) : null}
      <div className="mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/user:opacity-100 group-hover/user:opacity-100">
        {message.content ? (
          <Button
            aria-label="复制消息"
            className="text-muted-foreground"
            onClick={() => {
              void navigator.clipboard.writeText(message.content);
              setCopied(true);
            }}
            size="icon-sm"
            title="复制"
            type="button"
            variant="ghost"
          >
            {copied ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
          </Button>
        ) : null}
        {editable && (
          <Button
            aria-label="编辑消息"
            className="text-muted-foreground"
            onClick={() => {
              setText(message.content);
              setEditing(true);
            }}
            size="icon-sm"
            title="编辑并重新发送"
            type="button"
            variant="ghost"
          >
            <Pencil />
          </Button>
        )}
      </div>
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
  onSaveNote: ((text: string) => void) | undefined;
  /** 容器未注入邮件草稿弹窗时为 undefined，对应入口隐藏。 */
  onOpenDraft: ((draftId: string) => void) | undefined;
}) {
  const reduced = useReducedMotion();
  // 旧会话缺少顺序信息，仅按原来的工具组 + 正文展示，不虚构中间说明。
  const parts = message.parts ?? [
    ...(message.toolResults?.length
      ? [{ type: 'tools' as const, results: message.toolResults }]
      : []),
    ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
  ];
  // 最终回答 = 尾部最后一个非空正文部分（其后只有正文）；其余全部进入工作过程区，
  // 由 WorkingSection 平铺展示并折叠——无需模型或协议显式标注。
  let answerIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!;
    if (part.type !== 'text') break;
    if (part.text) {
      answerIndex = index;
      break;
    }
  }
  const workingParts =
    answerIndex === -1 ? [...parts] : parts.filter((_, index) => index !== answerIndex);
  const hasActivity = workingParts.some(
    (part) => part.type === 'tools' || part.type === 'reasoning',
  );
  const answer = answerIndex >= 0 ? parts[answerIndex] : null;
  // 用时只在结束后计算为静态值；运行中的头部不带跳动的秒数。
  const elapsedMs =
    !live && message.startedAt !== undefined && message.finishedAt !== undefined
      ? message.finishedAt - message.startedAt
      : null;
  const failed = parts.reduce(
    (count, part) =>
      part.type === 'tools'
        ? count +
          part.results.filter(
            (result) => result.output !== undefined && !(result.output as ToolOutput)?.ok,
          ).length
        : count,
    0,
  );
  // 邮件草稿入口放在工作过程区之外：折叠时不被 inert 隐藏。
  const draftIds = [
    ...new Set(
      parts.flatMap((part) =>
        part.type === 'tools'
          ? part.results
              .filter(
                (result) =>
                  result.name === 'prepare_email' && (result.output as ToolOutput | undefined)?.ok,
              )
              .map(
                (result) =>
                  ((result.output as ToolOutput | undefined)?.result as { draftId?: string })
                    ?.draftId,
              )
          : [],
      ),
    ),
  ].filter((id): id is string => Boolean(id));

  const answerEl =
    answer?.type === 'text' && answer.text ? (
      <ChatMarkdown
        className="my-4 min-w-0 first:mt-0"
        mode="streaming"
        isAnimating={live && !activeTool}
        animated={live && !reduced ? textAnimation : false}
      >
        {answer.text}
      </ChatMarkdown>
    ) : null;

  return (
    <div className="group/msg mb-8 min-w-0 text-sm leading-7 [overflow-wrap:anywhere]">
      {!hasActivity && message.startedAt !== undefined && (
        <div className="mb-4 text-xs text-muted-foreground">
          {live ? (
            <span className={styles.shimmer} role="status">
              正在工作
            </span>
          ) : message.stopped ? (
            <span>已停止</span>
          ) : elapsedMs === null ? (
            <span>执行中断</span>
          ) : (
            <span className="tabular-nums">
              {message.interrupted ? '执行中断' : '用时'} · {formatDuration(elapsedMs)}
            </span>
          )}
        </div>
      )}
      {hasActivity ? (
        <>
          <WorkingSection
            elapsedMs={elapsedMs}
            failed={failed}
            live={live}
            autoOpen={live && answerIndex < 0}
            parts={workingParts}
            status={message.stopped ? 'stopped' : message.interrupted ? 'interrupted' : 'done'}
          />
          {onOpenDraft &&
            draftIds.map((draftId) => (
              <Button
                key={draftId}
                variant="outline"
                size="sm"
                className="mb-2 mt-0"
                onClick={() => onOpenDraft(draftId)}
              >
                <ArrowUpRight />
                检查并发送邮件
              </Button>
            ))}
          {answerEl}
        </>
      ) : (
        parts.map((part, index) =>
          part.type === 'text' && part.text ? (
            <ChatMarkdown
              key={index}
              className="my-4 min-w-0 first:mt-0"
              mode="streaming"
              isAnimating={live && !activeTool}
              animated={live && !reduced ? textAnimation : false}
            >
              {part.text}
            </ChatMarkdown>
          ) : null,
        )
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
  onEditLast,
  mailDialog,
  className,
}: {
  chat: WorkspaceChat;
  /** 点击引用来源 chip 时打开对应文档；未提供时 chip 以纯文本呈现。 */
  onOpenSource?: (key: string) => void;
  /** 把回答保存为笔记；未提供时隐藏入口。 */
  onSaveNote?: (text: string) => void;
  onEditLast?: (text: string) => void;
  /** 邮件草稿检查弹窗（容器注入，3B 接 features/mail）；未注入时隐藏草稿入口。 */
  mailDialog?: MailDraftDialog;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [draftId, setDraftId] = useState<string | null>(null);
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
    if (anchoredKey.current !== key) {
      anchoredKey.current = key;
      spacer.style.height = '0px';
      // ChatGPT 式：新回合贴底展示（用户消息下方就是流式输出），流式期间自动跟随
      // 最新内容；上滚/触摸/方向键退出跟随，「回到底部」按钮恢复跟随。
      followBottom.current = streaming;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' });
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

  // 邮件草稿弹窗由容器注入：读取草稿、账号校验、关闭守卫与发送都在注入组件内完成，
  // 本组件只负责入口与发送后的提示文案。
  const MailDialog = mailDialog;

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
                key={`${chat.sessionId}:${index}`}
                message={message}
                onOpenSource={onOpenSource}
                onEdit={(text) => onEditLast?.(text)}
                editable={index === lastUserIndex && !streaming && onEditLast !== undefined}
              />
            ) : (
              <AssistantMessage
                key={`${chat.sessionId}:${index}`}
                live={streaming && index === messages.length - 1}
                message={message}
                activeTool={chat.activeTool}
                onOpenDraft={MailDialog ? (id) => setDraftId(id) : undefined}
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
      {MailDialog && draftId && (
        <MailDialog
          draftId={draftId}
          onClose={() => setDraftId(null)}
          onSent={(warning) => {
            setDraftId(null);
            if (warning) setHint(warning);
          }}
        />
      )}
    </div>
  );
}
