'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from './lib/cn';
import { dialogOverlay, drawerFromLeft, drawerFromRight, sheetUp } from './lib/motion';

const contentVariants = cva('fixed z-overlay bg-surface text-ink shadow-overlay outline-none', {
  variants: {
    side: {
      left: `inset-y-0 left-0 w-70 max-w-[85vw] ${drawerFromLeft}`,
      right: `inset-y-0 right-0 w-72 max-w-[85vw] border-l border-line ${drawerFromRight}`,
      bottom: `inset-x-0 bottom-0 mx-auto flex max-h-[calc(100%-2rem)] w-full max-w-xl flex-col overflow-y-auto rounded-t-window p-5 max-md:px-4 ${sheetUp}`,
    },
  },
  defaultVariants: { side: 'bottom' },
});

const Sheet = DialogPrimitive.Root;

function SheetContent({
  className,
  side,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & VariantProps<typeof contentVariants>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={dialogOverlay} data-slot="sheet-overlay" />
      <DialogPrimitive.Content
        className={cn(contentVariants({ side }), className)}
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
