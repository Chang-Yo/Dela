import type { ComponentProps, ReactNode } from 'react';
import { ArrowUp, X } from 'lucide-react';
import { Button } from '../button';
import { cn } from '../lib/cn';

/** 用户消息的编辑态：回车提交、Esc 取消；children 放原消息的图片。 */
function UserMessageEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitDisabled,
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'onChange' | 'onSubmit'> & {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitDisabled: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn('mb-5 flex flex-col items-end', className)}
      data-slot="user-message-editor"
      {...props}
    >
      <textarea
        autoFocus
        className="max-h-64 w-[85%] resize-none rounded-card border border-line border-line-strong bg-surface px-3.5 py-2 text-sm leading-relaxed text-ink shadow-card outline-none field-sizing-content"
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="取消编辑"
          onClick={onCancel}
          title="取消"
        >
          <X />
        </Button>
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

export { UserMessageEditor };
