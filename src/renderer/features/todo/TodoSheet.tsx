import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';

/** 新建/编辑与详情共用的底部滑出面板壳：遮罩、卡片容器、标题行与关闭按钮。 */
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
        className={cn(
          'absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-xl animate-in flex-col rounded-t-2xl border bg-card p-5 shadow-2xl fade-in slide-in-from-bottom-6 duration-200 max-md:px-4',
          fixedHeight ? 'h-[85%] overflow-hidden' : 'max-h-[calc(100%-2rem)] overflow-y-auto',
        )}
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
