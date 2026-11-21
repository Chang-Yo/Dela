'use client';

import { useState, type ComponentProps } from 'react';
import { Check } from 'lucide-react';
import { Button } from '../button';
import { cn } from '../lib/cn';

// 聚焦不滚动消息视口；改评论时光标放在原文末尾。引用不变，所以只在挂载时执行。
const focusAtEnd = (field: HTMLTextAreaElement | null) => {
  if (!field) return;
  field.focus({ preventScroll: true });
  field.setSelectionRange(field.value.length, field.value.length);
};

function CommentInput({
  initial = '',
  onSubmit,
  onCancel,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'onSubmit'> & {
  initial?: string;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = () => onSubmit(text.trim());
  return (
    <div className={cn('flex items-end gap-1', className)} data-slot="comment-input" {...props}>
      <textarea
        aria-label="评论"
        className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-5 text-ink outline-none field-sizing-content placeholder:text-ink-3"
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
      <Button aria-label="确认" onClick={submit} size="icon-sm" title="确认">
        <Check strokeWidth={2.4} />
      </Button>
    </div>
  );
}

export { CommentInput };
