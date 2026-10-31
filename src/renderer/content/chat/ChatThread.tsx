import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  CircleAlert,
  Copy,
  FileText,
  GitBranch,
  NotebookPen,
  Package,
  Pencil,
  RotateCcw,
  X,
} from 'lucide-react';
import { Shimmer } from '@/components/ui/beautifului/atoms/Shimmer';
import { useReducedMotion } from 'framer-motion';
import type { ChatComment, WorkspaceChat } from '../../../shared/api';
import { chatImageToken } from '../../../shared/chat-input';
import { Button } from '@/components/ui/button';
import { openLightbox } from '@/components/ui/lightbox';
import { IconButton } from '@/components/ui/beautifului/atoms/IconButton';
import type { MailDraftDialog } from './chat-source';
import { ReplyTrace } from './ToolTimeline';
import { ChatMarkdown } from './markdown';
import { ReplyCommentLayer } from './reply-comment';
import { ensureChatMediaPreview, getChatMediaPreview } from './media';
import { TurnChangesCard } from './TurnChangesCard';

// 使用 Streamdown 默认淡入时长与积压上限；中文按字符渐显，不额外延迟真实数据。
const textAnimation = { animation: 'fadeIn', sep: 'char' } as const;

/** 复制成功对勾的自动复位时长（消息复制按钮共用）。 */
const COPY_FEEDBACK_MS = 1500;

/** 消息悬停操作栏：复制、保存为笔记与分支，参照 assistant-ui ActionBar 的自动显隐。 */
const MessageActions = memo(function MessageActions({
  content,
  onSaveNote,
  onFork,
}: {
  content: string;
  onSaveNote: ((text: string) => void) | undefined;
  onFork: (() => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/msg:opacity-100 group-hover/msg:opacity-100">
      <IconButton
        aria-label="复制回答"
        onClick={() => {
          void navigator.clipboard.writeText(content);
          setCopied(true);
        }}
        title="复制"
      >
        {copied ? <Check className="text-green" /> : <Copy />}
      </IconButton>
      {onSaveNote && (
        <IconButton aria-label="保存为笔记" onClick={() => onSaveNote(content)} title="保存为笔记">
          <NotebookPen />
        </IconButton>
      )}
      {onFork && (
        <IconButton aria-label="从这里分支" onClick={onFork} title="从这里分支为新对话">
          <GitBranch />
        </IconButton>
      )}
    </div>
  );
});

/** 用户消息里的内联图片：会话内有缓存直接显示，历史消息按需拉取缩略图；点击放大查看。 */
const MessageImage = memo(function MessageImage({ id, name }: { id: string; name: string }) {
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
    <button
      aria-label={`放大查看 ${name || '图片'}`}
      className="cursor-zoom-in"
      onClick={() => openLightbox(url, name)}
      title={name || undefined}
      type="button"
    >
      <img
        alt={name}
        className="size-20 rounded-card border border-line border-line/60 object-cover"
        src={url}
      />
    </button>
  ) : (
    <span
      className="grid size-20 place-items-center rounded-card border border-line border-line/60 bg-inset text-2xs text-ink-3"
      title={name || undefined}
    >
      图片
    </span>
  );
});

/** 用户消息：编辑态在组件内部（key 随会话/索引变化时重置）。 */
const UserMessage = memo(function UserMessage({
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
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
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
          className="max-h-64 w-[85%] resize-none rounded-card border border-line border-line-strong bg-surface px-3.5 py-2 text-13 leading-relaxed text-ink shadow-card outline-none [field-sizing:content]"
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
          <IconButton aria-label="取消编辑" onClick={() => setEditing(false)} title="取消">
            <X />
          </IconButton>
          <Button
            aria-label="重新发送"
            className="rounded-full"
            disabled={!text.trim() && !message.images?.length}
            onClick={confirmEdit}
            size="icon-xs"
            title="重新发送"
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
      {message.comments?.length ? (
        <div className="mb-1.5 grid max-w-[85%] justify-items-end gap-1">
          {message.comments.map((comment, index) => (
            <SentComment comment={comment} key={index} />
          ))}
        </div>
      ) : null}
      {message.content ? (
        <div className="max-w-[85%] rounded-card bg-field px-3.5 py-2 text-13 leading-relaxed text-ink shadow-hairline [overflow-wrap:anywhere]">
          {/* 气泡已是容器：内部代码块去底色，避免「灰底气泡套灰底代码块」的多层嵌套。 */}
          <ChatMarkdown
            className="[&_code]:bg-transparent [&_code]:px-0 [&_pre]:bg-transparent [&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block-header]]:bg-transparent"
            mode="static"
          >
            {message.content}
          </ChatMarkdown>
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
        <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.attachments.map((attachment, index) => (
            <span
              className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-control bg-field px-2 text-xs text-ink-2 shadow-hairline"
              key={`${attachment.name}:${index}`}
              title={attachment.name}
            >
              <FileText className="size-3.5 shrink-0 text-ink-3" />
              <span className="truncate">{attachment.name}</span>
            </span>
          ))}
        </div>
      ) : null}
      {message.sources?.length ? (
        <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.sources.map((source) =>
            onOpenSource ? (
              <button
                key={source.key}
                className="h-7 max-w-full truncate rounded-control bg-field px-2 text-xs leading-7 text-ink-2 shadow-hairline transition-colors hover:bg-hover-2 hover:text-ink"
                onClick={() => onOpenSource(source.key)}
              >
                {source.title}
              </button>
            ) : (
              <span
                key={source.key}
                className="h-7 max-w-full truncate rounded-control bg-field px-2 text-xs leading-7 text-ink-2 shadow-hairline"
              >
                {source.title}
              </span>
            ),
          )}
        </div>
      ) : null}
      <div className="mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/user:opacity-100 group-hover/user:opacity-100">
        {message.content ? (
          <IconButton
            aria-label="复制消息"
            onClick={() => {
              void navigator.clipboard.writeText(message.content);
              setCopied(true);
            }}
            title="复制"
          >
            {copied ? <Check className="text-green" /> : <Copy />}
          </IconButton>
        ) : null}
        {editable && (
          <IconButton
            aria-label="编辑消息"
            onClick={() => {
              setText(message.content);
              setEditing(true);
            }}
            title="编辑并重新发送"
          >
            <Pencil />
          </IconButton>
        )}
      </div>
    </div>
  );
});

/** 已发送的回复评论：被引用的原文在上、评论在下，与正文气泡分开。 */
function SentComment({ comment }: { comment: ChatComment }) {
  return (
    <div className="grid min-w-0 max-w-full gap-0.5 rounded-card bg-inset px-3 py-1.5 text-xs leading-5 shadow-hairline [overflow-wrap:anywhere]">
      <blockquote className="line-clamp-3 whitespace-pre-wrap border-l-2 border-line-strong pl-2 text-ink-3">
        {comment.quote}
      </blockquote>
      {comment.comment && <p className="whitespace-pre-wrap text-ink-2">{comment.comment}</p>}
    </div>
  );
}

/** 整轮失败（模型/网络）：回复末尾一张错误卡，原因 + 重试。 */
function ErrorCard({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="my-3 flex items-start gap-2 rounded-card bg-red-tint px-3 py-2 text-13 leading-6 text-ink"
    >
      <CircleAlert aria-hidden className="mt-1 size-3.5 shrink-0 text-red" />
      <p className="min-w-0 flex-1 break-words">{reason}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="-my-0.5 flex h-7 shrink-0 items-center gap-1 rounded-control px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-surface hover:text-ink"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          重试
        </button>
      )}
    </div>
  );
}

/** 投影层把中断原因拼在正文末尾（「本次执行中断：…」）：拆出来给错误卡，正文不重复。 */
const INTERRUPT_PREFIX = '本次执行中断：';
function splitInterrupt(parts: NonNullable<WorkspaceChat['messages'][number]['parts']>) {
  const last = parts.at(-1);
  if (last?.type === 'text' && last.text.startsWith(INTERRUPT_PREFIX))
    return { parts: parts.slice(0, -1), reason: last.text.slice(INTERRUPT_PREFIX.length) };
  return { parts, reason: null };
}

const AssistantMessage = memo(function AssistantMessage({
  message,
  live,
  animate,
  activeTool,
  sessionId,
  reviewEnabled,
  onSaveNote,
  onFork,
  onOpenDraft,
  onRetry,
}: {
  message: WorkspaceChat['messages'][number];
  live: boolean;
  /** 挂载时回复尚未开始：只有本次视图里新产生的正文才播渐入动画。 */
  animate: boolean;
  activeTool: string | undefined;
  /** 所属会话 id；本轮改动卡片的读取与打开动作都按它路由到冻结记录与 cwd。 */
  sessionId: string | null;
  reviewEnabled: boolean;
  onSaveNote: ((text: string) => void) | undefined;
  /** 从某个会话记录条目分支；未提供或回复没有锚点时隐藏入口。 */
  onFork: ((entryId: string) => void) | undefined;
  /** 容器未注入邮件草稿弹窗时为 undefined，对应入口隐藏。 */
  onOpenDraft: ((draftId: string) => void) | undefined;
  /** 仅最后一条回复可重试。 */
  onRetry: (() => void) | undefined;
}) {
  const reduced = useReducedMotion();
  const split = splitInterrupt(message.parts ?? []);
  const parts = split.parts;
  const reason = message.interrupted ? (split.reason ?? '未知错误') : null;
  const empty = !parts.some((part) =>
    part.type === 'tools' ? part.results.length > 0 : Boolean(part.text.trim()),
  );
  const tools = parts.flatMap((part) => (part.type === 'tools' ? part.results : []));
  // `dela prepare_email` 经 bash 调用，输出里带 "draftId":"<uuid>"。
  const draftIds = [
    ...new Set(
      tools.flatMap((result) =>
        result.name === 'bash' &&
        (result.input as { command?: string } | null)?.command?.includes('prepare_email')
          ? [...(result.output?.text ?? '').matchAll(/"draftId":"([0-9a-f-]{36})"/g)].map(
              (match) => match[1]!,
            )
          : [],
      ),
    ),
  ];
  const content = reason
    ? parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n')
    : message.content;

  return (
    <div
      className="group/msg mb-8 min-w-0 text-13 leading-7 [overflow-wrap:anywhere]"
      data-reply-live={live || undefined}
    >
      {live && empty && (
        <p className="h-7 text-13 leading-7" role="status">
          <Shimmer>正在思考</Shimmer>
        </p>
      )}
      <ReplyTrace
        key={message.startedAt}
        live={live}
        parts={parts}
        startedAt={message.startedAt}
        finishedAt={message.finishedAt}
        renderText={(text) => (
          <ChatMarkdown
            mode={live ? 'streaming' : 'static'}
            isAnimating={live && !activeTool}
            animated={live && animate && !reduced ? textAnimation : false}
          >
            {text}
          </ChatMarkdown>
        )}
      />
      {reason && <ErrorCard onRetry={onRetry} reason={reason} />}
      {message.stopped && !live && <p className="my-2 text-13 text-ink-3">已停止</p>}
      {onOpenDraft &&
        draftIds.map((draftId) => (
          <Button
            key={draftId}
            variant="outline"
            className="mb-2 mt-1 [&_svg]:size-3.5"
            onClick={() => onOpenDraft(draftId)}
          >
            <ArrowUpRight />
            检查并发送邮件
          </Button>
        ))}
      {!live && sessionId && message.turnId && (
        <TurnChangesCard
          sessionId={sessionId}
          turnId={message.turnId}
          reviewEnabled={reviewEnabled}
        />
      )}
      {!live && content && (
        <MessageActions
          content={content}
          onFork={onFork && message.entryId ? () => onFork(message.entryId!) : undefined}
          onSaveNote={onSaveNote}
        />
      )}
    </div>
  );
});

/** Pi 扩展经 sendMessage 发出的可见消息：标出 customType，与模型回复区分开。 */
function ExtensionMessage({ content, customType }: { content: string; customType: string }) {
  return (
    <div className="my-3 grid gap-1.5 rounded-card bg-inset px-3.5 py-2.5">
      <span className="flex items-center gap-1.5 text-2xs font-medium text-ink-3">
        <Package aria-hidden className="size-3" strokeWidth={1.8} />
        扩展 · {customType}
      </span>
      <ChatMarkdown className="text-13" mode="static">
        {content}
      </ChatMarkdown>
    </div>
  );
}

function CompactionDivider({ pending }: { pending?: boolean }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-ink-3" role="status">
      <span className="h-px flex-1 bg-line" />
      <Archive aria-hidden className="size-3.5 shrink-0" />
      {pending ? <Shimmer>正在压缩上下文</Shimmer> : <span>上下文已自动压缩</span>}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** 对话消息流：发送后贴底展示，用户上滚时暂停跟随；工具步骤折叠展示。
 *  memo：props 全为稳定引用/原始值（草稿订阅已下沉到 ChatComposerArea），
 *  会话视图内输入区、错误提示等局部变化不带动消息列表重渲。 */
export const ChatThread = memo(function ChatThread({
  chat,
  onOpenSource,
  onSaveNote,
  onEditLast,
  onFork,
  onSidechat,
  draftKey = chat.sessionId,
  mailDialog,
}: {
  chat: WorkspaceChat;
  /** 选中回复文字后另起旁问；未提供时不显示入口。 */
  onSidechat?: (quote: string) => void;
  /** 回复评论落进的草稿键；默认是会话自己的草稿。 */
  draftKey?: string | null;
  /** 点击引用来源 chip 时打开对应文档；未提供时 chip 以纯文本呈现。 */
  onOpenSource?: (key: string) => void;
  /** 把回答保存为笔记；未提供时隐藏入口。 */
  onSaveNote?: (text: string) => void;
  onEditLast?: (text: string, comments?: ChatComment[]) => void;
  /** 从一条已完成回复分支为新会话；未提供时隐藏入口。 */
  onFork?: (entryId: string) => void;
  /** 邮件草稿检查弹窗（容器注入，3B 接 features/mail）；未注入时隐藏草稿入口。 */
  mailDialog?: MailDraftDialog;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const messages = chat.messages;
  const streaming = Boolean(chat.running);
  // 切走标签会卸载整棵消息树；挂载时已有正文的运行中回复，旧正文不再重播渐入动画。
  const [resumedReplyAt] = useState(() => {
    const last = chat.messages.at(-1);
    return chat.running && last?.role === 'assistant' && last.content.trim()
      ? last.startedAt
      : undefined;
  });

  const lastUserIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') return index;
    }
    return -1;
  }, [messages]);

  // 以一行正文高度作为到底部容差，避免固定像素阈值随字号失效；行高只读一次后缓存，
  // 内容尺寸变化（含字号设置改变引发的重排）时在 resize 中失效重算。
  const lineHeightRef = useRef(0);
  const lastScrollTop = useRef(0);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!lineHeightRef.current) {
      const style = getComputedStyle(el);
      lineHeightRef.current = parseFloat(style.lineHeight) || parseFloat(style.fontSize);
    }
    const atBottomNow = el.scrollHeight - el.scrollTop - el.clientHeight <= lineHeightRef.current;
    setAtBottom(atBottomNow);
    // 跟随只由滚动位置驱动：滚轮/触摸/键盘/滚动条的用户滚动都触发 scroll 事件——上滚
    // 退出跟随，回到容差内的底部恢复跟随；展开过程另由用户事件暂停跟随。
    if (atBottomNow) followBottom.current = true;
    else if (el.scrollTop < lastScrollTop.current) followBottom.current = false;
    lastScrollTop.current = el.scrollTop;
  }, []);

  const anchoredKey = useRef<string | null>(null);
  const replyStartedAt = messages[lastUserIndex + 1]?.startedAt;
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    // 回合身份 = 会话 + 最后一条用户消息索引 + 回复行 startedAt：editLast 按同索引
    // 整表重发时回复行重建（startedAt 更新），据此重新锚定；流式增长不动这个键。
    const key = `${chat.sessionId}:${lastUserIndex}:${replyStartedAt ?? ''}`;
    if (anchoredKey.current !== key) {
      anchoredKey.current = key;
      // ChatGPT 式：新回合贴底展示（用户消息下方就是流式输出），流式期间自动跟随
      // 最新内容；用户上滚即退出跟随（见 onScroll），回到底部或点按钮恢复。
      followBottom.current = streaming;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' });
    }
    const resize = () => {
      // 字号可能已变：行高缓存失效，本次随 onScroll 重新计算。
      lineHeightRef.current = 0;
      // 只跟随实际消息底部，不根据滚动位置改变被观察内容的高度。
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
  }, [chat.sessionId, lastUserIndex, replyStartedAt, streaming, onScroll]);

  // 邮件草稿弹窗由容器注入：读取草稿、账号校验、关闭守卫与发送都在注入组件内完成，
  // 本组件只负责入口与发送后的提示文案。
  const MailDialog = mailDialog;
  // 消息组件 memo 后回调必须稳定，弹窗/编辑入口的局部状态才不带动消息列表重渲。
  const openDraft = useCallback((id: string) => setDraftId(id), []);
  const handleEditLast = useCallback((text: string) => onEditLast?.(text), [onEditLast]);
  // 重试＝以最后一条用户消息原文重发（编辑重发同一路径，Pi 会话树保留失败分支）。
  const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
  const retry = useMemo(() => {
    if (!onEditLast || !lastUser) return undefined;
    const tokens = (lastUser.images ?? []).map((image) => chatImageToken(image.id, image.name));
    const text = [lastUser.content, ...tokens].filter(Boolean).join('\n');
    return () => onEditLast(text, lastUser.comments);
  }, [lastUser, onEditLast]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="size-full overflow-y-auto [overflow-anchor:none]"
        aria-label="对话消息"
        onScroll={onScroll}
        // 展开过程细节时暂停贴底：内容变高不应把用户正在看的那一行推走。
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('[data-trace-toggle]'))
            followBottom.current = false;
        }}
      >
        <div ref={contentRef} className="relative mx-auto w-full max-w-3xl px-4 py-4">
          {/* 消息无稳定 id，key 用 sessionId:index：依赖列表 append-only（editLast 截断重发按同索引整表替换），勿在中间插入/删除。 */}
          {messages.map((message, index) =>
            message.compacted ? (
              <CompactionDivider key={`${chat.sessionId}:${index}`} />
            ) : message.extension ? (
              <ExtensionMessage
                content={message.content}
                customType={message.extension.customType}
                key={`${chat.sessionId}:${index}`}
              />
            ) : message.role === 'user' ? (
              <UserMessage
                key={`${chat.sessionId}:${index}`}
                message={message}
                onOpenSource={onOpenSource}
                onEdit={handleEditLast}
                editable={index === lastUserIndex && !streaming && onEditLast !== undefined}
              />
            ) : (
              <AssistantMessage
                key={`${chat.sessionId}:${index}`}
                sessionId={chat.sessionId}
                reviewEnabled={chat.projectId != null}
                onRetry={index === messages.length - 1 && !streaming ? retry : undefined}
                live={streaming && index === messages.length - 1}
                animate={message.startedAt !== resumedReplyAt}
                message={message}
                activeTool={chat.activeTool}
                onOpenDraft={MailDialog ? openDraft : undefined}
                onSaveNote={onSaveNote}
                onFork={streaming ? undefined : onFork}
              />
            ),
          )}
          {chat.compacting && <CompactionDivider pending />}
        </div>
      </div>
      {!atBottom && messages.length > 0 && (
        <button
          aria-label="回到底部"
          className="absolute bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-raised transition-colors hover:bg-hover-2 hover:text-ink"
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
      {draftKey && (
        <ReplyCommentLayer draftKey={draftKey} onSidechat={onSidechat} scrollRef={scrollRef} />
      )}
      {hint && (
        <p role="status" className="absolute inset-x-0 bottom-0 px-4 pb-2 text-xs text-ink-3">
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
});
