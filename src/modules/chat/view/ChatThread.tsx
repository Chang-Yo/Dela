import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUpRight,
  Bot,
  FileText,
  GitBranch,
  MessageSquare,
  NotebookPen,
  Pencil,
  SquareTerminal,
} from 'lucide-react';
import {
  AssistantMessage as AssistantMessageFrame,
  CompactionDivider,
  CopyAction,
  ErrorCard,
  ExtensionMessage,
  MessageActions,
  MessageChip,
  MessageChips,
  MessageComments,
  UserBubble,
  UserMessage as UserMessageFrame,
  UserMessageEditor,
} from '../../../ui/agent/message';
import { TaskNotice } from '../../../ui/agent/task';
import { Shimmer } from '../../../ui/shimmer';
import type { ChatComment, TaskNoticeDetails, WorkspaceChat } from '../../../core/protocol/agent';
import { chatImageToken } from '../../../core/protocol/chat-input';
import { Button } from '../../../ui/button';
import { openLightbox } from '../../../ui/lightbox';
import { IconButton } from '../../../ui/icon-button';
import { useMediaQuery } from '../../../ui/hooks/use-media-query';
import { useChatTabSource, type MailDraftDialog } from './chat-source';
import { formatDuration, ReplyTrace } from './ToolTimeline';
import { openSubagent } from './tool-views';
import { ChatMarkdown } from './markdown';
import { ReplyCommentLayer } from './reply-comment';
import { fetchChatMediaPreview, getChatMediaPreview } from './media';
import { TurnChangesCard } from './TurnChangesCard';

const textAnimation = { animation: 'fadeIn', sep: 'char' } as const;

function MessageImage({ id, name }: { id: string; name: string }) {
  const { data: url } = useQuery({
    queryKey: ['chat', 'media', id],
    queryFn: () => fetchChatMediaPreview(id),
    initialData: getChatMediaPreview(id),
    staleTime: Infinity,
  });
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
      className="grid size-20 place-items-center rounded-card border border-line border-line/60 bg-inset text-xs text-ink-3"
      title={name || undefined}
    >
      图片
    </span>
  );
}

/** 用户消息：编辑态在组件内部（key 随会话/索引变化时重置）。 */
function UserMessage({
  message,
  onOpenSource,
  onOpenSession,
  onEdit,
  editable,
}: {
  message: WorkspaceChat['messages'][number];
  onOpenSource: ((key: string) => void) | undefined;
  onOpenSession: ((id: string) => void) | undefined;
  onEdit: (text: string) => void;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  // 已发送消息的正文不含图片 token；编辑重发时按原消息把图片补回尾部，原图随新消息保留。
  const confirmEdit = () => {
    const tokens = (message.images ?? [])
      .map((image) => chatImageToken(image.id, image.name))
      .join('\n');
    const next = [text.trim(), tokens].filter(Boolean).join('\n');
    setEditing(false);
    onEdit(next);
  };
  const images = message.images?.length ? (
    <MessageChips>
      {message.images.map((image) => (
        <MessageImage id={image.id} key={image.id} name={image.name} />
      ))}
    </MessageChips>
  ) : null;
  if (editing) {
    return (
      <UserMessageEditor
        onCancel={() => setEditing(false)}
        onChange={setText}
        onSubmit={confirmEdit}
        submitDisabled={!text.trim() && !message.images?.length}
        value={text}
      >
        {images}
      </UserMessageEditor>
    );
  }
  return (
    <UserMessageFrame>
      {message.comments?.length ? <MessageComments comments={message.comments} /> : null}
      {message.content ? (
        <UserBubble>
          <ChatMarkdown
            className="[&_code]:bg-transparent [&_code]:px-0 [&_pre]:bg-transparent [&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block-header]]:bg-transparent"
            mode="static"
          >
            {message.content}
          </ChatMarkdown>
        </UserBubble>
      ) : null}
      {images}
      {message.attachments?.length ? (
        <MessageChips>
          {message.attachments.map((attachment, index) => (
            <MessageChip
              icon={<FileText className="size-3.5 shrink-0 text-ink-3" />}
              key={`${attachment.name}:${index}`}
              title={attachment.name}
            >
              {attachment.name}
            </MessageChip>
          ))}
        </MessageChips>
      ) : null}
      {message.sources?.length ? (
        <MessageChips>
          {message.sources.map((source) => (
            <MessageChip
              key={source.key}
              onClick={onOpenSource && (() => onOpenSource(source.key))}
            >
              {source.title}
            </MessageChip>
          ))}
        </MessageChips>
      ) : null}
      {message.sessions?.length ? (
        <MessageChips>
          {message.sessions.map((session) => (
            <MessageChip
              icon={<MessageSquare className="size-3.5 shrink-0 text-ink-3" />}
              key={session.id}
              onClick={onOpenSession && (() => onOpenSession(session.id))}
              title={session.title}
            >
              {session.title}
            </MessageChip>
          ))}
        </MessageChips>
      ) : null}
      <MessageActions>
        {message.content ? <CopyAction label="复制消息" text={message.content} /> : null}
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
      </MessageActions>
    </UserMessageFrame>
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

function AssistantMessage({
  message,
  live,
  turnEnd,
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
  /** 本轮（turnId）的最后一段回复：改动卡片只挂在这里。 */
  turnEnd: boolean;
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
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
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
    <AssistantMessageFrame data-reply-live={live || undefined}>
      {live && empty && (
        <p className="h-7 text-sm leading-7" role="status">
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
      {message.stopped && !live && <p className="my-2 text-sm text-ink-3">已停止</p>}
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
      {!live && turnEnd && sessionId && message.turnId && (
        <TurnChangesCard
          sessionId={sessionId}
          turnId={message.turnId}
          reviewEnabled={reviewEnabled}
        />
      )}
      {!live && content && (
        <MessageActions className="mt-1">
          <CopyAction label="复制回答" text={content} />
          {onSaveNote && (
            <IconButton
              aria-label="保存为笔记"
              onClick={() => onSaveNote(content)}
              title="保存为笔记"
            >
              <NotebookPen />
            </IconButton>
          )}
          {onFork && message.entryId && (
            <IconButton
              aria-label="从这里分支"
              onClick={() => onFork(message.entryId!)}
              title="从这里分支为新对话"
            >
              <GitBranch />
            </IconButton>
          )}
        </MessageActions>
      )}
    </AssistantMessageFrame>
  );
}

const TASK_STATUS: Record<TaskNoticeDetails['status'], string> = {
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
};

function TaskNoticeMessage({ content, task }: { content: string; task: TaskNoticeDetails }) {
  const { navigate } = useChatTabSource();
  return (
    <TaskNotice
      duration={formatDuration(task.durationMs)}
      failed={task.status === 'failed'}
      icon={task.kind === 'bash' ? SquareTerminal : Bot}
      label={task.label}
      onOpenSession={
        task.kind === 'subagent' ? () => void openSubagent(task.taskId, navigate) : undefined
      }
      title={`后台任务${TASK_STATUS[task.status]}${
        task.exitCode !== undefined && task.status === 'failed' ? `（退出码 ${task.exitCode}）` : ''
      }`}
    >
      <ChatMarkdown className="pt-1.5 text-sm" mode="static">
        {content}
      </ChatMarkdown>
    </TaskNotice>
  );
}

export function ChatThread({
  chat,
  onOpenSource,
  onOpenSession,
  onSaveNote,
  onEditLast,
  onFork,
  onSidechat,
  draftKey,
  mailDialog,
}: {
  chat: WorkspaceChat;
  /** 选中回复文字后另起旁问；未提供时不显示入口。 */
  onSidechat?: (quote: string) => void;
  /** 回复评论落进的草稿键；默认是会话自己的草稿。 */
  draftKey?: string | null;
  /** 点击引用来源 chip 时打开对应文档；未提供时 chip 以纯文本呈现。 */
  onOpenSource?: (key: string) => void;
  /** 点击 # 引用的会话 chip 时打开该会话；未提供时 chip 不可点。 */
  onOpenSession?: (id: string) => void;
  /** 把回答保存为笔记；未提供时隐藏入口。 */
  onSaveNote?: (text: string) => void;
  onEditLast?: (text: string, comments?: ChatComment[]) => void;
  /** 从一条已完成回复分支为新会话；未提供时隐藏入口。 */
  onFork?: (entryId: string) => void;
  /** 邮件草稿检查弹窗（容器注入）；未注入时隐藏草稿入口。 */
  mailDialog?: MailDraftDialog;
}) {
  const replyDraftKey = draftKey === undefined ? chat.sessionId : draftKey;
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

  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');

  // 插队把一轮切成多段回复，它们共用 turnId；本轮改动卡片只挂在最后一段。
  const turnEnds = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.turnId) turnEnds.set(message.turnId, index);
  });

  // 以一行正文高度作为到底部容差，避免固定像素阈值随字号失效；行高只读一次后缓存，
  // 内容尺寸变化（含字号设置改变引发的重排）时在 resize 中失效重算。
  const lineHeightRef = useRef(0);
  const lastScrollTop = useRef(0);
  const onScroll = () => {
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
  };
  const syncScroll = useEffectEvent(onScroll);

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
      // 新回合贴底，流式期间自动跟随；用户上滚退出跟随（见 onScroll），回到底部或点按钮恢复。
      followBottom.current = streaming;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' });
    }
    const resize = () => {
      lineHeightRef.current = 0;
      if (followBottom.current) viewport.scrollTop = viewport.scrollHeight;
      syncScroll();
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
  }, [chat.sessionId, lastUserIndex, replyStartedAt, streaming]);

  const MailDialog = mailDialog;
  const handleEditLast = (text: string) => onEditLast?.(text);
  // 重试＝以最后一条用户消息原文重发（编辑重发同一路径，Pi 会话树保留失败分支）。
  const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
  const retry =
    onEditLast && lastUser
      ? () => {
          const tokens = (lastUser.images ?? []).map((image) =>
            chatImageToken(image.id, image.name),
          );
          onEditLast([lastUser.content, ...tokens].filter(Boolean).join('\n'), lastUser.comments);
        }
      : undefined;

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
            ) : message.task ? (
              <TaskNoticeMessage
                content={message.content}
                key={`${chat.sessionId}:${index}`}
                task={message.task}
              />
            ) : message.extension ? (
              <ExtensionMessage
                customType={message.extension.customType}
                key={`${chat.sessionId}:${index}`}
              >
                <ChatMarkdown className="text-sm" mode="static">
                  {message.content}
                </ChatMarkdown>
              </ExtensionMessage>
            ) : message.role === 'user' ? (
              <UserMessage
                key={`${chat.sessionId}:${index}`}
                message={message}
                onOpenSource={onOpenSource}
                onOpenSession={onOpenSession}
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
                turnEnd={message.turnId !== undefined && turnEnds.get(message.turnId) === index}
                animate={message.startedAt !== resumedReplyAt}
                message={message}
                activeTool={chat.activeTool}
                onOpenDraft={MailDialog ? setDraftId : undefined}
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
          className="absolute bottom-3 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-raised transition-colors hover:bg-hover-strong hover:text-ink"
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
      {replyDraftKey && (
        <ReplyCommentLayer draftKey={replyDraftKey} onSidechat={onSidechat} scrollRef={scrollRef} />
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
}
