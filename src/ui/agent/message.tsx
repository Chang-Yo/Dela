'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { ArrowUp, Archive, Check, CircleAlert, Copy, Package, RotateCcw, X } from 'lucide-react';
import { Button } from '../button';
import { Card } from '../card';
import { cn } from '../lib/cn';
import { IconButton } from '../icon-button';
import { Shimmer } from '../shimmer';

const COPY_FEEDBACK_MS = 1500;

/** 用户消息：右对齐，操作栏悬停时出现。 */
export function UserMessage({ children }: { children: ReactNode }) {
  return <div className="group/message mb-5 flex flex-col items-end">{children}</div>;
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[85%] rounded-card bg-field px-3.5 py-2 text-sm leading-relaxed text-ink shadow-hairline [overflow-wrap:anywhere]">
      {children}
    </div>
  );
}

/** 用户消息气泡下方的一行附件、引用或会话 chip。 */
export function MessageChips({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">{children}</div>;
}

export function MessageChip({
  icon,
  title,
  onClick,
  children,
}: {
  icon?: ReactNode;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className =
    'flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-control bg-field px-2 text-xs text-ink-2 shadow-hairline';
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return onClick ? (
    <button
      className={cn(className, 'transition-colors hover:bg-hover-strong hover:text-ink')}
      onClick={onClick}
      title={title}
      type="button"
    >
      {content}
    </button>
  ) : (
    <span className={className} title={title}>
      {content}
    </span>
  );
}

/** 用户消息附带的回复评论：被评论的引文加上评论正文。 */
export function MessageComments({ comments }: { comments: { quote: string; comment?: string }[] }) {
  return (
    <div className="mb-1.5 grid max-w-[85%] justify-items-end gap-1">
      {comments.map(({ quote, comment }, index) => (
        <div
          className="grid min-w-0 max-w-full gap-0.5 rounded-card bg-inset px-3 py-1.5 text-xs leading-5 shadow-hairline [overflow-wrap:anywhere]"
          key={index}
        >
          <blockquote className="line-clamp-3 whitespace-pre-wrap border-l-2 border-line-strong pl-2 text-ink-3">
            {quote}
          </blockquote>
          {comment && <p className="whitespace-pre-wrap text-ink-2">{comment}</p>}
        </div>
      ))}
    </div>
  );
}

/** 用户消息的编辑态：回车提交、Esc 取消；children 放原消息的图片。 */
export function UserMessageEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitDisabled,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitDisabled: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col items-end">
      <textarea
        autoFocus
        className="max-h-64 w-[85%] resize-none rounded-card border border-line border-line-strong bg-surface px-3.5 py-2 text-sm leading-relaxed text-ink shadow-card outline-none [field-sizing:content]"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === 'Escape') onCancel();
        }}
        rows={2}
        value={value}
      />
      <div className="mt-1.5 flex items-center gap-1">
        <IconButton aria-label="取消编辑" onClick={onCancel} title="取消">
          <X />
        </IconButton>
        <Button
          aria-label="重新发送"
          className="rounded-full"
          disabled={submitDisabled}
          onClick={onSubmit}
          size="icon-xs"
          title="重新发送"
        >
          <ArrowUp />
        </Button>
      </div>
      {children}
    </div>
  );
}

/** 助手消息容器：同时是操作栏悬停出现的分组。 */
export function AssistantMessage({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'group/message mb-8 min-w-0 text-sm leading-7 [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  );
}

/** 消息操作栏：位于 UserMessage 或 AssistantMessage 内，悬停或聚焦时出现。 */
export function MessageActions({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CopyAction({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      }}
      title="复制"
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </IconButton>
  );
}

export function ErrorCard({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="my-3 flex items-start gap-2 rounded-card bg-danger-tint px-3 py-2 text-sm leading-6 text-ink"
    >
      <CircleAlert aria-hidden className="mt-1 size-3.5 shrink-0 text-danger" />
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

/** 扩展注入的消息：标明来源类型，正文由 children 渲染。 */
export function ExtensionMessage({
  customType,
  children,
}: {
  customType: string;
  children: ReactNode;
}) {
  return (
    <Card className="my-3 grid gap-1.5" variant="inset">
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
        <Package aria-hidden className="size-3" strokeWidth={1.8} />
        扩展 · {customType}
      </span>
      {children}
    </Card>
  );
}

export function CompactionDivider({ pending = false }: { pending?: boolean }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-ink-3" role="status">
      <span className="h-px flex-1 bg-line" />
      <Archive aria-hidden className="size-3.5 shrink-0" />
      {pending ? <Shimmer>正在压缩上下文</Shimmer> : <span>上下文已自动压缩</span>}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
