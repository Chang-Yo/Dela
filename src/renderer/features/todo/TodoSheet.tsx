import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { sheetUp } from '../../components/ui/motion';

/** 新建/编辑与详情共用的底部滑出面板壳。 */
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
  /** 详情用：卡片固定为所在视图 85% 高，溢出裁切，滚动由各内容区自理。 */
  fixedHeight?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  // 挂载时把焦点移入面板，Esc 与读屏才能立即作用于对话框；
  // 面板内已有焦点（如标题输入的 autoFocus）时不抢占。
  // preventScroll 必须带上：入场动画期间面板越出容器底边，默认聚焦会把
  // overflow-hidden 祖先滚动 1.5rem 再钳回，背景随之上跳又落回（抖动）。
  useEffect(() => {
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
      panelRef.current.focus({ preventScroll: true });
    }
  }, []);
  return (
    <div
      className="absolute inset-0 z-40"
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
          'absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-xl flex-col rounded-t-2xl bg-surface p-5 shadow-overlay max-md:px-4',
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
