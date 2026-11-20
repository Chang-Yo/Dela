import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/lib/cn';
import { sheetUp } from '../../../ui/lib/motion';

export function TodoSheet({
  label,
  title,
  onClose,
  children,
  fixedHeight = false,
}: {
  label: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  fixedHeight?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  // 挂载时把焦点移入面板（已有焦点则不抢）；preventScroll 必须带上，否则入场动画期间
  // 面板越出容器底边，聚焦会滚动 overflow-hidden 祖先，背景随之抖动。
  useEffect(() => {
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
      panelRef.current.focus({ preventScroll: true });
    }
  }, []);
  return (
    <div
      className="absolute inset-0 z-overlay"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div aria-hidden="true" className="absolute inset-0" onMouseDown={onClose} />
      <section
        aria-label={label}
        aria-modal="true"
        className={cn(
          sheetUp,
          'absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-xl flex-col rounded-t-window bg-surface p-5 shadow-overlay max-md:px-4',
          fixedHeight
            ? 'h-[85%] overflow-hidden'
            : 'max-h-[calc(100%-2rem)] overflow-y-auto [scrollbar-width:none]',
        )}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="break-words text-base font-semibold tracking-tight">{title}</h2>
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
      </section>
    </div>
  );
}
