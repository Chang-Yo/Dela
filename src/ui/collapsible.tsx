import { ChevronRight } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from './lib/cn';
import { useMediaQuery } from './hooks/use-media-query';

/** 收起动画结束后卸载内容：隐藏区域里的必填项不会拦住表单提交，也不会被 Tab 聚焦。
 *  只在动画中裁剪：展开后内容的描边、阴影与焦点环可以越出边界。 */
function Collapsible({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [animating, setAnimating] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setAnimating(!reducedMotion);
  }
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-slow ease-out-strong motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0',
      )}
      data-slot="collapsible"
      data-state={open ? 'open' : 'closed'}
      inert={!open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows')
          setAnimating(false);
      }}
    >
      <div className={cn('min-h-0', (animating || !open) && 'overflow-hidden', className)}>
        {(open || animating) && children}
      </div>
    </div>
  );
}

function CollapsibleChevron({
  open,
  className,
  ...props
}: ComponentProps<typeof ChevronRight> & { open: boolean }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        'size-3 shrink-0 transition-transform duration-base motion-reduce:transition-none',
        open && 'rotate-90',
        className,
      )}
      data-slot="collapsible-chevron"
      {...props}
    />
  );
}

export { Collapsible, CollapsibleChevron };
