import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { useMediaQuery } from './use-media-query';

/**
 * 高度在 0 与内容高度之间过渡。收起动画结束后卸载内容：隐藏区域里的必填项
 * 不会拦住表单提交，也不会被 Tab 聚焦。
 */
function Collapse({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setClosing(!open && !reducedMotion);
  }
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-slow ease-out-strong motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0',
      )}
      data-slot="collapse"
      data-state={open ? 'open' : 'closed'}
      inert={!open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows')
          setClosing(false);
      }}
    >
      <div className={cn('min-h-0 overflow-hidden', className)}>
        {(open || closing) && children}
      </div>
    </div>
  );
}

/** 折叠触发器上的箭头：收起时朝右，展开时朝下。 */
function CollapseChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        'size-3 shrink-0 transition-transform duration-base motion-reduce:transition-none',
        open && 'rotate-90',
        className,
      )}
    />
  );
}

export { Collapse, CollapseChevron };
