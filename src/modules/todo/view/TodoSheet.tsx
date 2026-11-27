import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/lib/cn';
import { Sheet, SheetContent, SheetTitle } from '../../../ui/sheet';

export function TodoSheet({
  title,
  onClose,
  children,
  fixedHeight = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  fixedHeight?: boolean;
}) {
  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open>
      <SheetContent
        aria-describedby={undefined}
        className={cn(fixedHeight ? 'h-[85%] overflow-hidden' : '[scrollbar-width:none]')}
      >
        <div className="flex items-start justify-between gap-3">
          <SheetTitle className="break-words tracking-tight">{title}</SheetTitle>
          <Button
            aria-label="关闭"
            className="-mr-2 shrink-0"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}
