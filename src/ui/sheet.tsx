'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from './lib/cn';
import { sheetUp } from './lib/motion';

const Sheet = DialogPrimitive.Root;

function SheetContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-overlay" data-slot="sheet-overlay" />
      <DialogPrimitive.Content
        className={cn(
          `fixed inset-x-0 bottom-0 z-overlay mx-auto flex max-h-[calc(100%-2rem)] w-full max-w-xl
           flex-col overflow-y-auto rounded-t-window bg-surface p-5 text-ink shadow-overlay
           outline-none max-md:px-4 ${sheetUp}`,
          className,
        )}
        data-slot="sheet-content"
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold', className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

export { Sheet, SheetContent, SheetTitle };
