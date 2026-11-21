'use client';

import type { ComponentProps, ReactNode } from 'react';
import { ArrowUp, Check, CircleAlert, Settings, Square, X } from 'lucide-react';
import { Button } from '../button';
import { cn } from '../lib/cn';
import { Chip } from './chip';

const MENU_ROW_UNITS = 9;
const scrollRowIntoView = (node: HTMLLIElement | null) =>
  node?.scrollIntoView({ block: 'nearest' });

function PromptInput({
  dragging = false,
  dropHint,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { dragging?: boolean; dropHint: string }) {
  return (
    <div
      className={cn(
        '@container relative rounded-window bg-surface shadow-card transition-shadow duration-base focus-within:ring-1 focus-within:ring-line-strong',
        className,
      )}
      data-slot="prompt-input"
      {...props}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-window border-2 border-dashed border-line-strong bg-page/80 text-sm text-ink-3">
          {dropHint}
        </div>
      )}
      {children}
    </div>
  );
}

function PromptInputAttachments({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid gap-1.5 px-3 pt-3', className)}
      data-slot="prompt-input-attachments"
      {...props}
    />
  );
}

function PromptInputChip({
  icon,
  label,
  detail,
  onRemove,
  removeLabel,
  className,
  ...props
}: Omit<ComponentProps<typeof Chip>, 'children'> & {
  icon: ReactNode;
  label: string;
  detail?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <Chip
      className={cn(
        'animate-pop-in gap-1.5 pr-0.5 pl-2 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-ink-3',
        className,
      )}
      data-slot="prompt-input-chip"
      title={label}
      {...props}
    >
      {icon}
      <span className="truncate">{label}</span>
      {detail && <span className="shrink-0 text-ink-3">{detail}</span>}
      <Button variant="ghost" size="icon-xs" aria-label={removeLabel} onClick={onRemove}>
        <X strokeWidth={2.2} />
      </Button>
    </Chip>
  );
}

function PromptInputToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2.5 pb-2.5 pt-1 @max-[160px]:gap-0.5 @max-[160px]:px-1.5',
        className,
      )}
      data-slot="prompt-input-toolbar"
      {...props}
    />
  );
}

function PromptInputTrigger({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'flex h-7 min-w-0 shrink items-center gap-1 rounded-control px-1.5 text-xs font-medium text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink',
        className,
      )}
      data-slot="prompt-input-trigger"
      type="button"
      {...props}
    />
  );
}

function PromptInputSubmit({
  stoppable,
  sendable,
  sendTitle,
  onSend,
  onStop,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'onClick' | 'title' | 'disabled' | 'children'> & {
  stoppable: boolean;
  sendable: boolean;
  sendTitle: string;
  onSend: () => void;
  onStop: () => void;
}) {
  if (stoppable)
    return (
      <Button
        aria-label="停止执行"
        className={className}
        data-slot="prompt-input-submit"
        onClick={onStop}
        size="icon-sm"
        title="停止执行"
        {...props}
      >
        <Square className="size-3 fill-current" />
      </Button>
    );
  return (
    <button
      aria-label="发送"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-control transition-[background-color,color,transform] duration-slow enabled:active:scale-94',
        sendable ? 'bg-ink text-surface' : 'bg-line-strong text-ink-2',
        className,
      )}
      data-slot="prompt-input-submit"
      disabled={!sendable}
      onClick={onSend}
      title={sendTitle}
      type="button"
      {...props}
    >
      <ArrowUp className="size-4" strokeWidth={2.4} />
    </button>
  );
}

function PromptInputMenu({
  activeIndex,
  itemCount,
  className,
  children,
  ...props
}: ComponentProps<'ul'> & { activeIndex: number; itemCount: number }) {
  return (
    <ul
      // 只保留 absolute：与 relative 同写时生成 CSS 谁生效不确定，实测会掉回文档流。
      className={cn(
        'absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full min-w-56 overflow-auto rounded-card bg-surface p-1 shadow-raised @max-[260px]:min-w-0',
        className,
      )}
      data-slot="prompt-input-menu"
      role="listbox"
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 rounded-chip bg-hover"
        style={{
          top: `calc(var(--spacing) * ${activeIndex * MENU_ROW_UNITS + 1})`,
          height: `calc(var(--spacing) * ${MENU_ROW_UNITS})`,
          opacity: activeIndex < itemCount ? 1 : 0,
          transition:
            'top 220ms var(--ease-out-strong), height 220ms var(--ease-out-strong), opacity 150ms ease',
        }}
      />
      {children}
    </ul>
  );
}

function PromptInputMenuItem({
  id,
  selected,
  icon,
  onHover,
  onSelect,
  children,
  className,
  ...props
}: Omit<ComponentProps<'li'>, 'onSelect'> & {
  id: string;
  selected: boolean;
  icon: ReactNode;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <li
      aria-selected={selected}
      className={cn(
        'relative z-10 flex h-9 w-full items-center gap-2.5 rounded-chip px-2 text-left',
        className,
      )}
      data-slot="prompt-input-menu-item"
      id={id}
      onClick={onSelect}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      ref={selected ? scrollRowIntoView : undefined}
      role="option"
      {...props}
    >
      {icon}
      {children}
    </li>
  );
}

function PromptInputNotice({
  message,
  onDismiss,
  className,
  ...props
}: ComponentProps<'div'> & {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-full z-10 mb-2 animate-pop-in rounded-card bg-surface shadow-hairline',
        className,
      )}
      data-slot="prompt-input-notice"
      role="alert"
      {...props}
    >
      <div className="flex items-start gap-2 rounded-card bg-danger-tint px-3 py-1.5 text-sm leading-6 text-ink">
        <CircleAlert aria-hidden className="mt-1 size-3.5 shrink-0 text-danger" />
        <p className="min-w-0 flex-1 break-words">{message}</p>
        {onDismiss && (
          <Button
            aria-label="关闭提示"
            className="-mr-1 hover:bg-surface"
            onClick={onDismiss}
            size="icon-xs"
            variant="ghost"
          >
            <X className="size-3" strokeWidth={2.2} />
          </Button>
        )}
      </div>
    </div>
  );
}

function PromptInputOptionList({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul className={className} data-slot="prompt-input-option-list" role="radiogroup" {...props} />
  );
}

function PromptInputOption({
  active,
  className,
  ...props
}: ComponentProps<'button'> & { active: boolean }) {
  return (
    <li role="none">
      <button
        aria-checked={active}
        className={cn(
          'flex h-8 w-full items-center gap-1 rounded-chip px-2 text-left text-sm transition-colors',
          active ? 'bg-hover font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
          className,
        )}
        data-slot="prompt-input-option"
        role="radio"
        type="button"
        {...props}
      />
    </li>
  );
}

function PromptInputOptionCheck({ className, ...props }: ComponentProps<typeof Check>) {
  return (
    <Check
      className={cn('ms-auto size-3 shrink-0 text-ink', className)}
      data-slot="prompt-input-option-check"
      strokeWidth={2.5}
      {...props}
    />
  );
}

function PromptInputSetup({
  message,
  actionLabel,
  onAction,
  className,
  ...props
}: ComponentProps<'div'> & {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      className={cn('grid gap-2 px-1.5 py-2', className)}
      data-slot="prompt-input-setup"
      {...props}
    >
      <p className="text-xs text-ink-3">{message}</p>
      <Button
        className="w-full justify-start [&_svg]:size-3.5"
        onClick={onAction}
        size="sm"
        variant="outline"
      >
        <Settings />
        {actionLabel}
      </Button>
    </div>
  );
}

export {
  PromptInput,
  PromptInputAttachments,
  PromptInputChip,
  PromptInputMenu,
  PromptInputMenuItem,
  PromptInputNotice,
  PromptInputOption,
  PromptInputOptionCheck,
  PromptInputOptionList,
  PromptInputSetup,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTrigger,
};
