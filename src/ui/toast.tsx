'use client';

import { CircleAlert, CircleCheck, Sparkles, X, type LucideIcon } from 'lucide-react';
import { Toast } from 'radix-ui';
import { useSyncExternalStore, type ReactNode } from 'react';
import { cn } from './lib/cn';
import { IconButton } from './icon-button';

export type ToastVariant = 'error' | 'success';

const tone = {
  error: { icon: CircleAlert, badge: 'bg-danger-tint text-danger', role: 'alert' },
  success: { icon: CircleCheck, badge: 'bg-success-tint text-success', role: 'status' },
  neutral: { icon: Sparkles, badge: 'bg-inset text-ink-2', role: 'group' },
} as const;

export function ToastCard({
  variant,
  title,
  description,
  onClose,
  className,
  icon,
  action,
  children,
}: {
  variant: ToastVariant | 'neutral';
  title: string;
  description?: string;
  onClose?: () => void;
  className?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { badge, role } = tone[variant];
  const Icon = icon ?? tone[variant].icon;
  return (
    <div
      role={role}
      aria-label={variant === 'neutral' ? title : undefined}
      className={cn(
        `pointer-events-auto flex w-96 max-w-full items-start gap-2.5 rounded-card
         border border-line bg-surface py-3 pl-3 pr-2 shadow-overlay`,
        className,
      )}
    >
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', badge)}>
        <Icon aria-hidden className="size-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium leading-5 text-ink">{title}</p>
        {description && (
          <p className="mt-0.5 break-words text-xs leading-[1.45] text-ink-2">{description}</p>
        )}
        {children}
      </div>
      {action}
      {onClose && (
        <IconButton aria-label="关闭通知" onClick={onClose} className="-mt-0.5">
          <X />
        </IconButton>
      )}
    </div>
  );
}

export interface ToastItem {
  id: string;
  open: boolean;
  variant: ToastVariant | 'neutral';
  title: string;
  description?: string;
}

const MAX_OPEN_TOASTS = 4;
const DURATION_MS: Record<ToastItem['variant'], number> = {
  error: 8000,
  success: 4000,
  neutral: 6000,
};

let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function setItems(next: ToastItem[]) {
  items = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 瞬时动作结果由任意模块直接调用；持久状态仍内联展示。 */
export function showToast(toast: Omit<ToastItem, 'id' | 'open'>) {
  const opened = items.filter((item) => item.open);
  setItems([...opened, { id: crypto.randomUUID(), open: true, ...toast }].slice(-MAX_OPEN_TOASTS));
}

export function dismissToast(id: string) {
  setItems(items.map((item) => (item.id === id ? { ...item, open: false } : item)));
}

export function toasts() {
  return items.filter((item) => item.open);
}

export function Toaster() {
  const current = useSyncExternalStore(subscribe, () => items);
  return (
    <Toast.Provider>
      {current.map((toast) => (
        <Toast.Root
          key={toast.id}
          open={toast.open}
          duration={DURATION_MS[toast.variant]}
          onOpenChange={(open) => {
            if (!open) dismissToast(toast.id);
          }}
          className="data-[state=closed]:animate-toast-out data-[state=open]:animate-toast-in motion-reduce:animate-none"
        >
          <ToastCard
            variant={toast.variant}
            title={toast.title}
            description={toast.description}
            onClose={() => dismissToast(toast.id)}
          />
        </Toast.Root>
      ))}
      <Toast.Viewport
        data-toast-host=""
        className="pointer-events-none absolute inset-x-0 top-0 z-toast flex flex-col items-center gap-2 px-4 pt-3"
      />
    </Toast.Provider>
  );
}
