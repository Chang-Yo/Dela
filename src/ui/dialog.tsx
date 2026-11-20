'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { Button } from './button';
import { cn } from './lib/cn';
import { IconButton } from './icon-button';
import { dialogOverlay, dialogPanel } from './lib/motion';

const contentVariants = cva(dialogPanel, {
  variants: {
    size: { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' },
    scroll: { true: 'max-h-[85vh] overflow-y-auto', false: '' },
  },
  defaultVariants: { size: 'md', scroll: false },
});

const Dialog = DialogPrimitive.Root;

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogContent({
  className,
  size,
  scroll,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & VariantProps<typeof contentVariants>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={dialogOverlay} data-slot="dialog-overlay" />
      <DialogPrimitive.Content
        className={cn(contentVariants({ size, scroll }), className)}
        data-slot="dialog-content"
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-2', className)}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold', className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-2 text-xs leading-relaxed text-ink-3', className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-4 flex justify-end gap-2', className)}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogClose({
  'aria-label': label = '关闭',
  className,
  ...props
}: React.ComponentProps<typeof IconButton>) {
  return (
    <DialogPrimitive.Close asChild>
      <IconButton
        aria-label={label}
        className={className}
        data-slot="dialog-close"
        size="sm"
        {...props}
      >
        <X />
      </IconButton>
    </DialogPrimitive.Close>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmLabel: React.ReactNode;
  onConfirm: () => void;
  destructive?: boolean;
  busy?: boolean;
};

/* AlertDialog 语义：点遮罩不会关闭。 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
  busy,
}: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={dialogOverlay} data-slot="dialog-overlay" />
        <AlertDialogPrimitive.Content
          className={contentVariants({ size: 'sm' })}
          data-slot="dialog-content"
        >
          <AlertDialogPrimitive.Title className="text-base font-semibold" data-slot="dialog-title">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description
            className="mt-2 text-xs leading-relaxed text-ink-3"
            data-slot="dialog-description"
          >
            {description}
          </AlertDialogPrimitive.Description>
          <DialogFooter>
            <Button disabled={busy} onClick={() => onOpenChange(false)} variant="ghost">
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={onConfirm}
              variant={destructive ? 'destructive' : 'default'}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
