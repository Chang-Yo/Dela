import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from './lib/cn';
import { sheetUp } from './lib/motion';

const Sheet = DialogPrimitive.Root;

function SheetContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  // 不经 Portal：只盖住所在视图并在其中居中，调用方的根元素需要 relative。
  return (
    <>
      <DialogPrimitive.Overlay className="absolute inset-0 z-overlay" data-slot="sheet-overlay" />
      <DialogPrimitive.Content
        className={cn(
          `absolute inset-x-0 bottom-0 z-overlay mx-auto flex max-h-[calc(100%-2rem)] w-full max-w-xl
           flex-col overflow-y-auto rounded-t-window bg-surface p-5 text-ink shadow-overlay
           outline-none max-md:px-4 ${sheetUp}`,
          className,
        )}
        data-slot="sheet-content"
        {...props}
      />
    </>
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
