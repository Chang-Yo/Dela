'use client';

import { useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { Check, TextQuote, X } from 'lucide-react';
import { cn } from '../cn';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../hover-card';
import { IconButton } from '../icon-button';
import { Popover, PopoverAnchor, PopoverContent } from '../popover';

export type CommentItem = { quote: string; comment: string };

const quoteBlock = 'whitespace-pre-wrap break-words border-l-2 border-line-strong pl-2 text-ink-3';

// 聚焦不滚动消息视口；改评论时光标放在原文末尾。引用不变，所以只在挂载时执行。
const focusAtEnd = (field: HTMLTextAreaElement | null) => {
  if (!field) return;
  field.focus({ preventScroll: true });
  field.setSelectionRange(field.value.length, field.value.length);
};

export function CommentInput({
  initial = '',
  onSubmit,
  onCancel,
}: {
  initial?: string;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = () => onSubmit(text.trim());
  return (
    <div className="flex items-end gap-1">
      <textarea
        aria-label="评论"
        className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-5 text-ink outline-none [field-sizing:content] placeholder:text-ink-3"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder="添加评论…"
        ref={focusAtEnd}
        rows={1}
        value={text}
      />
      <button
        aria-label="确认"
        className="flex size-7 shrink-0 items-center justify-center rounded-control bg-ink text-surface transition-transform duration-base active:scale-[0.94]"
        onClick={submit}
        title="确认"
        type="button"
      >
        <Check className="size-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}

export function CommentFloat({
  editing,
  ref,
  children,
}: {
  editing: boolean;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'absolute z-20 rounded-card bg-surface shadow-raised animate-pop-in',
        editing ? 'w-80 max-w-[calc(100%-1rem)] p-1' : 'w-max p-0.5',
      )}
      ref={ref}
    >
      {children}
    </div>
  );
}

export function CommentFloatAction(props: ComponentProps<'button'>) {
  return (
    <button
      className="flex h-7 select-none items-center gap-1.5 whitespace-nowrap rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-fast hover:bg-hover hover:text-ink [&_svg]:size-3.5"
      // 不抢焦点、不清选区：点下去之前选中的文字保持原样。
      onPointerDown={(event) => event.preventDefault()}
      type="button"
      {...props}
    />
  );
}

export function CommentRail({ children }: { children: ReactNode }) {
  return (
    // 评论数量不设上限：超过三行在轨道内滚动。
    <div className="-m-px flex max-h-24 flex-wrap gap-1.5 overflow-y-auto p-px">{children}</div>
  );
}

export function CommentChip({
  item,
  onSave,
  onRemove,
}: {
  item: CommentItem;
  onSave: (comment: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [peek, setPeek] = useState(false);
  return (
    <Popover onOpenChange={setEditing} open={editing}>
      <HoverCard closeDelay={100} onOpenChange={setPeek} open={peek && !editing} openDelay={300}>
        <PopoverAnchor asChild>
          <HoverCardTrigger asChild>
            <span
              className="flex h-7 min-w-0 max-w-64 items-center rounded-control bg-field pr-0.5 text-xs text-ink-2 shadow-hairline"
              style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}
            >
              <button
                aria-label="编辑评论"
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 pl-2 text-left"
                onClick={() => setEditing(true)}
                type="button"
              >
                <TextQuote aria-hidden className="size-3.5 shrink-0 text-ink-3" />
                {item.comment && <span className="max-w-24 truncate text-ink-3">{item.quote}</span>}
                <span className="truncate">{item.comment || item.quote}</span>
              </button>
              <IconButton aria-label="移除评论" onClick={onRemove} size="sm">
                <X strokeWidth={2.2} />
              </IconButton>
            </span>
          </HoverCardTrigger>
        </PopoverAnchor>
        <HoverCardContent align="start" className="max-h-80 w-72 gap-2 leading-5" side="top">
          <blockquote className={cn(quoteBlock, 'line-clamp-6')}>{item.quote}</blockquote>
          {item.comment && (
            <p className="whitespace-pre-wrap break-words text-ink">{item.comment}</p>
          )}
        </HoverCardContent>
      </HoverCard>
      <PopoverContent
        align="start"
        className="grid w-80 gap-1.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={6}
      >
        <blockquote className={cn(quoteBlock, 'mx-2 mt-1.5 line-clamp-3 text-xs leading-5')}>
          {item.quote}
        </blockquote>
        <CommentInput
          initial={item.comment}
          onCancel={() => setEditing(false)}
          onSubmit={(comment) => {
            onSave(comment);
            setEditing(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
