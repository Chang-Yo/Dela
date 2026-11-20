'use client';

import type { ComponentProps, ReactNode } from 'react';
import { ArrowUp, Check, CircleAlert, Settings, Square, X } from 'lucide-react';
import { Button } from '../button';
import { cn } from '../lib/cn';
import { IconButton } from '../icon-button';

const MENU_ROW_UNITS = 9;
const scrollRowIntoView = (node: HTMLLIElement | null) =>
  node?.scrollIntoView({ block: 'nearest' });

export function PromptInput({
  dragging = false,
  dropHint,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { dragging?: boolean; dropHint: string }) {
  return (
    <div
      className={cn(
        '@container relative rounded-window border border-line bg-surface shadow-card transition-colors duration-base focus-within:border-line-strong',
        dragging && 'border-transparent',
        className,
      )}
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

export function PromptInputAttachments({ children }: { children: ReactNode }) {
  return <div className="grid gap-1.5 px-3 pt-3">{children}</div>;
}

export function PromptInputChip({
  icon,
  label,
  detail,
  onRemove,
  removeLabel,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span
      className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-control bg-field pr-0.5 pl-2 text-xs text-ink-2 shadow-hairline [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-ink-3"
      style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
      {detail && <span className="shrink-0 text-ink-3">{detail}</span>}
      <IconButton aria-label={removeLabel} onClick={onRemove} size="sm">
        <X strokeWidth={2.2} />
      </IconButton>
    </span>
  );
}

export function PromptInputToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1 @max-[160px]:gap-0.5 @max-[160px]:px-1.5">
      {children}
    </div>
  );
}

export function PromptInputTrigger({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'flex h-7 min-w-0 shrink items-center gap-1 rounded-control px-1.5 text-xs font-medium text-ink-2 transition-colors duration-base hover:bg-hover hover:text-ink',
        className,
      )}
      type="button"
      {...props}
    />
  );
}

export function PromptInputSubmit({
  stoppable,
  sendable,
  sendTitle,
  onSend,
  onStop,
}: {
  stoppable: boolean;
  sendable: boolean;
  sendTitle: string;
  onSend: () => void;
  onStop: () => void;
}) {
  if (stoppable)
    return (
      <button
        aria-label="停止执行"
        className="flex size-7 shrink-0 items-center justify-center rounded-control bg-ink text-surface transition-opacity duration-base hover:opacity-90 active:scale-[0.94]"
        onClick={onStop}
        title="停止执行"
        type="button"
      >
        <Square className="size-3 fill-current" />
      </button>
    );
  return (
    <button
      aria-label="发送"
      className="flex size-7 shrink-0 items-center justify-center rounded-control transition-[background-color,color,transform] duration-slow enabled:active:scale-[0.94]"
      disabled={!sendable}
      onClick={onSend}
      style={{
        background: sendable ? 'var(--ink)' : 'var(--line-strong)',
        color: sendable ? 'var(--surface)' : 'var(--ink-2)',
      }}
      title={sendTitle}
      type="button"
    >
      <ArrowUp className="size-4" strokeWidth={2.4} />
    </button>
  );
}

export function PromptInputMenu({
  activeIndex,
  itemCount,
  children,
  ...props
}: ComponentProps<'ul'> & { activeIndex: number; itemCount: number }) {
  return (
    <ul
      // 只保留 absolute：与 relative 同写时生成 CSS 谁生效不确定，实测会掉回文档流。
      className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full min-w-56 overflow-auto rounded-card bg-surface p-1 shadow-raised @max-[260px]:min-w-0"
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
            'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
        }}
      />
      {children}
    </ul>
  );
}

export function PromptInputMenuItem({
  id,
  selected,
  icon,
  onHover,
  onSelect,
  children,
}: {
  id: string;
  selected: boolean;
  icon: ReactNode;
  onHover: () => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <li
      aria-selected={selected}
      className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-chip px-2 text-left"
      id={id}
      onClick={onSelect}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      ref={selected ? scrollRowIntoView : undefined}
      role="option"
    >
      {icon}
      {children}
    </li>
  );
}

export function PromptInputNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex items-start gap-2 rounded-card bg-surface bg-[linear-gradient(var(--danger-tint),var(--danger-tint))] px-3 py-1.5 text-sm leading-6 text-ink shadow-hairline"
      role="alert"
      style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both' }}
    >
      <CircleAlert aria-hidden className="mt-1 size-3.5 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onDismiss && (
        <button
          aria-label="关闭提示"
          className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-surface hover:text-ink"
          onClick={onDismiss}
          type="button"
        >
          <X className="size-3" strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

export function PromptInputOption({
  active,
  className,
  ...props
}: ComponentProps<'button'> & { active: boolean }) {
  return (
    <button
      className={cn(
        'flex h-7.5 w-full items-center gap-1 rounded-chip px-2 text-left text-sm transition-colors',
        active ? 'bg-hover font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
        className,
      )}
      type="button"
      {...props}
    />
  );
}

export function PromptInputOptionCheck() {
  return <Check className="ms-auto size-3 shrink-0 text-ink" strokeWidth={2.5} />;
}

export function PromptInputSetup({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="grid gap-2 px-1.5 py-2">
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
